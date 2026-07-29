import crypto from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import {
	verificationChecklistItems,
	verificationDocuments,
	verificationEvidenceRuns,
} from "../api/db/verification-schema";
import { captureWorkspaceSourceSnapshot } from "../api/modules/codingAgent";
import { bindEvidenceSubject } from "../api/modules/evidenceLedger";
import {
	admitCloseout,
	evaluateCloseoutAdmission,
} from "../api/modules/gitCloseout/closeout-admission.service";
import * as repo from "../api/modules/nightworkers/nightworkers.repository";
import * as reviewRepo from "../api/modules/review/review-mode.repository";
import { buildReviewTargetManifest } from "../api/modules/review/review-target-manifest";

beforeAll(async () => {
	await ensureNightWorkersSchema();
});

const temporaryDirectories: string[] = [];
afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("Closeout Admission", () => {
	it("fails closed for a Run without canonical revision evidence", async () => {
		const repository = await repo.createRepository({
			name: `TEST: closeout admission ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: repository.id,
			title: "TEST: closeout admission",
		});
		const run = await repo.createTaskRun({
			taskId: task.id,
			repositoryId: repository.id,
			status: "completed",
			finalReport: "Legacy completion",
		});

		const result = await evaluateCloseoutAdmission(run.id);
		expect(result.passed).toBe(false);
		expect(result.reasons).toEqual(
			expect.arrayContaining([
				"task_revision_stale",
				"final_response_evidence_unbound",
			]),
		);
		await expect(admitCloseout(run.id)).rejects.toMatchObject({
			code: "closeout_evidence_stale",
		});
	});

	it("admits one Run when revision, source, verification, review, and final response match", async () => {
		const repoRoot = await mkdtemp(
			path.join(tmpdir(), "closeout-admission-current-"),
		);
		temporaryDirectories.push(repoRoot);
		await writeFile(path.join(repoRoot, "result.txt"), "verified\n");
		const repository = await repo.createRepository({
			name: `TEST: current closeout admission ${crypto.randomUUID()}`,
			localPath: repoRoot,
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: repository.id,
			title: "TEST: current closeout admission",
		});
		if (!task.currentRevisionSnapshotId)
			throw new Error("Task revision snapshot is missing");
		const revision = await repo.getTaskRevisionSnapshot(
			task.currentRevisionSnapshotId,
		);
		if (!revision) throw new Error("Task revision snapshot is missing");
		const startedAt = new Date(Date.now() - 5_000);
		const run = await repo.createTaskRun({
			taskId: task.id,
			repositoryId: repository.id,
			taskRevisionSnapshotId: revision.id,
			taskRevision: revision.revision,
			taskDigest: revision.digest,
			status: "completed",
			worktreePath: repoRoot,
			contextSnapshot: { executionMode: "implementation" },
			startedAt,
			endedAt: new Date(startedAt.getTime() + 4_000),
			finishedAt: new Date(startedAt.getTime() + 4_000),
		});
		const [document] = await db
			.insert(verificationDocuments)
			.values({
				taskId: task.id,
				runId: run.id,
				sourceSpecPath: "spec.md",
				status: "active",
				documentJson: { conditions: ["AC-001"] },
				generatedAt: new Date(startedAt.getTime() + 500),
			})
			.returning();
		if (!document) throw new Error("Verification document is missing");
		const source = await captureWorkspaceSourceSnapshot(repoRoot);
		const subject = await bindEvidenceSubject({
			taskId: task.id,
			runId: run.id,
			sourceStateHash: source.sourceStateHash,
			verificationDocumentId: document.id,
		});
		if (!subject) throw new Error("Evidence Subject is missing");
		const evidenceFinishedAt = new Date(startedAt.getTime() + 2_000);
		const [evidence] = await db
			.insert(verificationEvidenceRuns)
			.values({
				taskId: task.id,
				runId: run.id,
				verificationDocumentId: document.id,
				subjectId: subject.id,
				checkKind: "unit",
				command: "test",
				cwd: repoRoot,
				exitCode: 0,
				runner: "unknown",
				rawStdoutArtifactId: crypto.randomUUID(),
				rawStderrArtifactId: crypto.randomUUID(),
				summaryJson: {},
				commandLevelConditionIdsJson: ["AC-001"],
				sourceSnapshotJson: source,
				startedAt: new Date(startedAt.getTime() + 1_000),
				finishedAt: evidenceFinishedAt,
			})
			.returning();
		if (!evidence) throw new Error("Verification Evidence is missing");
		await db.insert(verificationChecklistItems).values({
			verificationDocumentId: document.id,
			taskId: task.id,
			conditionId: "AC-001",
			text: "Tests pass",
			required: true,
			status: "passed",
			evidenceIdsJson: [evidence.id],
		});
		await repo.createRunEvent({
			version: 1,
			runId: run.id,
			taskId: task.id,
			timestamp: new Date(startedAt.getTime() + 3_000).toISOString(),
			type: "tool.call_finished",
			severity: "info",
			actor: "tool",
			message: "completion_check finished",
			data: {
				mcpTool: "completion_check",
				ok: true,
				status: "completed",
				result: { ok: true, verificationDocumentId: document.id },
			},
		});
		await repo.updateTaskRun(run.id, { finalReport: "Canonical completion" });
		const manifest = await buildReviewTargetManifest({
			target: {
				runId: run.id,
				taskId: task.id,
				repositoryId: repository.id,
				repoRoot,
				planArtifact: { messageId: null, title: null, source: "missing" },
				targetFiles: [],
				excludedDirtyFiles: [],
				signalOnlyFiles: [],
				diffOnlyFiles: [],
				warnings: [],
			},
		});
		const reviewRun = await repo.createTaskRun({
			taskId: task.id,
			repositoryId: repository.id,
			status: "completed",
			contextSnapshot: { reviewRun: { targetManifest: manifest } },
		});
		const recommendation = await reviewRepo.upsertReviewRecommendation({
			runId: run.id,
			taskId: task.id,
			repositoryId: repository.id,
			level: "required",
			defaultAction: "require_review",
			reasonsJson: [],
		});
		const reviewSession = await reviewRepo.createOrStartReviewSession({
			runId: run.id,
			taskId: task.id,
			repositoryId: repository.id,
			recommendationId: recommendation.id,
		});
		await reviewRepo.upsertReviewArtifact({
			reviewSessionId: reviewSession.id,
			runId: run.id,
			taskId: task.id,
			kind: "review_run",
			status: "done",
			artifactJson: {
				status: "done",
				reviewRunId: reviewRun.id,
				fixesApplied: false,
			},
			sourceEvidenceRefsJson: [],
		});
		await repo.createRunEvent({
			version: 1,
			runId: run.id,
			taskId: task.id,
			timestamp: new Date().toISOString(),
			type: "review.run_completed",
			severity: "info",
			actor: "system",
			message: "Review completed",
			data: {
				reviewSessionId: reviewSession.id,
				reviewRunId: reviewRun.id,
				reviewedRunId: run.id,
				status: "done",
			},
		});
		await repo.createRunEvent({
			version: 1,
			runId: run.id,
			taskId: task.id,
			timestamp: new Date().toISOString(),
			type: "system.info",
			severity: "info",
			actor: "system",
			message: "Security skipped by policy",
			data: {
				action: "security.oracle_gate_skipped",
				reason: "fixture policy",
			},
		});

		const evaluated = await evaluateCloseoutAdmission(run.id);
		expect(evaluated).toMatchObject({
			passed: true,
			subjectId: subject.id,
			reasons: [],
		});
		expect((await admitCloseout(run.id)).status).toBe("admitted");
	});
});
