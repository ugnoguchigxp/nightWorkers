import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "../api/db/client";
import { repositories } from "../api/db/schema";
import { validateRunCheckEvidenceScope } from "../api/modules/codingAgent/verification/run-check-evidence-scope.service";
import * as nightworkersRepository from "../api/modules/nightworkers/nightworkers.repository";
import { createVerificationDocumentFromSpec } from "../api/modules/nightworkers/nightworkers.verification.service";

const repositoryIds: string[] = [];

afterEach(async () => {
	for (const repositoryId of repositoryIds.splice(0)) {
		await db.delete(repositories).where(eq(repositories.id, repositoryId));
	}
});

describe("run_check managed evidence scope", () => {
	it("[AC-008][AC-009] validates condition identity, kind, and manual authority before execution", async () => {
		const repository = await nightworkersRepository.createRepository({
			name: `TEST: run-check scope ${crypto.randomUUID()}`,
			localPath: process.cwd(),
			branch: "main",
		});
		repositoryIds.push(repository.id);
		const task = await nightworkersRepository.createTask({
			repositoryId: repository.id,
			title: "TEST: run-check managed scope",
		});
		const revision =
			await nightworkersRepository.getCurrentTaskRevisionSnapshot(task.id);
		const run = await nightworkersRepository.createTaskRun({
			taskId: task.id,
			repositoryId: repository.id,
			taskRevisionSnapshotId: revision?.id,
			taskRevision: revision?.revision,
			taskDigest: revision?.digest,
		});
		const document = await createVerificationDocumentFromSpec({
			taskId: task.id,
			runId: run?.id,
			sourceSpecPath: "spec/run-check-scope.md",
			document: {
				version: 2,
				specId: "run-check-scope",
				specPath: "spec/run-check-scope.md",
				generatedAt: new Date().toISOString(),
				source: {
					taskId: task.id,
					sourceMessageIds: [],
					workspaceArtifactIds: [],
				},
				testScope: "unit",
				conditions: [
					{
						id: "AC-001",
						text: "the mapped unit behavior passes",
						category: "validation",
						verificationKind: "automated_test",
						expectedEvidence: ["unit_test"],
						expectedResult: "the unit test passes",
						failureMeaning: "the behavior is unverified",
						required: true,
						status: "pending",
					},
					{
						id: "AC-002",
						text: "the reviewer confirms the visible behavior",
						category: "ui",
						verificationKind: "manual",
						expectedEvidence: ["manual_evidence"],
						expectedResult: "the reviewer confirms it",
						failureMeaning: "human confirmation is absent",
						required: true,
						status: "pending",
					},
				],
				commands: [],
			},
		});
		const scope = {
			taskId: task.id,
			runId: run?.id,
			verificationDocumentId: document.id,
		};

		await expect(
			validateRunCheckEvidenceScope({
				...scope,
				conditionIds: ["AC-001"],
				evidenceKinds: ["unit_test"],
			}),
		).resolves.toBeUndefined();
		await expect(
			validateRunCheckEvidenceScope({
				taskId: task.id,
				verificationDocumentId: document.id,
				conditionIds: ["AC-001"],
				evidenceKinds: ["unit_test"],
			}),
		).rejects.toMatchObject({ code: "verification_evidence_scope_mismatch" });
		await expect(
			validateRunCheckEvidenceScope({
				...scope,
				conditionIds: ["AC-999"],
				evidenceKinds: ["unit_test"],
			}),
		).rejects.toMatchObject({ code: "unknown_verification_condition" });
		await expect(
			validateRunCheckEvidenceScope({
				...scope,
				conditionIds: ["AC-001"],
				evidenceKinds: ["e2e_test"],
			}),
		).rejects.toMatchObject({ code: "verification_scope_denied" });
		await expect(
			validateRunCheckEvidenceScope({
				...scope,
				conditionIds: [],
				evidenceKinds: ["e2e_test"],
				checkKind: "verify",
			}),
		).rejects.toMatchObject({ code: "verification_scope_denied" });
		await expect(
			validateRunCheckEvidenceScope({
				...scope,
				conditionIds: [],
				evidenceKinds: [],
				checkKind: "verify",
			}),
		).rejects.toMatchObject({
			code: "verification_scope_declaration_required",
		});
		await expect(
			validateRunCheckEvidenceScope({
				...scope,
				conditionIds: [],
				evidenceKinds: [],
				checkKind: "other",
			}),
		).rejects.toMatchObject({
			code: "verification_scope_declaration_required",
		});
		await expect(
			validateRunCheckEvidenceScope({
				...scope,
				conditionIds: ["AC-002"],
				evidenceKinds: ["manual_evidence"],
			}),
		).rejects.toMatchObject({
			code: "manual_condition_requires_human_confirmation",
		});
	});
});
