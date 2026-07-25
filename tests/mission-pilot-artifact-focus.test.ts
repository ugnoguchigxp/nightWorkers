import { describe, expect, it } from "vitest";
import { resolveMissionPilotArtifactFocus as resolveMissionPilotArtifactFocusForRoute } from "../src/modules/missionPilot";
import type { WorkbenchRouteState } from "../src/modules/nightworkers/routing/workbench-route-state";
import type {
	PlanModeWorkspace,
	Task,
	WorkbenchArtifactRef,
} from "../src/modules/nightworkers/types";

function resolveMissionPilotArtifactFocus(
	input: Omit<
		Parameters<typeof resolveMissionPilotArtifactFocusForRoute>[0],
		"routeState"
	>,
	routeState: WorkbenchRouteState = {
		kind: "session",
		sessionId: input.activeSession?.id || "task-1",
		artifact: null,
	},
) {
	return resolveMissionPilotArtifactFocusForRoute({ ...input, routeState });
}

function task(phase: string, desiredState: "playing" | "stopped" = "playing") {
	return {
		id: "task-1",
		repositoryId: "repo-1",
		title: "Mission Pilot focus",
		status: "running",
		timeoutSeconds: 600,
		priority: 0,
		createdAt: "2026-07-13T00:00:00.000Z",
		updatedAt: "2026-07-13T00:00:00.000Z",
		missionPilot: {
			taskId: "00000000-0000-4000-8000-000000000001",
			desiredState,
			activityState: desiredState === "playing" ? "running" : "idle",
			phase,
			authorizationVersion: 3,
			initialPromptState: "sent",
			initialPromptMessageId: null,
			activeRunId: null,
			nextWakeAt: null,
			version: 1,
			lastError: null,
			queueHandoff: null,
			preQueueDiagnostic: null,
			updatedAt: "2026-07-13T00:00:00.000Z",
		},
	} satisfies Task;
}

function planArtifact(workspace: PlanModeWorkspace): WorkbenchArtifactRef {
	return {
		id: "plan-mode-workspace-task-1",
		taskId: "task-1",
		kind: "plan_mode_workspace",
		title: "Plan Mode Workspace",
		source: { type: "task_message", messageId: "message-1" },
		createdAt: workspace.generatedAt,
		metadata: { planModeWorkspace: workspace },
	};
}

function workspace(
	overrides: Partial<PlanModeWorkspace> = {},
): PlanModeWorkspace {
	return {
		taskId: "task-1",
		repositoryId: "repo-1",
		generatedAt: "2026-07-13T00:00:00.000Z",
		featurePlanArtifacts: [],
		blueprintArtifacts: [],
		dataModelArtifacts: [],
		dedicatedViewArtifacts: [],
		questionnaireSessions: [],
		decisionReviews: [],
		implementationReferences: [],
		viewDecisions: [],
		routing: {} as PlanModeWorkspace["routing"],
		...overrides,
	};
}

describe("resolveMissionPilotArtifactFocus", () => {
	it("focuses Questionnaire while the latest Questionnaire still needs answers", () => {
		const artifact = planArtifact(
			workspace({
				questionnaireSessions: [
					{
						id: "questionnaire-1",
						sourceBlueprintMessageId: null,
						status: "answering",
						answeredCount: 1,
						totalQuestionCount: 2,
					},
				],
			}),
		);

		expect(
			resolveMissionPilotArtifactFocus({
				activeSession: task("waiting_intervention"),
				activeArtifactRefs: [artifact],
			}),
		).toMatchObject({ kind: "plan_mode_workspace", tab: "questionnaire" });
	});

	it("focuses the newest completed design artifact", () => {
		const artifact = planArtifact(
			workspace({
				questionnaireSessions: [
					{
						id: "questionnaire-1",
						sourceBlueprintMessageId: null,
						status: "accepted",
						answeredCount: 2,
						totalQuestionCount: 2,
					},
				],
				blueprintArtifacts: [
					{
						id: "blueprint-1",
						kind: "blueprint",
						title: "Blueprint",
						sourceMessageId: "message-blueprint",
						createdAt: "2026-07-13T00:01:00.000Z",
					},
				],
				dedicatedViewArtifacts: [
					{
						id: "user-flow-1",
						kind: "user_flow",
						title: "User Flow",
						sourceMessageId: "message-user-flow",
						createdAt: "2026-07-13T00:02:00.000Z",
					},
				],
			}),
		);

		expect(
			resolveMissionPilotArtifactFocus({
				activeSession: task("plan_running"),
				activeArtifactRefs: [artifact],
			}),
		).toEqual({
			key: "task-1:plan-artifact:user-flow-1",
			kind: "plan_mode_workspace",
			tab: "user-flow",
		});
	});

	it.each([
		["implementation_starting", "todo"],
		["implementing", "todo"],
		["review_preparing", "review_status"],
		["reviewing", "review_status"],
	] as const)("maps %s to %s", (phase, kind) => {
		expect(
			resolveMissionPilotArtifactFocus({
				activeSession: task(phase),
				activeArtifactRefs: [],
			}),
		).toMatchObject({ kind });
	});

	it.each([
		["implementation", "todo", "implementation"],
		["review", "review_status", "review"],
	] as const)("focuses %s from the live Run when the Mission Pilot phase is stale", (executionMode, kind, keySuffix) => {
		expect(
			resolveMissionPilotArtifactFocus({
				activeSession: task("queued"),
				activeArtifactRefs: [],
				latestRun: {
					id: `run-${executionMode}-1`,
					taskId: "task-1",
					status: "running",
					workerKind: "agent",
					timeoutSeconds: 600,
					contextSnapshot: { executionMode },
					startedAt: "2026-07-13T00:03:00.000Z",
					createdAt: "2026-07-13T00:03:00.000Z",
					updatedAt: "2026-07-13T00:03:00.000Z",
				},
			}),
		).toEqual({ key: `task-1:${keySuffix}`, kind });
	});

	it("does not use a terminal implementation Run as the current focus", () => {
		expect(
			resolveMissionPilotArtifactFocus({
				activeSession: task("queued"),
				activeArtifactRefs: [],
				latestRun: {
					id: "run-implementation-1",
					taskId: "task-1",
					status: "completed",
					workerKind: "agent",
					timeoutSeconds: 600,
					contextSnapshot: { executionMode: "implementation" },
					startedAt: "2026-07-13T00:03:00.000Z",
					createdAt: "2026-07-13T00:03:00.000Z",
					updatedAt: "2026-07-13T00:04:00.000Z",
				},
			}),
		).toBeNull();
	});

	it("does not take focus while Mission Pilot is stopped", () => {
		expect(
			resolveMissionPilotArtifactFocus({
				activeSession: task("testing", "stopped"),
				activeArtifactRefs: [],
			}),
		).toBeNull();
	});

	it.each([
		{
			kind: "overview",
			range: "30d",
			projectId: "repo-1",
		},
		{
			kind: "project_detail",
			projectId: "repo-1",
			tab: "mission",
		},
	] satisfies WorkbenchRouteState[])("does not take focus away from a project screen ($kind)", (routeState) => {
		expect(
			resolveMissionPilotArtifactFocus(
				{
					activeSession: task("reviewing"),
					activeArtifactRefs: [],
				},
				routeState,
			),
		).toBeNull();
	});
});
