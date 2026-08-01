import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import { repositories } from "../api/db/schema";
import {
	codingAgentEvidenceCheckConfirmations,
	codingAgentEvidenceReadinessSettlements,
	codingAgentTestConditionMappings,
	codingAgentTestInventoryCases,
	codingAgentTestInventoryRuns,
	verificationChecklistItems,
	verificationDocuments,
	verificationEvidenceRuns,
} from "../api/db/verification-schema";
import {
	getEvidenceCheckSnapshot,
	getLatestEvidenceCheckDescriptor,
} from "../api/modules/codingAgent/verification/evidence-check-query.service";
import { evaluateEvidenceReadiness } from "../api/modules/codingAgent/verification/evidence-readiness.service";
import { captureWorkspaceSourceSnapshot } from "../api/modules/codingAgent/verification/workspace-source-snapshot";
import * as repo from "../api/modules/nightworkers/nightworkers.repository";
import { completionCheckTool } from "../api/services/worker-tools/run-check";

const repositoryIds: string[] = [];
const temporaryDirectories: string[] = [];

beforeAll(() => ensureNightWorkersSchema());

afterEach(async () => {
	for (const id of repositoryIds.splice(0)) {
		await db.delete(repositories).where(eq(repositories.id, id));
	}
	for (const directory of temporaryDirectories.splice(0)) {
		await fs.rm(directory, { recursive: true, force: true });
	}
});

