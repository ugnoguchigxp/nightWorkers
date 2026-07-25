import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import { repositories } from "../api/db/schema";
import {
	verificationChecklistItems,
	verificationDocuments,
} from "../api/db/verification-schema";
import { getEvidenceCheckSnapshot } from "../api/modules/codingAgent/verification/evidence-check-query.service";
import * as repo from "../api/modules/nightworkers/nightworkers.repository";

const repositoryIds: string[] = [];

beforeAll(() => ensureNightWorkersSchema());

afterEach(async () => {
	for (const id of repositoryIds.splice(0)) {
		await db.delete(repositories).where(eq(repositories.id, id));
	}
});

describe("Coding Agent Evidence Check query", () => {
	it("returns only the requested Task's active Spec checklist", async () => {
		const repository = await repo.createRepository({
			name: `evidence-check-${crypto.randomUUID()}`,
			localPath: "/tmp/evidence-check",
			branch: "main",
		});
		repositoryIds.push(repository.id);
		const task = await repo.createTask({
			repositoryId: repository.id,
			title: "Evidence check",
			status: "ready",
		});
		const verificationDocumentId = crypto.randomUUID();
		const specMessage = await repo.createTaskMessage({
			taskId: task.id,
			role: "assistant",
			content: "# Feature Plan",
			messageType: "markdown_document",
			payloadJson: { intent: "feature_plan" },
		});
		const specMessageId = specMessage.id;
		await db.insert(verificationDocuments).values({
			id: verificationDocumentId,
			taskId: task.id,
			specMessageId,
			specArtifactId: `feature-plan-${specMessageId}`,
			sourceSpecPath: "spec/feature-plan.md",
			status: "active",
			documentJson: {},
			generatedAt: new Date("2026-07-24T00:00:00.000Z"),
		});
		await db.insert(verificationChecklistItems).values([
			{
				id: crypto.randomUUID(),
				verificationDocumentId,
				taskId: task.id,
				conditionId: "AC-001",
				text: "API evidence is present",
				required: true,
				status: "passed",
				evidenceIdsJson: ["evidence-1"],
			},
			{
				id: crypto.randomUUID(),
				verificationDocumentId,
				taskId: task.id,
				conditionId: "AC-002",
				text: "UI evidence is present",
				required: true,
				status: "pending",
				evidenceIdsJson: [],
			},
		]);

		await expect(
			getEvidenceCheckSnapshot({
				taskId: task.id,
				verificationDocumentId,
			}),
		).resolves.toMatchObject({
			taskId: task.id,
			verificationDocumentId,
			specMessageId,
			conditions: [
				{ id: "AC-001", status: "passed", evidenceIds: ["evidence-1"] },
				{ id: "AC-002", status: "pending", evidenceIds: [] },
			],
			summary: { total: 2, confirmed: 1, failed: 0, pending: 1 },
		});
		await expect(
			getEvidenceCheckSnapshot({
				taskId: crypto.randomUUID(),
				verificationDocumentId,
			}),
		).resolves.toBeNull();
	});
});
