import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { missionPilotDetailSchema } from "../shared/schemas/mission-pilot.schema";
import { MissionPilotDetailView } from "../src/modules/nightworkers/components/project-detail/mission-pilot/MissionPilotDetailModal";

const missionId = "11111111-1111-4111-8111-111111111111";
const repositoryId = "22222222-2222-4222-8222-222222222222";
const planningResultId = "33333333-3333-4333-8333-333333333333";
const candidateId = "44444444-4444-4444-8444-444444444444";

describe("Mission Pilot cockpit", () => {
	it("renders read-only objectives, candidates, attention, and events", () => {
		const detail = missionPilotDetailSchema.parse({
			mission: {
				id: missionId,
				repositoryId,
				title: "Mission Pilot MVP",
				goalText: "Missionを継続実行する",
				nonGoals: [],
				status: "review_pending",
				sourceGoalIds: [],
				latestPlanningResultId: planningResultId,
				statusReason: "review_ready",
				createdAt: "2026-07-10T00:00:00.000Z",
				updatedAt: "2026-07-10T00:00:00.000Z",
			},
			source: {
				type: "project_evaluation",
				refId: candidateId,
				evaluationId: planningResultId,
				label: "Project Evaluation improvement",
			},
			objectives: [
				{
					id: "55555555-5555-4555-8555-555555555555",
					missionId,
					repositoryId,
					planningResultId,
					externalObjectiveId: "objective-1",
					title: "Objectiveを追跡する",
					completionCriteria: ["証拠が表示される"],
					verificationGate: ["focused test"],
					status: "pending",
					evidenceRefs: [],
					statusReason: null,
					createdAt: "2026-07-10T00:00:00.000Z",
					updatedAt: "2026-07-10T00:00:00.000Z",
				},
			],
			taskCandidates: [
				{
					source: "mission_task_proposal",
					missionId,
					planningResultId,
					taskCandidateId: candidateId,
					workPackageId: "wp-1",
					decompositionTaskId: "task-1",
					status: "proposed",
					title: "承認対象TaskCandidate",
					summary: "Queue投入前に確認する",
					initialPrompt: "実装する",
					expectedOutcome: "完了する",
					implementationFocus: [],
					acceptanceCriteria: [],
					verificationGate: [],
					dependencies: [],
					targetFilesOrModules: [],
					risk: "medium",
					approvalRequired: true,
					scheduling: {
						executionType: "exclusive",
						reason: "shared files",
						sequenceGroupId: null,
						sequenceOrder: null,
						dependsOnTaskIds: [],
					},
					taskId: null,
					createdAt: "2026-07-10T00:00:00.000Z",
					updatedAt: "2026-07-10T00:00:00.000Z",
				},
			],
			legacyTaskProposals: [],
			approvals: [],
			missionTasks: [],
			activeAutopilotGrant: null,
			latestAutopilotGrant: null,
			latestEvaluation: null,
			latestPlanRevision: null,
			replanSuggestions: [],
			attentionItems: [
				{
					id: `derived:approval:${candidateId}`,
					type: "approval_required",
					severity: "blocking",
					title: "承認対象TaskCandidate",
					summary: "人間の承認が必要です",
					targetId: candidateId,
					persisted: false,
				},
			],
			events: [
				{
					id: "66666666-6666-4666-8666-666666666666",
					missionId,
					repositoryId,
					missionTaskId: null,
					eventType: "mission_decomposed",
					summary: "Mission decompositionが完了しました",
					actor: { type: "system", id: null, displayName: "Mission Planner" },
					payload: null,
					evidenceRefs: [],
					sourceKind: "planning_result",
					sourceId: planningResultId,
					sourceVersion: "v1",
					occurredAt: "2026-07-10T00:00:00.000Z",
					createdAt: "2026-07-10T00:00:00.000Z",
				},
			],
			executionSummary: {
				approved: 0,
				queued: 0,
				running: 0,
				awaitingEvaluation: 0,
				satisfied: 0,
				blocked: 0,
				failed: 0,
			},
			nextRecommendedAction: {
				type: "review_task_candidates",
				reason: "承認が必要なTaskCandidateがあります。",
				requiresHuman: true,
			},
		});

		const markup = renderToStaticMarkup(
			<MissionPilotDetailView detail={detail} />,
		);
		expect(markup).toContain("Objectiveを追跡する");
		expect(markup).toContain("承認対象TaskCandidate");
		expect(markup).toContain("Mission decompositionが完了しました");
		expect(markup).not.toContain("承認する");
		expect(markup).not.toContain("Queue投入する");
	});
});
