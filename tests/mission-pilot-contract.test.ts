import { describe, expect, it } from "vitest";
import { buildMissionPilotQuestionnaireDraft } from "../api/modules/missionPilot/mission-pilot-questionnaire-draft";
import { designQuestionnaireSessionSchema } from "../shared/schemas/design-questionnaire.schema";
import {
	missionPilotAuthorizationV2Schema,
	missionPilotAuthorizationV3Schema,
	missionPilotControlSummarySchema,
	missionPilotSourceRefSchema,
} from "../shared/schemas/mission-pilot.schema";
import { missionPilotPlanProgressSchema } from "../shared/schemas/mission-pilot-plan-progress.schema";
import { formatCountdown } from "../src/modules/missionPilot/components/MissionPilotControlPanel";
import { missionPilotPresentation } from "../src/modules/missionPilot/missionPilotPresentation";
import {
	mergeMissionPilotSummary,
	mergeTaskPreservingMissionPilot,
	optimisticMissionPilotSummary,
} from "../src/modules/missionPilot/missionPilotQueries";

const taskId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const sourceId = "33333333-3333-4333-8333-333333333333";

function summary(version = 0, desiredState: "stopped" | "playing" = "stopped") {
	return missionPilotControlSummarySchema.parse({
		taskId,
		desiredState,
		activityState: desiredState === "playing" ? "running" : "idle",
		phase: desiredState === "playing" ? "running" : "created",
		authorizationVersion: desiredState === "playing" ? 3 : null,
		initialPromptState: desiredState === "playing" ? "sent" : "pending",
		initialPromptMessageId: null,
		activeRunId: null,
		nextWakeAt: null,
		version,
		lastError: null,
		updatedAt: new Date(),
	});
}

