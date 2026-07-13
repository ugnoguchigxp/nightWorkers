import crypto from "node:crypto";
import { count, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import {
	missionPilotContextSnapshots,
	missionPilotSessions,
} from "../api/db/mission-pilot-schema";
import { repositories, taskMessages, tasks } from "../api/db/schema";
import { createSession } from "../api/modules/missionPilot/mission-pilot.repository";
import * as planRepo from "../api/modules/missionPilot/mission-pilot-plan.repository";
import { normalizeMissionPilotPlanReview } from "../shared/schemas/mission-pilot-plan-review.schema";
import { planModeArtifactCorrectionTargetSchema } from "../shared/schemas/plan-mode-artifact-correction.schema";

const repositoryIds: string[] = [];

beforeAll(() => ensureNightWorkersSchema());
afterEach(async () => {
	for (const id of repositoryIds.splice(0)) {
		await db.delete(repositories).where(eq(repositories.id, id));
	}
});

async function createFixture() {
	const repositoryId = crypto.randomUUID();
	const taskId = crypto.randomUUID();
	repositoryIds.push(repositoryId);
	return db.transaction(async (tx) => {
		await tx.insert(repositories).values({
			id: repositoryId,
			name: "Mission Pilot plan pipeline",
			localPath: "/tmp/mission-pilot-plan-pipeline",
			branch: "main",
		});
		const [task] = await tx
			.insert(tasks)
			.values({
				id: taskId,
				repositoryId,
				title: "Generate and review plan",
				objective: "Generate required artifacts and queue the task",
				acceptanceCriteria: "A passing review exists before queue admission",
				status: "ready",
			})
			.returning();
		const session = await createSession(
			{
				task,
				sourceKind: "mission_task_candidate",
				sourceId: crypto.randomUUID(),
			},
			tx,
		);
		return { task, session };
	});
}

describe("Mission Pilot plan pipeline persistence", () => {
	it("keeps reroute tool calls separate from stale Artifact scoring", () => {
		const base = {
			verdict: "reroute" as const,
			summary: "API contract is required before scoring.",
			coverage: {
				goal: "pass" as const,
				scope: "pass" as const,
				acceptanceCriteria: "pass" as const,
				implementationSteps: "pass" as const,
				verification: "pass" as const,
				artifactConsistency: "pass" as const,
				riskAndSafety: "pass" as const,
			},
			findings: [],
			routingToolCall: {
				tool: "edit_plan_artifact_routing" as const,
				expectedRevision: 2,
				idempotencyKey: crypto.randomUUID(),
				changes: [
					{
						view: "api_io_contract" as const,
						decision: "include" as const,
						reason: "HTTP boundary must be explicit.",
					},
				],
			},
		};
		expect(
			normalizeMissionPilotPlanReview({
				...base,
				artifactScores: [],
				revisionTargets: [],
			}).verdict,
		).toBe("reroute");
		expect(() =>
			normalizeMissionPilotPlanReview({
				...base,
				artifactScores: [
					{
						artifactKind: "feature_plan",
						sourceMessageId: crypto.randomUUID(),
						score: 79,
						rationale: "Stale routing score.",
					},
				],
				revisionTargets: [],
			}),
		).toThrow();
	});

	it("limits screen focus to Blueprint corrections", () => {
		expect(
			planModeArtifactCorrectionTargetSchema.safeParse({
				target: "blueprint",
				sourceMessageId: crypto.randomUUID(),
				focus: { kind: "screen", screenIds: ["main"] },
				instruction: "Fix the main screen",
				preserveUnfocusedContent: true,
			}).success,
		).toBe(true);
		expect(
			planModeArtifactCorrectionTargetSchema.safeParse({
				target: "feature_plan",
				sourceMessageId: crypto.randomUUID(),
				focus: { kind: "screen", screenIds: ["main"] },
				instruction: "Invalid focus",
				preserveUnfocusedContent: true,
			}).success,
		).toBe(false);
	});

	it("keeps warning-only improvement requests non-blocking", () => {
		const sourceMessageId = "00000000-0000-4000-8000-000000000001";
		const review = normalizeMissionPilotPlanReview(
			{
				verdict: "revise",
				summary: "Minor verification detail remains.",
				coverage: {
					goal: "pass",
					scope: "pass",
					acceptanceCriteria: "pass",
					implementationSteps: "pass",
					verification: "pass",
					artifactConsistency: "pass",
					riskAndSafety: "pass",
				},
				artifactScores: [
					{
						artifactKind: "feature_plan",
						sourceMessageId,
						score: 80,
						rationale: "実装直結Artifactの合格点を満たしています。",
					},
				],
				findings: [
					{
						severity: "warning",
						artifactKind: "feature_plan",
						sourceId: "plan-1",
						issue: "Optional detail",
						recommendation: "Clarify when convenient",
					},
				],
				revisionTargets: [
					{
						target: "feature_plan",
						sourceMessageId,
						focus: { kind: "artifact" },
						instruction: "Clarify the optional detail",
						preserveUnfocusedContent: true,
					},
				],
			},
			[{ artifactKind: "feature_plan", sourceMessageId }],
		);
		expect(review).toMatchObject({
			verdict: "pass",
			revisionTargets: [],
			coverage: {
				goal: "pass",
				scope: "pass",
				acceptanceCriteria: "pass",
				implementationSteps: "pass",
				verification: "pass",
				artifactConsistency: "pass",
				riskAndSafety: "pass",
			},
		});
	});

	it("keeps low scores informational when there is no major correction target", () => {
		const sourceMessageId = "00000000-0000-4000-8000-000000000009";
		const review = normalizeMissionPilotPlanReview(
			{
				verdict: "revise",
				summary: "The plan can still be implemented safely.",
				coverage: {
					goal: "pass",
					scope: "pass",
					acceptanceCriteria: "pass",
					implementationSteps: "pass",
					verification: "pass",
					artifactConsistency: "pass",
					riskAndSafety: "pass",
				},
				artifactScores: [
					{
						artifactKind: "feature_plan",
						sourceMessageId,
						score: 68,
						rationale: "More detail could be added during implementation.",
					},
				],
				findings: [
					{
						severity: "warning",
						artifactKind: "feature_plan",
						sourceId: sourceMessageId,
						issue: "Repository paths are not listed exhaustively.",
						recommendation: "Inspect the repository before editing.",
					},
				],
				revisionTargets: [],
			},
			[{ artifactKind: "feature_plan", sourceMessageId }],
		);

		expect(review.verdict).toBe("pass");
		expect(review.revisionTargets).toEqual([]);
	});

	it("revises only implementation Artifacts with blocking major findings", () => {
		const featurePlanId = "00000000-0000-4000-8000-000000000011";
		const blueprintId = "00000000-0000-4000-8000-000000000012";
		const review = normalizeMissionPilotPlanReview(
			{
				verdict: "revise",
				summary: "Artifact種別ごとの基準で判定します。",
				coverage: {
					goal: "pass",
					scope: "pass",
					acceptanceCriteria: "pass",
					implementationSteps: "fail",
					verification: "pass",
					artifactConsistency: "pass",
					riskAndSafety: "pass",
				},
				artifactScores: [
					{
						artifactKind: "feature_plan",
						sourceMessageId: featurePlanId,
						score: 79,
						rationale: "実装手順が不足しています。",
					},
					{
						artifactKind: "blueprint",
						sourceMessageId: blueprintId,
						score: 70,
						rationale: "概念図として必要十分です。",
					},
				],
				findings: [
					{
						severity: "blocking",
						artifactKind: "feature_plan",
						sourceId: featurePlanId,
						issue: "A required implementation phase is missing.",
						recommendation: "Add the missing implementation phase.",
					},
				],
				revisionTargets: [
					{
						target: "feature_plan",
						sourceMessageId: featurePlanId,
						focus: { kind: "artifact" },
						instruction: "実装手順を具体化してください。",
						preserveUnfocusedContent: true,
					},
					{
						target: "blueprint",
						sourceMessageId: blueprintId,
						focus: { kind: "artifact" },
						instruction: "任意の改善をしてください。",
						preserveUnfocusedContent: true,
					},
				],
			},
			[
				{ artifactKind: "feature_plan", sourceMessageId: featurePlanId },
				{ artifactKind: "blueprint", sourceMessageId: blueprintId },
			],
		);

		expect(review.verdict).toBe("revise");
		expect(review.revisionTargets).toEqual([
			expect.objectContaining({
				target: "feature_plan",
				sourceMessageId: featurePlanId,
			}),
		]);
	});

	it("keeps low-scoring conceptual Artifacts advisory and non-blocking", () => {
		const blueprintId = "00000000-0000-4000-8000-000000000021";
		const flowId = "00000000-0000-4000-8000-000000000022";
		const featurePlanId = "00000000-0000-4000-8000-000000000023";
		const review = normalizeMissionPilotPlanReview(
			{
				verdict: "revise",
				summary: "Concept artifacts are advisory.",
				coverage: {
					goal: "pass",
					scope: "fail",
					acceptanceCriteria: "pass",
					implementationSteps: "pass",
					verification: "pass",
					artifactConsistency: "fail",
					riskAndSafety: "pass",
				},
				artifactScores: [
					{
						artifactKind: "blueprint",
						sourceMessageId: blueprintId,
						score: 58,
						rationale: "Conceptual mismatch.",
					},
					{
						artifactKind: "user_flow",
						sourceMessageId: flowId,
						score: 55,
						rationale: "Flow detail mismatch.",
					},
					{
						artifactKind: "feature_plan",
						sourceMessageId: featurePlanId,
						score: 86,
						rationale: "Implementation-ready.",
					},
				],
				findings: [
					{
						severity: "blocking",
						artifactKind: "blueprint",
						sourceId: blueprintId,
						issue: "Conceptual mismatch.",
						recommendation: "Review manually.",
					},
				],
				revisionTargets: [
					{
						target: "blueprint",
						sourceMessageId: blueprintId,
						focus: { kind: "artifact" },
						instruction: "Regenerate Blueprint.",
						preserveUnfocusedContent: true,
					},
					{
						target: "user_flow",
						sourceMessageId: flowId,
						focus: { kind: "artifact" },
						instruction: "Regenerate Flow.",
						preserveUnfocusedContent: true,
					},
				],
			},
			[
				{ artifactKind: "blueprint", sourceMessageId: blueprintId },
				{ artifactKind: "user_flow", sourceMessageId: flowId },
				{ artifactKind: "feature_plan", sourceMessageId: featurePlanId },
			],
		);

		expect(review.verdict).toBe("pass");
		expect(review.revisionTargets).toEqual([]);
		expect(review.findings).toEqual([
			expect.objectContaining({
				artifactKind: "blueprint",
				severity: "warning",
			}),
		]);
	});

	it("allows only one database-backed pipeline lease owner", async () => {
		const fixture = await createFixture();
		const firstOwner = `${process.pid}:owner-1`;
		const secondOwner = `${process.pid}:owner-2`;
		await db
			.update(missionPilotSessions)
			.set({ desiredState: "playing" })
			.where(eq(missionPilotSessions.id, fixture.session.id));
		const first = await planRepo.claimPipelineLease({
			taskId: fixture.task.id,
			owner: firstOwner,
			expiresAt: new Date(Date.now() + 60_000),
		});
		const second = await planRepo.claimPipelineLease({
			taskId: fixture.task.id,
			owner: secondOwner,
			expiresAt: new Date(Date.now() + 60_000),
		});
		expect(first?.leaseOwner).toBe(firstOwner);
		expect(second).toBeNull();
		expect(await planRepo.recoverPipelineLeases()).toEqual([]);
		await planRepo.releasePipelineLease(fixture.session.id, firstOwner);
		expect(
			await planRepo.claimPipelineLease({
				taskId: fixture.task.id,
				owner: secondOwner,
				expiresAt: new Date(Date.now() + 60_000),
			}),
		).toMatchObject({ leaseOwner: secondOwner });
		await planRepo.releasePipelineLease(fixture.session.id, secondOwner);
		await planRepo.claimPipelineLease({
			taskId: fixture.task.id,
			owner: "2147483647:dead-owner",
			expiresAt: new Date(Date.now() + 60_000),
		});
		expect(await planRepo.recoverPipelineLeases()).toEqual([
			fixture.session.id,
		]);
	});

	it("keeps Artifact Context append idempotent by source message", async () => {
		const fixture = await createFixture();
		const sourceMessageId = crypto.randomUUID();
		const first = await planRepo.appendPlanContext(
			fixture.session.id,
			"artifact",
			{ stepKey: "feature_plan", sourceMessageId },
		);
		const second = await planRepo.appendPlanContext(
			fixture.session.id,
			"artifact",
			{ stepKey: "feature_plan", sourceMessageId },
		);
		const [snapshotCount] = await db
			.select({ value: count() })
			.from(missionPilotContextSnapshots)
			.where(eq(missionPilotContextSnapshots.sessionId, fixture.session.id));
		expect(first.contextRevision).toBe(2);
		expect(second.contextRevision).toBe(2);
		expect(snapshotCount.value).toBe(2);
	});

	it("rejects a divergent Session without committing an orphan Context snapshot", async () => {
		const fixture = await createFixture();
		await db
			.update(missionPilotSessions)
			.set({ contextDigest: "diverged" })
			.where(eq(missionPilotSessions.id, fixture.session.id));
		await expect(
			planRepo.appendPlanContext(fixture.session.id, "artifact", {
				stepKey: "feature_plan",
				sourceMessageId: crypto.randomUUID(),
			}),
		).rejects.toThrow("diverged");
		const [snapshotCount] = await db
			.select({ value: count() })
			.from(missionPilotContextSnapshots)
			.where(eq(missionPilotContextSnapshots.sessionId, fixture.session.id));
		expect(snapshotCount.value).toBe(1);
	});

	it("turns a failed step into skipped when routing disables it", async () => {
		const fixture = await createFixture();
		const [step] = await planRepo.synchronizePlanSteps(fixture.session.id, [
			{
				key: "data_model",
				kind: "data_model",
				view: "data_model",
				ordinal: 1,
				required: true,
				enabled: true,
				decision: "include",
				status: "pending",
			},
		]);
		await planRepo.failPlanStep(step.id, "provider unavailable");
		const [skipped] = await planRepo.synchronizePlanSteps(fixture.session.id, [
			{
				key: "data_model",
				kind: "data_model",
				view: "data_model",
				ordinal: 1,
				required: true,
				enabled: false,
				decision: "include",
				status: "skipped",
			},
		]);
		expect(skipped).toMatchObject({ status: "skipped" });
	});

	it("reconciles a failed step to completed when its Artifact already exists", async () => {
		const fixture = await createFixture();
		const pendingStep = {
			key: "feature_plan",
			kind: "feature_plan" as const,
			view: "feature_plan" as const,
			ordinal: 1,
			required: true,
			enabled: true,
			decision: "include" as const,
			status: "pending" as const,
		};
		const [step] = await planRepo.synchronizePlanSteps(fixture.session.id, [
			pendingStep,
		]);
		await planRepo.failPlanStep(step.id, "response lost after persistence");
		const [completed] = await planRepo.synchronizePlanSteps(
			fixture.session.id,
			[{ ...pendingStep, status: "completed" }],
		);
		expect(completed).toMatchObject({ status: "completed" });
	});

	it("claims each step once and advances Context after persisted evidence", async () => {
		const fixture = await createFixture();
		const [message] = await db
			.insert(taskMessages)
			.values({
				id: crypto.randomUUID(),
				taskId: fixture.task.id,
				role: "assistant",
				content: "# Feature Plan",
				messageType: "markdown_document",
				metadataJson: { intent: "feature_plan" },
			})
			.returning();
		const [step] = await planRepo.synchronizePlanSteps(fixture.session.id, [
			{
				key: "feature_plan",
				kind: "feature_plan",
				view: "feature_plan",
				ordinal: 1,
				required: true,
				enabled: true,
				decision: "include",
				status: "pending",
			},
		]);
		const claimed = await planRepo.claimPlanStep(step.id);
		expect(claimed).toMatchObject({ status: "running", attempt: 1 });
		expect(await planRepo.claimPlanStep(step.id)).toBeNull();

		const context = await planRepo.appendPlanContext(
			fixture.session.id,
			"artifact",
			{ stepKey: "feature_plan", sourceMessageId: message.id },
		);
		expect(context).toMatchObject({ contextRevision: 2 });
		await planRepo.completePlanStep(step.id, {
			artifactMessageId: message.id,
			evidence: {
				sourceMessageId: message.id,
				contextRevision: context?.contextRevision,
			},
		});
		expect(await planRepo.listPlanSteps(fixture.session.id)).toEqual([
			expect.objectContaining({
				status: "completed",
				artifactMessageId: message.id,
			}),
		]);
	});

	it("stores review evidence against the exact Context revision", async () => {
		const fixture = await createFixture();
		const [message] = await db
			.insert(taskMessages)
			.values({
				id: crypto.randomUUID(),
				taskId: fixture.task.id,
				role: "assistant",
				content: "# Feature Plan",
				messageType: "markdown_document",
				metadataJson: { intent: "feature_plan" },
			})
			.returning();
		await planRepo.createPlanReview({
			sessionId: fixture.session.id,
			contextRevision: fixture.session.contextRevision,
			contextDigest: fixture.session.contextDigest,
			featurePlanMessageId: message.id,
			attempt: 1,
			review: {
				verdict: "pass",
				summary: "Implementation-ready",
				coverage: {
					goal: "pass",
					scope: "pass",
					acceptanceCriteria: "pass",
					implementationSteps: "pass",
					verification: "pass",
					artifactConsistency: "pass",
					riskAndSafety: "pass",
				},
				findings: [],
				revisionTargets: [],
			},
		});
		expect(
			await planRepo.getLatestPlanReview(fixture.session.id),
		).toMatchObject({
			verdict: "pass",
			contextRevision: 1,
			contextDigest: fixture.session.contextDigest,
		});
	});

	it("persists and advances an idempotent Artifact correction run", async () => {
		const fixture = await createFixture();
		const [source] = await db
			.insert(taskMessages)
			.values({
				id: crypto.randomUUID(),
				taskId: fixture.task.id,
				role: "assistant",
				content: "# Blueprint",
				messageType: "markdown_document",
				metadataJson: { intent: "mock_blueprint" },
			})
			.returning();
		const review = await planRepo.createPlanReview({
			sessionId: fixture.session.id,
			contextRevision: fixture.session.contextRevision,
			contextDigest: fixture.session.contextDigest,
			featurePlanMessageId: source.id,
			attempt: 1,
			review: {
				verdict: "revise",
				summary: "Blueprint correction required",
				coverage: {
					goal: "pass",
					scope: "fail",
					acceptanceCriteria: "pass",
					implementationSteps: "fail",
					verification: "pass",
					artifactConsistency: "fail",
					riskAndSafety: "pass",
				},
				findings: [
					{
						severity: "blocking",
						artifactKind: "blueprint",
						sourceId: source.id,
						issue: "Wrong screen placement",
						recommendation: "Integrate the screen",
					},
				],
				revisionTargets: [
					{
						target: "blueprint",
						sourceMessageId: source.id,
						focus: { kind: "artifact" },
						instruction: "Integrate the screen",
						preserveUnfocusedContent: true,
					},
					{
						target: "user_flow",
						sourceMessageId: source.id,
						focus: { kind: "artifact" },
						instruction: "Clarify the conceptual flow",
						preserveUnfocusedContent: true,
					},
				],
			},
		});
		const input = {
			sessionId: fixture.session.id,
			taskId: fixture.task.id,
			planReviewId: review.id,
			contextRevision: fixture.session.contextRevision,
			contextDigest: fixture.session.contextDigest,
			targets: review.reviewJson.revisionTargets,
		};
		expect(await planRepo.createArtifactCorrectionRuns(input)).toHaveLength(2);
		expect(await planRepo.createArtifactCorrectionRuns(input)).toHaveLength(2);
		const [run, pendingConcept] =
			await planRepo.listArtifactCorrectionRunsForReview(review.id);
		expect(await planRepo.claimArtifactCorrectionRun(run.id)).toMatchObject({
			status: "running",
			attempt: 1,
		});
		const [result] = await db
			.insert(taskMessages)
			.values({
				id: crypto.randomUUID(),
				taskId: fixture.task.id,
				role: "assistant",
				content: "# Corrected Blueprint",
				messageType: "markdown_document",
			})
			.returning();
		await planRepo.recordArtifactCorrectionResult(run.id, {
			resultMessageId: result.id,
		});
		await planRepo.markArtifactCorrectionValidating(run.id);
		expect(await planRepo.applyArtifactCorrectionRun(run.id, 2)).toMatchObject({
			status: "applied",
			outputContextRevision: 2,
		});
		const secondReview = await planRepo.createPlanReview({
			sessionId: fixture.session.id,
			contextRevision: fixture.session.contextRevision,
			contextDigest: fixture.session.contextDigest,
			featurePlanMessageId: source.id,
			attempt: 2,
			review: {
				verdict: "revise",
				summary: "The same Artifact still has a major mismatch.",
				coverage: {
					goal: "pass",
					scope: "fail",
					acceptanceCriteria: "pass",
					implementationSteps: "fail",
					verification: "pass",
					artifactConsistency: "fail",
					riskAndSafety: "pass",
				},
				findings: [],
				revisionTargets: [],
			},
		});
		expect(
			await planRepo.createArtifactCorrectionRuns({
				...input,
				planReviewId: secondReview.id,
				targets: [
					{
						target: "blueprint",
						sourceMessageId: result.id,
						focus: { kind: "artifact" },
						instruction: "Regenerate Blueprint again",
						preserveUnfocusedContent: true,
					},
				],
			}),
		).toEqual([]);
		await planRepo.supersedeConceptArtifactCorrectionRunsForReview(review.id);
		expect(
			await planRepo.getArtifactCorrectionRun(pendingConcept.id),
		).toMatchObject({ status: "superseded" });
	});
});
