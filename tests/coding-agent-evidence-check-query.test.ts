import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import { repositories, taskRunTodos } from "../api/db/schema";
import {
	verificationChecklistItems,
	verificationDocuments,
} from "../api/db/verification-schema";
import { digestImplementationPlan } from "../api/modules/agentsShare";
import {
	getEvidenceCheckSnapshot,
	getLatestEvidenceCheckDescriptor,
} from "../api/modules/codingAgent/verification/evidence-check-query.service";
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
		const implementationPlan = {
			steps: [
				{
					title: "APIを実装する",
					systemContext: "確定済みAPI契約に従って実装する。",
				},
				{
					title: "品質ゲートを通す",
					systemContext: "対象Projectの品質ゲートを実行してPassさせる。",
				},
			],
		};
		const implementationPlanDigest =
			digestImplementationPlan(implementationPlan);
		const specMessage = await repo.createTaskMessage({
			taskId: task.id,
			role: "assistant",
			content: "# Feature Plan",
			messageType: "markdown_document",
			payloadJson: {
				intent: "feature_plan",
				implementationPlan,
				implementationPlanProvenance: {
					version: 1,
					digest: implementationPlanDigest,
				},
			},
		});
		const specMessageId = specMessage.id;
		const implementationRun = await repo.createTaskRun({
			taskId: task.id,
			repositoryId: repository.id,
			status: "needs_review",
			workerKind: "codex-agent",
			contextSnapshot: {
				executionMode: "implementation",
				implementationHandoff: {
					version: 1,
					sourceMessageId: specMessageId,
					implementationPlan,
				},
				implementationPlanProvenance: {
					version: 1,
					sourceMessageId: specMessageId,
					digest: implementationPlanDigest,
				},
			},
		});
		await db.insert(taskRunTodos).values(
			implementationPlan.steps.map((step, index) => ({
				runId: implementationRun.id,
				todoKey: `step-${index + 1}`,
				seq: index + 1,
				title: step.title,
				context: step.systemContext,
				nextAction: step.systemContext,
				taskType: "code_change",
				status: "passed",
				createdBy: "agent",
			})),
		);
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
				expectedEvidenceJson: ["unit_test"],
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
		await expect(getLatestEvidenceCheckDescriptor(task.id)).resolves.toEqual({
			taskId: task.id,
			verificationDocumentId,
			specMessageId,
			specArtifactId: `feature-plan-${specMessageId}`,
			generatedAt: "2026-07-24T00:00:00.000Z",
		});

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
				{
					id: "AC-001",
					status: "passed",
					evidenceIds: ["evidence-1"],
					verificationKind: "automated_test",
					expectedEvidence: ["unit_test"],
					assuranceStatus: "pending",
				},
				{
					id: "AC-002",
					status: "pending",
					evidenceIds: [],
					verificationKind: "automated_test",
					assuranceStatus: "pending",
				},
			],
			implementationPlanTraceability: {
				sourceMessageId: specMessageId,
				digest: implementationPlanDigest,
				runId: implementationRun.id,
				runStatus: "needs_review",
				provenanceStatus: "matched",
				exactTodoMatch: true,
				steps: [
					{ seq: 1, title: "APIを実装する", todoStatus: "passed" },
					{ seq: 2, title: "品質ゲートを通す", todoStatus: "passed" },
				],
				summary: {
					total: 2,
					passed: 2,
					incomplete: 0,
					unaligned: 0,
					extraTodos: 0,
				},
			},
			summary: { total: 2, confirmed: 0, failed: 0, pending: 2 },
			assuranceSummary: {
				automated: 2,
				safePass: 0,
				failed: 0,
				attention: 2,
				fullVerifyStatus: "unknown",
			},
		});
		await expect(
			getEvidenceCheckSnapshot({
				taskId: crypto.randomUUID(),
				verificationDocumentId,
			}),
		).resolves.toBeNull();
	});
});
