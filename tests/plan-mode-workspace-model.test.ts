import { describe, expect, it } from "vitest";
import type {
	DesignQuestionnaireSession,
	GeneralSettings,
	PlanModeWorkspace,
	TaskMessage,
} from "../src/modules/nightworkers/types";
import {
	getPlanModeCapabilities,
	isDesignAssemblyReady,
	resolveLatestPlanWorkspaceTab,
	resolvePlanWorkspaceViewDecisions,
	selectPlanModeWorkspaceMessages,
} from "../src/modules/specification/planModeWorkspaceModel";

describe("planModeWorkspaceModel", () => {
	it("selectPlanModeWorkspaceMessages filters messages correctly", () => {
		const taskMessages = [
			{
				id: "msg-1",
				messageType: "markdown_document",
				metadataJson: { intent: "feature_plan" },
				createdAt: "2026-07-08T00:00:00Z",
			},
			{
				id: "msg-2",
				messageType: "markdown_document",
				metadataJson: { intent: "app_blueprint", appBlueprint: { name: "bp" } },
				createdAt: "2026-07-08T00:00:01Z",
			},
		] as unknown as TaskMessage[];

		const result = selectPlanModeWorkspaceMessages({
			taskMessages,
			activityArtifacts: [],
			generatedMessages: [],
			workspace: {
				blueprintArtifacts: [{ sourceMessageId: "msg-2" }],
			} as unknown as PlanModeWorkspace,
		});

		expect(result.designDocMessages).toHaveLength(1);
		expect(result.activeFeaturePlanMessage?.id).toBe("msg-1");
		expect(result.blueprintMessages).toHaveLength(1);
		expect(result.activeBlueprintMessage?.id).toBe("msg-2");
		expect(result.activeBlueprintSourceMessageId).toBe("msg-2");
	});

	it("restores the latest persisted design artifact tab from workspace metadata", () => {
		const workspace = {
			featurePlanArtifacts: [
				{
					id: "feature-plan-msg-1",
					kind: "feature_plan",
					title: "Feature Plan",
					sourceMessageId: "11111111-1111-4111-8111-111111111111",
					createdAt: "2026-07-08T00:00:00Z",
				},
			],
			blueprintArtifacts: [
				{
					id: "blueprint-msg-2",
					kind: "blueprint",
					title: "Blueprint",
					sourceMessageId: "22222222-2222-4222-8222-222222222222",
					createdAt: "2026-07-08T00:00:01Z",
				},
			],
			dataModelArtifacts: [
				{
					id: "data-model-msg-3",
					kind: "data_model",
					title: "Data Model",
					sourceMessageId: "33333333-3333-4333-8333-333333333333",
					createdAt: "2026-07-08T00:00:03Z",
				},
			],
			dedicatedViewArtifacts: [
				{
					id: "api-msg-4",
					kind: "api_io_contract",
					title: "API Contract",
					sourceMessageId: "44444444-4444-4444-8444-444444444444",
					createdAt: "2026-07-08T00:00:02Z",
				},
			],
		} as unknown as PlanModeWorkspace;

		expect(resolveLatestPlanWorkspaceTab(workspace)).toBe("data-model");
	});

	it("prefers persisted workspace view decisions over message-derived decisions", () => {
		const workspace = {
			viewDecisions: [
				{
					view: "api_io_contract",
					decision: "include",
					reason: "API契約変更があります。",
				},
			],
		} as PlanModeWorkspace;
		const fallback = [
			{
				view: "blueprint",
				decision: "omit" as const,
				reason: "stale message decision",
			},
		];

		expect(resolvePlanWorkspaceViewDecisions(workspace, fallback)).toEqual([
			{
				view: "api_io_contract",
				decision: "include",
				reason: "API契約変更があります。",
			},
		]);
		expect(resolvePlanWorkspaceViewDecisions(null, fallback)).toEqual(fallback);
	});

	it("restores generated workspace views as included decisions over stale omit decisions", () => {
		const workspace = {
			questionnaireSessions: [],
			blueprintArtifacts: [
				{
					id: "blueprint-msg-1",
					kind: "blueprint",
					title: "Blueprint",
					sourceMessageId: "11111111-1111-4111-8111-111111111111",
					createdAt: "2026-07-08T00:00:00Z",
				},
			],
			dataModelArtifacts: [],
			dedicatedViewArtifacts: [
				{
					id: "api-msg-2",
					kind: "api_io_contract",
					title: "API Contract",
					sourceMessageId: "22222222-2222-4222-8222-222222222222",
					createdAt: "2026-07-08T00:00:01Z",
				},
			],
			viewDecisions: [
				{
					view: "blueprint",
					decision: "omit",
					reason: "UI 方針の再設計ではありません。",
				},
				{
					view: "api_io_contract",
					decision: "omit",
					reason: "API 契約変更ではありません。",
				},
				{
					view: "data_model",
					decision: "omit",
					reason: "データモデル変更ではありません。",
				},
			],
		} as unknown as PlanModeWorkspace;

		expect(resolvePlanWorkspaceViewDecisions(workspace, [])).toEqual([
			{
				view: "blueprint",
				decision: "include",
				reason: "生成済みのView artifactがあります。",
			},
			{
				view: "api_io_contract",
				decision: "include",
				reason: "生成済みのView artifactがあります。",
			},
			{
				view: "data_model",
				decision: "omit",
				reason: "データモデル変更ではありません。",
			},
		]);
	});

	it("isDesignAssemblyReady checks session status and list", () => {
		const session = {
			id: "s1",
			status: "review_ready",
		} as unknown as DesignQuestionnaireSession;
		expect(isDesignAssemblyReady(session, new Set())).toBe(true);

		const otherSession = {
			id: "s2",
			status: "draft",
		} as unknown as DesignQuestionnaireSession;
		expect(isDesignAssemblyReady(otherSession, new Set(["s2"]))).toBe(true);
		expect(isDesignAssemblyReady(otherSession, new Set())).toBe(false);
		expect(isDesignAssemblyReady(null, new Set())).toBe(false);
	});

	it("getPlanModeCapabilities fallback when settings are empty", () => {
		expect(getPlanModeCapabilities(null)).toEqual({
			questionnaire: true,
			feature_plan: true,
			user_flow: true,
			blueprint: true,
			data_model: true,
			api_io_contract: true,
			activity_flow: true,
			sequence_flow: true,
			zod_schema_design: true,
		});

		const settings = {
			planMode: {
				capabilities: {
					questionnaire: false,
					feature_plan: true,
				},
			},
		} as GeneralSettings;
		expect(getPlanModeCapabilities(settings)).toEqual({
			questionnaire: false,
			feature_plan: true,
		});
	});
});
