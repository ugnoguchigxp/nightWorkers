import { describe, expect, it } from "vitest";
import {
	restoreEvidenceCheckArtifactRef,
	restorePlanModeWorkspaceArtifactRefs,
} from "../src/modules/nightworkers/hooks/useNightWorkersSessionPresentation";
import type {
	PlanModeWorkspace,
	WorkbenchArtifactRef,
} from "../src/modules/nightworkers/types";
import { buildTask } from "./helpers/nightworkers-fixtures";

const task = buildTask({
	id: "11111111-1111-4111-8111-111111111111",
	repositoryId: "22222222-2222-4222-8222-222222222222",
	updatedAt: "2026-07-08T00:00:00.000Z",
});

describe("useNightWorkersSessionPresentation helpers", () => {
	it("restores Evidence Check as a first-class artifact ref", () => {
		const refs = restoreEvidenceCheckArtifactRef({
			refs: [],
			activeSession: task,
			taskMessages: [
				{
					id: "33333333-3333-4333-8333-333333333333",
					taskId: task.id,
					runId: null,
					role: "assistant",
					content: "# Feature Plan",
					messageType: "markdown_document",
					metadataJson: {
						intent: "feature_plan",
						verificationDocumentId: "44444444-4444-4444-8444-444444444444",
						verificationSidecarMessageId:
							"55555555-5555-4555-8555-555555555555",
					},
					createdAt: "2026-07-08T00:00:00.000Z",
				},
			],
		});

		expect(refs).toContainEqual(
			expect.objectContaining({
				id: "evidence-check-44444444-4444-4444-8444-444444444444",
				kind: "evidence_check",
			}),
		);
	});

	it("restores the Plan Mode Workspace ref from persisted workspace state", () => {
		const refs: WorkbenchArtifactRef[] = [
			{
				id: `plan-mode-workspace-${task.id}`,
				taskId: task.id,
				kind: "plan_mode_workspace",
				title: "Plan Mode Workspace",
				summary: "stale",
				source: {
					type: "task_message",
					messageId: "11111111-1111-4111-8111-111111111111",
				},
				createdAt: "2026-07-08T00:00:05.000Z",
				metadata: { initialTab: "status" },
			},
			{
				id: "review-status-1",
				taskId: task.id,
				kind: "review_status",
				title: "Review Status",
				summary: "review",
				source: { type: "review_result", reviewId: "review-1" },
				createdAt: "2026-07-08T00:00:04.000Z",
			},
		];
		const workspace = {
			taskId: task.id,
			repositoryId: task.repositoryId,
			generatedAt: "2026-07-08T00:00:06.000Z",
			featurePlanArtifacts: [
				{
					id: "feature-plan-1",
					kind: "feature_plan",
					title: "Feature Plan",
					sourceMessageId: "33333333-3333-4333-8333-333333333333",
					createdAt: "2026-07-08T00:00:01.000Z",
				},
			],
			blueprintArtifacts: [],
			dataModelArtifacts: [],
			dedicatedViewArtifacts: [
				{
					id: "api-io-1",
					kind: "api_io_contract",
					title: "API Contract",
					sourceMessageId: "44444444-4444-4444-8444-444444444444",
					createdAt: "2026-07-08T00:00:02.000Z",
				},
			],
			questionnaireSessions: [],
			decisionReviews: [],
			implementationReferences: [],
		} as PlanModeWorkspace;

		const restored = restorePlanModeWorkspaceArtifactRefs({
			refs,
			activeSession: task,
			activePlanModeWorkspace: workspace,
		});
		const planWorkspace = restored.find(
			(ref) => ref.kind === "plan_mode_workspace",
		);

		expect(restored.map((ref) => ref.id)).toEqual([
			"review-status-1",
			`plan-mode-workspace-${task.id}`,
		]);
		expect(planWorkspace?.metadata).toEqual(
			expect.objectContaining({ initialTab: "api-io-contract" }),
		);
		expect(planWorkspace?.source).toEqual({
			type: "task_message",
			messageId: "44444444-4444-4444-8444-444444444444",
		});
	});
});