describe("Coding Agent Evidence Check query", () => {
	it("settles only after initial verify, one confirmation, and follow-up verify", async () => {
		const repositoryPath = await fs.mkdtemp(
			path.join(os.tmpdir(), "evidence-readiness-"),
		);
		temporaryDirectories.push(repositoryPath);
		await fs.mkdir(path.join(repositoryPath, "tests"));
		await fs.writeFile(
			path.join(repositoryPath, "package.json"),
			JSON.stringify({ devDependencies: { vitest: "latest" } }),
		);
		await fs.writeFile(
			path.join(repositoryPath, "tests", "todo.test.ts"),
			'import { it } from "vitest";\nit("creates a todo", () => {});\n',
		);
		const repository = await repo.createRepository({
			name: `evidence-check-${crypto.randomUUID()}`,
			localPath: repositoryPath,
			branch: "main",
		});
		repositoryIds.push(repository.id);
		const task = await repo.createTask({
			repositoryId: repository.id,
			title: "Evidence check",
			status: "ready",
		});
		const run = await repo.createTaskRun({
			taskId: task.id,
			repositoryId: repository.id,
			status: "running",
			workerKind: "codex-agent",
			contextSnapshot: { executionMode: "implementation" },
		});
		const verificationDocumentId = crypto.randomUUID();
		await db.insert(verificationDocuments).values({
			id: verificationDocumentId,
			taskId: task.id,
			runId: run.id,
			sourceSpecPath: "spec/feature-plan.md",
			status: "active",
			documentJson: {
				version: 2,
				specId: "feature-plan",
				specPath: "spec/feature-plan.md",
				generatedAt: "2026-07-24T00:00:00.000Z",
				source: {
					taskId: task.id,
					sourceMessageIds: [],
					workspaceArtifactIds: [],
				},
				testScope: "unit",
				conditions: [],
				commands: [],
			},
			generatedAt: new Date("2026-07-24T00:00:00.000Z"),
		});
		await db.insert(verificationChecklistItems).values({
			id: crypto.randomUUID(),
			verificationDocumentId,
			taskId: task.id,
			conditionId: "AC-001",
			text: "Todoを作成できる",
			required: true,
			verificationKind: "automated_test",
			expectedEvidenceJson: ["unit_test"],
			status: "pending",
			evidenceIdsJson: [],
		});
		const snapshot = await captureWorkspaceSourceSnapshot(repositoryPath);
		const inventoryId = crypto.randomUUID();
		const caseKey = "static:vitest:tests/todo.test.ts:creates a todo";
		await db.insert(codingAgentTestInventoryRuns).values({
			id: inventoryId,
			taskId: task.id,
			runId: run.id,
			cwd: repositoryPath,
			sourceSnapshotJson: snapshot,
			warningsJson: [],
		});
		await db.insert(codingAgentTestInventoryCases).values({
			id: crypto.randomUUID(),
			inventoryId,
			caseKey,
			name: "creates a todo",
			filePath: "tests/todo.test.ts",
			runner: "vitest",
			discoveryLevel: "active",
			declaredConditionIdsJson: [],
		});
		await db.insert(codingAgentTestConditionMappings).values({
			id: crypto.randomUUID(),
			taskId: task.id,
			verificationDocumentId,
			inventoryId,
			caseKey,
			conditionId: "AC-001",
			source: "schema_evidence_set",
			sourceDigest: snapshot.sourceStateHash,
		});
		await expect(
			completionCheckTool({
				taskId: task.id,
				runId: run.id,
				verificationDocumentId,
				repoRoot: repositoryPath,
			}),
		).resolves.toMatchObject({
			ok: false,
			payload: {
				result: {
					verify: { status: "not_run" },
					confirmation: { status: "awaiting_initial_verify" },
					suggestedAction: "run_verify",
				},
			},
		});
		expect(
			await db
				.select()
				.from(codingAgentEvidenceCheckConfirmations)
				.where(eq(codingAgentEvidenceCheckConfirmations.runId, run.id)),
		).toHaveLength(0);
		await db.insert(verificationEvidenceRuns).values({
			id: crypto.randomUUID(),
			taskId: task.id,
			runId: run.id,
			verificationDocumentId,
			checkKind: "verify",
			command: "bun run verify",
			cwd: repositoryPath,
			exitCode: 0,
			runner: "vitest",
			rawStdoutArtifactId: "stdout",
			rawStderrArtifactId: "stderr",
			summaryJson: {},
			evidenceKindsJson: ["unit_test"],
			commandLevelConditionIdsJson: [],
			sourceSnapshotJson: snapshot,
			testExecutionObserved: false,
			sourceMutatedDuringCheck: false,
			startedAt: new Date("2026-07-24T00:01:00.000Z"),
			finishedAt: new Date("2026-07-24T00:02:00.000Z"),
		});
		await db.insert(verificationEvidenceRuns).values({
			id: crypto.randomUUID(),
			taskId: task.id,
			runId: run.id,
			verificationDocumentId,
			checkKind: "verify",
			command: "bun run e2e",
			cwd: repositoryPath,
			exitCode: 0,
			runner: "playwright",
			rawStdoutArtifactId: "e2e-stdout",
			rawStderrArtifactId: "e2e-stderr",
			summaryJson: {},
			evidenceKindsJson: ["e2e_test"],
			commandLevelConditionIdsJson: [],
			sourceSnapshotJson: snapshot,
			testExecutionObserved: true,
			sourceMutatedDuringCheck: false,
			startedAt: new Date("2026-07-24T00:02:00.000Z"),
			finishedAt: new Date("2026-07-24T00:03:00.000Z"),
		});

		await expect(
			getLatestEvidenceCheckDescriptor(task.id),
		).resolves.toMatchObject({
			taskId: task.id,
			verificationDocumentId,
		});
		const awaitingConfirmation = await getEvidenceCheckSnapshot({
			taskId: task.id,
			verificationDocumentId,
		});
		expect(awaitingConfirmation).toMatchObject({
			version: 2,
			taskId: task.id,
			runId: run.id,
			scope: { testScope: "unit", e2eAllowed: false },
			mapping: { status: "missing" },
			verify: { status: "passed", command: "bun run verify", exitCode: 0 },
			confirmation: { status: "awaiting_confirmation" },
			ready: false,
			suggestedAction: "confirm_evidence_check",
		});
		await expect(
			completionCheckTool({
				taskId: task.id,
				runId: run.id,
				verificationDocumentId,
				repoRoot: repositoryPath,
			}),
		).resolves.toMatchObject({
			ok: false,
			payload: {
				result: {
					mapping: {
						status: "matched",
						total: 1,
						matched: 1,
						items: [{ id: "AC-001", status: "matched" }],
					},
					verify: {
						status: "passed",
						command: "bun run verify",
						exitCode: 0,
					},
					confirmation: { status: "confirmed" },
					suggestedAction: "run_verify",
				},
			},
		});
		expect(
			await db
				.select()
				.from(codingAgentEvidenceCheckConfirmations)
				.where(eq(codingAgentEvidenceCheckConfirmations.runId, run.id)),
		).toHaveLength(1);
		expect(
			await db
				.select()
				.from(codingAgentEvidenceReadinessSettlements)
				.where(eq(codingAgentEvidenceReadinessSettlements.runId, run.id)),
		).toHaveLength(0);
		await fs.writeFile(
			path.join(repositoryPath, "implementation.ts"),
			"export {};\n",
		);
		await expect(
			getEvidenceCheckSnapshot({ taskId: task.id, verificationDocumentId }),
		).resolves.toMatchObject({
			confirmation: { status: "confirmed" },
			ready: false,
			suggestedAction: "run_verify",
		});
		await fs.writeFile(
			path.join(repositoryPath, "tests", "todo.test.ts"),
			'import { it } from "vitest";\nit("renamed todo test", () => {});\n',
		);
		const remappedSource = await captureWorkspaceSourceSnapshot(repositoryPath);
		await db.insert(verificationEvidenceRuns).values({
			id: crypto.randomUUID(),
			taskId: task.id,
			runId: run.id,
			verificationDocumentId,
			checkKind: "verify",
			command: "bun run verify",
			cwd: repositoryPath,
			exitCode: 0,
			runner: "vitest",
			rawStdoutArtifactId: "remapped-stdout",
			rawStderrArtifactId: "remapped-stderr",
			summaryJson: {},
			evidenceKindsJson: ["unit_test"],
			commandLevelConditionIdsJson: [],
			sourceSnapshotJson: remappedSource,
			testExecutionObserved: false,
			sourceMutatedDuringCheck: false,
			startedAt: new Date("2026-07-24T00:04:00.000Z"),
			finishedAt: new Date("2026-07-24T00:05:00.000Z"),
		});
		const settledSnapshot = await getEvidenceCheckSnapshot({
			taskId: task.id,
			verificationDocumentId,
		});
		expect(settledSnapshot).toMatchObject({
			mapping: { status: "matched" },
			verify: { status: "passed", command: "bun run verify", exitCode: 0 },
			confirmation: { status: "settled" },
			ready: true,
			suggestedAction: "write_final_report",
		});
		expect(
			await db
				.select()
				.from(codingAgentEvidenceReadinessSettlements)
				.where(eq(codingAgentEvidenceReadinessSettlements.runId, run.id)),
		).toHaveLength(1);
		await fs.writeFile(
			path.join(repositoryPath, "after-settlement.ts"),
			"export {};\n",
		);
		await expect(
			getEvidenceCheckSnapshot({ taskId: task.id, verificationDocumentId }),
		).resolves.toEqual(settledSnapshot);

		const nextVerificationDocumentId = crypto.randomUUID();
		await db.insert(verificationDocuments).values({
			id: nextVerificationDocumentId,
			taskId: task.id,
			runId: run.id,
			sourceSpecPath: "spec/additional-feature.md",
			status: "active",
			documentJson: {
				version: 2,
				specId: "additional-feature",
				specPath: "spec/additional-feature.md",
				generatedAt: "2026-07-24T00:06:00.000Z",
				source: {
					taskId: task.id,
					sourceMessageIds: [],
					workspaceArtifactIds: [],
				},
				testScope: "unit",
				conditions: [],
				commands: [],
			},
			generatedAt: new Date("2026-07-24T00:06:00.000Z"),
		});
		await expect(
			evaluateEvidenceReadiness({
				taskId: task.id,
				runId: run.id,
				verificationDocumentId: nextVerificationDocumentId,
				repoRoot: repositoryPath,
			}),
		).resolves.toMatchObject({
			runId: run.id,
			verify: { status: "not_run" },
			ready: false,
			suggestedAction: "run_verify",
		});

		const nextRun = await repo.createTaskRun({
			taskId: task.id,
			repositoryId: repository.id,
			status: "running",
			workerKind: "codex-agent",
			contextSnapshot: { executionMode: "implementation" },
		});
		await expect(
			evaluateEvidenceReadiness({
				taskId: task.id,
				runId: nextRun.id,
				verificationDocumentId,
				repoRoot: repositoryPath,
			}),
		).resolves.toMatchObject({
			runId: nextRun.id,
			verify: { status: "not_run" },
			ready: false,
			suggestedAction: "run_verify",
		});
		await expect(
			getEvidenceCheckSnapshot({
				taskId: crypto.randomUUID(),
				verificationDocumentId,
			}),
		).resolves.toBeNull();
	});
});