describe("Mission Pilot contract", () => {
	it("parses typed Plan Mode progress updates", () => {
		expect(
			missionPilotPlanProgressSchema.parse({
				taskId,
				sessionId,
				phase: "generating_artifacts",
				desiredState: "playing",
				version: 1,
				contextRevision: 2,
				currentStepKey: "view:user_flow",
				steps: [
					{
						key: "view:user_flow",
						ordinal: 4,
						kind: "dedicated_view",
						view: "user_flow",
						status: "running",
						attempt: 1,
						artifactMessageId: null,
						lastError: null,
						startedAt: "2026-07-11T13:00:00.000Z",
						finishedAt: null,
					},
				],
				lastError: null,
				updatedAt: "2026-07-11T13:00:00.000Z",
			}),
		).toMatchObject({ currentStepKey: "view:user_flow" });
	});

	it("accepts historical source refs and the universal Task control ref", () => {
		expect(
			missionPilotSourceRefSchema.parse({
				source: "mission_task_candidate",
				id: sourceId,
			}).source,
		).toBe("mission_task_candidate");
		expect(
			missionPilotSourceRefSchema.parse({
				source: "mission_task_proposal",
				id: sourceId,
			}).source,
		).toBe("mission_task_proposal");
		expect(
			missionPilotSourceRefSchema.parse({ source: "task", id: taskId }).source,
		).toBe("task");
		expect(() =>
			missionPilotSourceRefSchema.parse({ source: "other", id: sourceId }),
		).toThrow();
	});

	it("locks version 2 authorization to local lifecycle scopes without push", () => {
		const authorization = missionPilotAuthorizationV2Schema.parse({
			version: 2,
			sessionId,
			taskId,
			sourceRef: { source: "mission_task_candidate", id: sourceId },
			grantedByAction: "mission_pilot_play",
			grantedAt: new Date().toISOString(),
			scopes: {
				plan: true,
				queue: true,
				implementation: true,
				testMutation: true,
				review: true,
				localCommit: true,
				taskComplete: true,
				taskArchive: true,
				push: false,
			},
			pushPolicy: "never",
		});
		expect(authorization.scopes.push).toBe(false);
	});

	it("locks version 3 authorization to the activation Task Context", () => {
		const authorization = missionPilotAuthorizationV3Schema.parse({
			version: 3,
			sessionId,
			taskId,
			taskRef: { source: "task", id: taskId },
			activationContextRevision: 2,
			activationContextDigest: "digest",
			grantedByAction: "mission_pilot_play",
			grantedAt: new Date().toISOString(),
			scopes: {
				plan: true,
				queue: true,
				implementation: true,
				testMutation: true,
				review: true,
				localCommit: true,
				taskComplete: true,
				taskArchive: true,
				push: false,
			},
			pushPolicy: "never",
		});
		expect(authorization.taskRef.id).toBe(taskId);
		expect(authorization.activationContextRevision).toBe(2);
	});

	it("maps stopped and playing states and ignores stale cache updates", () => {
		expect(missionPilotPresentation(summary())).toMatchObject({
			playing: false,
			canPlay: true,
			canStop: false,
		});
		expect(missionPilotPresentation(summary(1, "playing"))).toMatchObject({
			playing: true,
			canPlay: false,
			canStop: true,
		});
		const task = {
			id: taskId,
			repositoryId: sourceId,
			title: "Pilot",
			status: "draft",
			timeoutSeconds: 3600,
			priority: 0,
			createdAt: new Date(),
			updatedAt: new Date(),
			missionPilot: summary(2, "playing"),
		};
		expect(
			mergeMissionPilotSummary([task], taskId, summary(1))[0]?.missionPilot
				?.version,
		).toBe(2);
	});

	it("shares optimistic busy state and preserves the projection across plain Task updates", () => {
		const stopped = summary(2);
		expect(optimisticMissionPilotSummary(stopped, "play")).toMatchObject({
			desiredState: "playing",
			activityState: "starting",
			version: 3,
		});
		const current = {
			id: taskId,
			repositoryId: sourceId,
			title: "Pilot",
			status: "draft",
			timeoutSeconds: 3600,
			priority: 0,
			createdAt: new Date(),
			updatedAt: new Date(),
			missionPilot: stopped,
		};
		const incoming = { ...current, status: "running", missionPilot: undefined };
		expect(
			mergeTaskPreservingMissionPilot(current, incoming).missionPilot,
		).toEqual(stopped);
	});

	it("blocks Play and offers Stop retry while an attention state still owns a run", () => {
		const attention = {
			...summary(4),
			activityState: "attention" as const,
			phase: "attention",
			activeRunId: "44444444-4444-4444-8444-444444444444",
			lastError: "stop unavailable",
		};
		expect(missionPilotPresentation(attention)).toMatchObject({
			playing: false,
			canPlay: false,
			canStop: true,
		});
	});

	it("offers Stop retry instead of Play after a runtime stop timeout", () => {
		const attention = {
			...summary(5),
			activityState: "attention" as const,
			phase: "attention",
			lastErrorCode: "MISSION_PILOT_RUNTIME_STOP_TIMEOUT",
			lastError: "runtime did not acknowledge stop",
		};
		expect(missionPilotPresentation(attention)).toMatchObject({
			playing: false,
			canPlay: false,
			canStop: true,
		});
	});

	it("formats optional wake countdowns without rendering a permanent timer", () => {
		expect(formatCountdown(65_000)).toBe("01:05");
		expect(formatCountdown(3_661_000)).toBe("1:01:01");
		expect(formatCountdown(0)).toBe("00:00");
	});

	it("builds auditable answers from questionnaire recommendations", () => {
		const questionnaireSessionId = "44444444-4444-4444-8444-444444444444";
		const now = new Date("2026-07-11T10:00:00.000Z");
		const questionnaire = designQuestionnaireSessionSchema.parse({
			id: questionnaireSessionId,
			taskId,
			repositoryId: sourceId,
			sourceBlueprintMessageId: null,
			status: "answering",
			createdAt: now,
			updatedAt: now,
			questionSets: [
				{
					id: "55555555-5555-4555-8555-555555555555",
					sequence: 1,
					validationStatus: "valid",
					rawOutput: null,
					createdAt: now,
					questionnaire: {
						version: 1,
						source: {
							taskId,
							repositoryId: sourceId,
							sourceKind: "plan_mode_intake",
						},
						title: "方針確認",
						summary: "実装方針を選ぶ",
						questionSets: [
							{
								id: "architecture",
								title: "構成",
								category: "architecture",
								purpose: "実装方針を決める",
								questions: [
									{
										id: "api-style",
										topic: "API",
										question: "どの方式にしますか",
										why: "契約を固定するため",
										answerType: "single_choice",
										recommendedAnswerId: "rest",
										options: [
											{ id: "rpc", label: "RPC", tradeoff: "密結合" },
											{
												id: "rest",
												label: "REST",
												tradeoff: "既存規約に合う",
												recommended: true,
											},
										],
										blocks: ["implementation"],
										outputSection: "API",
									},
								],
							},
						],
						openQuestions: [],
						dataModelHandoffNotes: [],
					},
				},
			],
			answers: [],
			reviews: [],
		});
		const draft = buildMissionPilotQuestionnaireDraft(questionnaire, now);
		expect(draft.answers[0]?.selectedOptionIds).toEqual(["rest"]);
		expect(draft.answerEvidence["api-style"]).toMatchObject({
			source: "mission_pilot",
			updatedAt: now,
		});
		expect(draft.answerEvidence["api-style"]?.reason).toContain("REST");
	});
});
