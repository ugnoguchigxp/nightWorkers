import { describe, expect, it } from "vitest";
import {
	asProjectSafetyPolicy,
	collectProjectSessionViews,
	designQuestionnaireMessageIds,
	findComposerRouteTargetByKey,
	isDesignQuestionnaireReadyMessage,
	isImplementationLockedStatus,
	isMissingProjectRoute,
	isMissingSessionRoute,
	isMissionProposalApprovalRequiredError,
	isThinkingModel,
	modelTargetKey,
	parseModelTargetKey,
	projectEvaluationDraftStorageKey,
	projectEvaluationTaskPromptDrafts,
	resolveComposerRouteTarget,
	resolveCurrentProviderModel,
	resolvePlanWorkspaceInitialTab,
} from "../src/modules/nightworkers/components/nightworkers-shell-utils";
import type { NightWorkersWorkspaceState } from "../src/modules/nightworkers/hooks/useNightWorkersWorkspace";
import type { WorkbenchRouteState } from "../src/modules/nightworkers/routing/workbench-route-state";
import type {
	Task,
	TaskMessage,
	WorkbenchArtifactRef,
} from "../src/modules/nightworkers/types";

describe("nightworkers-shell-utils", () => {
	it("asProjectSafetyPolicy maps values correctly", () => {
		expect(asProjectSafetyPolicy(null)).toEqual({});
		expect(asProjectSafetyPolicy([])).toEqual({});
		const policy = { allowedTools: ["git"] };
		expect(asProjectSafetyPolicy(policy)).toBe(policy);
	});

	it("modelTargetKey and parseModelTargetKey work bidirectionally", () => {
		const target = { providerEndpointId: "ep1", model: "m1" };
		const key = modelTargetKey(target);
		expect(parseModelTargetKey(key)).toEqual(target);
		expect(parseModelTargetKey("invalid-json")).toBeNull();
	});

	it("isMissionProposalApprovalRequiredError identifies error payload", () => {
		const err1 = new Error(
			JSON.stringify({ code: "MISSION_PROPOSAL_APPROVAL_REQUIRED" }),
		);
		const err2 = new Error("MISSION_PROPOSAL_APPROVAL_REQUIRED");
		const err3 = new Error("OTHER_ERROR");
		expect(isMissionProposalApprovalRequiredError(err1)).toBe(true);
		expect(isMissionProposalApprovalRequiredError(err2)).toBe(true);
		expect(isMissionProposalApprovalRequiredError(err3)).toBe(false);
		expect(isMissionProposalApprovalRequiredError(null)).toBe(false);
	});

	it("isThinkingModel detects reasoning models", () => {
		expect(isThinkingModel("gpt-5-turbo")).toBe(true);
		expect(isThinkingModel("o1-preview")).toBe(true);
		expect(isThinkingModel("codex-large")).toBe(true);
		expect(isThinkingModel("claude-3-5")).toBe(false);
	});

	it("resolveComposerRouteTarget finds appropriate targets", () => {
		const routes = [
			{
				role: "plan" as const,
				primary: { providerEndpointId: "ep1", model: "m1" },
				fallbacks: [{ providerEndpointId: "ep2", model: "m2" }],
			},
		];
		const available = new Set([
			modelTargetKey({ providerEndpointId: "ep2", model: "m2" }),
		]);
		expect(resolveComposerRouteTarget(routes, available)).toEqual({
			providerEndpointId: "ep2",
			model: "m2",
		});
		expect(resolveComposerRouteTarget(routes, new Set())).toBeNull();
	});

	it("findComposerRouteTargetByKey finds targets correctly", () => {
		const routes = [
			{
				role: "plan" as const,
				primary: { providerEndpointId: "ep1", model: "m1" },
				fallbacks: [],
			},
		];
		const key = modelTargetKey({ providerEndpointId: "ep1", model: "m1" });
		expect(findComposerRouteTargetByKey(routes, key)).toEqual({
			providerEndpointId: "ep1",
			model: "m1",
		});
		expect(findComposerRouteTargetByKey(routes, "other-key")).toBeNull();
	});

	it("isImplementationLockedStatus checkCompleted status", () => {
		expect(isImplementationLockedStatus("completed")).toBe(true);
		expect(isImplementationLockedStatus("running")).toBe(false);
	});

	it("opens planned Plan Mode workspaces on status instead of questionnaire", () => {
		const unplannedArtifact = {
			kind: "plan_mode_workspace",
			metadata: { featurePlanCount: 0 },
		} as WorkbenchArtifactRef;
		const plannedArtifact = {
			kind: "plan_mode_workspace",
			metadata: { featurePlanCount: 1 },
		} as WorkbenchArtifactRef;

		expect(
			resolvePlanWorkspaceInitialTab("questionnaire", unplannedArtifact),
		).toBe("questionnaire");
		expect(
			resolvePlanWorkspaceInitialTab("questionnaire", plannedArtifact),
		).toBe("status");
		expect(resolvePlanWorkspaceInitialTab("blueprint", plannedArtifact)).toBe(
			"blueprint",
		);
	});

	it("isDesignQuestionnaireReadyMessage validates messages", () => {
		const msg1 = {
			metadataJson: { intent: "design_questionnaire_ready" },
		} as unknown as TaskMessage;
		const msg2 = {
			metadataJson: { intent: "other" },
		} as unknown as TaskMessage;
		expect(isDesignQuestionnaireReadyMessage(msg1)).toBe(true);
		expect(isDesignQuestionnaireReadyMessage(msg2)).toBe(false);
	});

	it("designQuestionnaireMessageIds returns message ids", () => {
		const messages = [
			{ id: "1", metadataJson: { intent: "design_questionnaire_ready" } },
			{ id: "2", metadataJson: { intent: "other" } },
		] as unknown as TaskMessage[];
		expect(designQuestionnaireMessageIds(messages)).toEqual(new Set(["1"]));
	});

	it("projectEvaluationDraftStorageKey returns expected key", () => {
		expect(projectEvaluationDraftStorageKey("task-123")).toBe(
			"nightworkers:composer:task-123",
		);
	});

	it("projectEvaluationTaskPromptDrafts returns draft objectives", () => {
		const tasks = [
			{ id: "t1", objective: "Do something" },
			{ id: "t2", objective: "" },
		] as unknown as Task[];
		expect(projectEvaluationTaskPromptDrafts(tasks)).toEqual([
			{ taskId: "t1", prompt: "Do something" },
		]);
	});

	it("collectProjectSessionViews merges sessions correctly", () => {
		const groups = {
			"proj-1": {
				processing: [{ id: "s1" }],
				queue: [{ id: "s2" }],
				archive: [{ id: "s3" }],
			},
		} as unknown as NightWorkersWorkspaceState["groupedSessionViews"];
		expect(collectProjectSessionViews(groups, "proj-1")).toEqual([
			{ id: "s1" },
			{ id: "s2" },
			{ id: "s3" },
		]);
		expect(collectProjectSessionViews(groups, "proj-other")).toEqual([]);
	});

	it("isMissingProjectRoute checks routes", () => {
		const route = {
			kind: "project_detail",
			projectId: "p1",
		} as WorkbenchRouteState;
		const workspace = {
			isProjectsLoading: false,
		} as unknown as NightWorkersWorkspaceState;
		expect(isMissingProjectRoute(route, workspace, null, null)).toBe(true);
	});

	it("isMissingSessionRoute checks routes", () => {
		const route = {
			kind: "session",
			sessionId: "s1",
		} as WorkbenchRouteState;
		const workspace = {
			isSessionsLoading: false,
			sessions: [],
		} as unknown as NightWorkersWorkspaceState;
		expect(isMissingSessionRoute(route, workspace)).toBe(true);
	});

	it("resolveCurrentProviderModel resolves based on activeProvider", () => {
		const ws1 = {
			activeProvider: "openai",
			llmSettings: { OPENAI_MODEL: "gpt-4" },
		} as unknown as NightWorkersWorkspaceState;
		const ws2 = {
			activeProvider: "azure",
			llmSettings: { AZURE_OPENAI_DEPLOYMENT_NAME: "dep-1" },
		} as unknown as NightWorkersWorkspaceState;
		const ws3 = {
			activeProvider: "bedrock",
			llmSettings: { AWS_BEDROCK_MODEL: "bed-1" },
		} as unknown as NightWorkersWorkspaceState;
		const ws4 = {
			activeProvider: "codex",
			llmSettings: { CODEX_MODEL: "codex-1" },
		} as unknown as NightWorkersWorkspaceState;
		const ws5 = {
			activeProvider: "other",
		} as unknown as NightWorkersWorkspaceState;
		expect(resolveCurrentProviderModel(ws1)).toBe("gpt-4");
		expect(resolveCurrentProviderModel(ws2)).toBe("dep-1");
		expect(resolveCurrentProviderModel(ws3)).toBe("bed-1");
		expect(resolveCurrentProviderModel(ws4)).toBe("codex-1");
		expect(resolveCurrentProviderModel(ws5)).toBeNull();
	});
});
