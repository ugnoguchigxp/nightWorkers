import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "../api/db/client";
import { repositories, taskEvents } from "../api/db/schema";
import { runCompletionCheck } from "../api/modules/codingAgent/application/completion-check.service";
import { recordManualConditionConfirmationsForReview } from "../api/modules/codingAgent/application/manual-condition-confirmation.service";
import * as nightworkersRepository from "../api/modules/nightworkers/nightworkers.repository";
import { createVerificationDocumentFromSpec } from "../api/modules/nightworkers/nightworkers.verification.service";

const repositoryIds: string[] = [];

afterEach(async () => {
	for (const repositoryId of repositoryIds.splice(0)) {
		await db.delete(repositories).where(eq(repositories.id, repositoryId));
	}
});

describe("manual condition evidence", () => {
	it("keeps manual review outside Evidence Readiness", async () => {
		const repository = await nightworkersRepository.createRepository({
			name: `TEST: manual condition ${crypto.randomUUID()}`,
			localPath: process.cwd(),
			branch: "main",
		});
		repositoryIds.push(repository.id);
		const task = await nightworkersRepository.createTask({
			repositoryId: repository.id,
			title: "TEST: manual condition evidence",
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
			sourceSpecPath: "spec/manual-condition.md",
			document: {
				version: 2,
				specId: "manual-condition",
				specPath: "spec/manual-condition.md",
				generatedAt: new Date().toISOString(),
				source: {
					taskId: task.id,
					sourceMessageIds: [],
					workspaceArtifactIds: [],
				},
				conditions: [
					{
						id: "AC-001",
						text: "reviewer confirms the visible behavior",
						category: "ui",
						verificationKind: "manual",
						expectedEvidence: ["manual_evidence"],
						expectedResult: "the reviewer confirms the behavior",
						failureMeaning: "manual confirmation is absent",
						required: true,
						status: "pending",
					},
				],
				commands: [],
			},
		});

		const beforeReview = await runCompletionCheck({
			taskId: task.id,
			runId: run?.id ?? "",
			verificationDocumentId: document.id,
			repoRoot: process.cwd(),
		});
		expect(beforeReview).toMatchObject({
			ok: false,
			mapping: { status: "not_required" },
			verify: { status: "not_run" },
			suggestedAction: "run_verify",
		});

		await expect(
			recordManualConditionConfirmationsForReview({
				taskId: task.id,
				runId: run?.id ?? "",
				actorKind: "human_reviewer",
				actorId: "review-result-1",
				evidenceRef: "review-result:review-result-1",
			}),
		).rejects.toMatchObject({ code: "manual_confirmation_review_missing" });

		await db.insert(taskEvents).values({
			taskRunId: run?.id ?? "",
			seq: 1,
			actor: "human",
			type: "info",
			message: "Human review completed.",
			payloadJson: {
				reviewResult: {
					id: "review-result-1",
					runId: run?.id ?? "",
					taskId: task.id,
					reviewer: { type: "human" },
					action: "complete",
					verdict: "approved",
					statusAfter: "completed",
				},
			},
		});
		await recordManualConditionConfirmationsForReview({
			taskId: task.id,
			runId: run?.id ?? "",
			actorKind: "human_reviewer",
			actorId: "review-result-1",
			evidenceRef: "review-result:review-result-1",
		});

		const afterReview = await runCompletionCheck({
			taskId: task.id,
			runId: run?.id ?? "",
			verificationDocumentId: document.id,
			repoRoot: process.cwd(),
		});
		expect(afterReview).toMatchObject({
			ok: false,
			mapping: { status: "not_required" },
			verify: { status: "not_run" },
		});
	});
});
