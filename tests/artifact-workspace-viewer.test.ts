import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TaskMessage } from "../src/modules/nightworkers/types";
import {
	isDataModelMessage,
	isNormalBlueprintMessage,
	mergeWorkspaceTaskMessages,
} from "../src/modules/nightworkers/workbenchSelectors";
import {
	buildPlanModeArtifactContext,
	buildVisiblePlanWorkspaceTabs,
	extractViewDecisions,
	getPlanWorkspaceTabLabel,
	PlanModeWorkspaceViewer,
	resolveInitialPlanWorkspaceTabUpdate,
	selectActiveDedicatedArtifact,
	shouldShowQuestionnaireStartAction,
	WorkspaceBlueprintPreview,
} from "../src/modules/planMode";
import { selectPlanModeWorkspaceMessages } from "../src/modules/specification";
import { representativeMockBlueprint } from "./fixtures/mock-blueprint";
import {
	buildActivityArtifact,
	buildBlueprintMessage,
	buildTaskMessage,
} from "./helpers/nightworkers-fixtures";

describe("mergeWorkspaceTaskMessages", () => {
	it("does not let synthetic activity artifact messages override persisted Blueprint messages", () => {
		const createdAt = new Date().toISOString();
		const taskMessage = buildBlueprintMessage({
			id: "message-blueprint-1",
			taskId: "task-1",
			content: "# Blueprint",
			metadataJson: {
				intent: "app_blueprint",
				artifactRef: {
					artifactId: "artifact-blueprint-1",
					kind: "app_blueprint",
					version: 1,
				},
				appBlueprint: { id: "blueprint-1", name: "Blueprint", screens: [] },
			},
			createdAt,
		});
		const activityArtifact = buildActivityArtifact({
			id: "artifact-blueprint-1",
			taskId: "task-1",
			title: "Blueprint",
			contentText: JSON.stringify({
				id: "blueprint-1",
				name: "Blueprint",
				screens: [],
			}),
			metadataJson: {
				intent: "app_blueprint",
				appBlueprint: { id: "blueprint-1", name: "Blueprint", screens: [] },
			},
			createdAt,
		});

		const messages = mergeWorkspaceTaskMessages({
			taskMessages: [taskMessage],
			activityArtifacts: [activityArtifact],
			generatedMessages: [],
		});

		expect(messages.map((message) => message.id)).toEqual([
			"message-blueprint-1",
		]);
	});
});

describe("selectActiveDedicatedArtifact", () => {
	it("selects the latest regenerated API Contract artifact", () => {
		const artifact = selectActiveDedicatedArtifact(
			[
				{
					id: "api-contract-old",
					kind: "api_io_contract",
					title: "Old Markdown API Contract",
					sourceMessageId: "message-old",
					createdAt: 1783224281,
				},
				{
					id: "api-contract-new",
					kind: "api_io_contract",
					title: "OpenAPI API Contract",
					sourceMessageId: "message-new",
					createdAt: 1783230373,
				},
			],
			"api_io_contract",
		);

		expect(artifact?.sourceMessageId).toBe("message-new");
	});
});

describe("buildPlanModeArtifactContext", () => {
	it("targets the currently open Blueprint tab for composer regeneration instructions", () => {
		const context = buildPlanModeArtifactContext({
			sessionId: "task-1",
			activeTab: "blueprint",
			activeBlueprintMessage: {
				id: "message-blueprint-1",
				content: "# Blueprint\nTodo registration and list only.",
			},
			activeBlueprintSourceMessageId: "message-blueprint-1",
			featurePlanMessage: {
				id: "message-feature-plan",
				content: "# Feature Plan",
			},
			readyQuestionnaireSessionId: "questionnaire-1",
		});

		expect(context).toMatchObject({
			artifactId: "plan-mode-workspace-task-1:blueprint",
			kind: "plan_mode_workspace",
			title: "Blueprint",
			source: { type: "task_message", messageId: "message-blueprint-1" },
			metadata: {
				instructionMode: "regenerate_artifact",
				planModeTarget: "blueprint",
				displayKind: "PLAN_MODE:BLUEPRINT",
				initialTab: "blueprint",
				questionnaireSessionId: "questionnaire-1",
				featurePlanMessageId: "message-feature-plan",
				sourceBlueprintMessageId: "message-blueprint-1",
			},
		});
		expect(context?.summary).toContain("Todo registration");
	});

	it("does not create a regeneration context for status or questionnaire tabs", () => {
		expect(
			buildPlanModeArtifactContext({
				sessionId: "task-1",
				activeTab: "status",
			}),
		).toBeNull();
		expect(
			buildPlanModeArtifactContext({
				sessionId: "task-1",
				activeTab: "questionnaire",
			}),
		).toBeNull();
	});
});

describe("Blueprint message classification", () => {
	it("keeps Data Model messages out of normal Blueprint surfaces", () => {
		const createdAt = new Date().toISOString();
		const normalBlueprint = buildBlueprintMessage({
			id: "message-blueprint",
			taskId: "task-1",
			content: "# App Blueprint",
			metadataJson: {
				intent: "app_blueprint",
				appBlueprint: { name: "App Blueprint" },
			},
			createdAt,
		});
		const dataModelBlueprint: TaskMessage = {
			...normalBlueprint,
			id: "message-data-model",
			metadataJson: {
				intent: "app_blueprint",
				artifactType: "data_model",
				source: "data-model",
				dataModelTarget: { sourceBlueprintMessageId: normalBlueprint.id },
				appBlueprint: { name: "Data Model" },
			},
		};

		expect(isNormalBlueprintMessage(normalBlueprint)).toBe(true);
		expect(isDataModelMessage(normalBlueprint)).toBe(false);
		expect(isNormalBlueprintMessage(dataModelBlueprint)).toBe(false);
		expect(isDataModelMessage(dataModelBlueprint)).toBe(true);
	});
});

describe("PlanModeWorkspaceViewer", () => {
	it("hides the Questionnaire start action after a questionnaire is complete", () => {
		expect(
			shouldShowQuestionnaireStartAction({
				sessionId: "task-1",
				questionnaireComplete: true,
			}),
		).toBe(false);
		expect(
			shouldShowQuestionnaireStartAction({
				sessionId: "task-1",
				questionnaireComplete: false,
			}),
		).toBe(true);
		expect(
			shouldShowQuestionnaireStartAction({
				sessionId: null,
				questionnaireComplete: false,
			}),
		).toBe(false);
	});

	it("extracts Plan View decisions from Workbench plan mode gate metadata", () => {
		const decisions = extractViewDecisions([
			buildTaskMessage({
				id: "message-plan-gate",
				metadataJson: {
					intent: "design_questionnaire_ready",
					planModeGate: {
						shouldStartPlanMode: true,
						action: "plan_mode",
						dedicatedViews: [
							{ view: "blueprint", decision: "omit", reason: "no UI change" },
							{
								view: "data_model",
								decision: "omit",
								reason: "no schema change",
							},
							{
								view: "api_io_contract",
								decision: "include",
								reason: "headers contract changes",
							},
						],
					},
				},
			}),
		]);

		expect(decisions).toEqual([
			{ view: "blueprint", decision: "omit", reason: "no UI change" },
			{ view: "data_model", decision: "omit", reason: "no schema change" },
			{
				view: "api_io_contract",
				decision: "include",
				reason: "headers contract changes",
			},
		]);
	});

	it("keeps Status before the spec tab when a feature plan exists", () => {
		const tabs = buildVisiblePlanWorkspaceTabs({
			questionnaireGateLocked: false,
			hasFeaturePlan: true,
			hasQuestionnaire: true,
			hasBlueprint: true,
			hasDataModel: true,
			includedViews: new Set(),
			planModeCapabilities: {
				questionnaire: true,
				feature_plan: true,
				user_flow: true,
				blueprint: true,
				data_model: true,
				api_io_contract: true,
				activity_flow: true,
				sequence_flow: true,
				zod_schema_design: true,
			},
			dedicatedViewArtifacts: [],
		});

		expect(tabs).toEqual([
			"status",
			"feature-plan",
			"questionnaire",
			"blueprint",
			"data-model",
		]);
		expect(tabs.map(getPlanWorkspaceTabLabel)).toEqual([
			"Status",
			"spec",
			"Questionnaire",
			"Blueprint",
			"Data Model",
		]);
	});

	it("does not show transition tabs for included plan views before artifacts exist", () => {
		const tabs = buildVisiblePlanWorkspaceTabs({
			questionnaireGateLocked: false,
			hasFeaturePlan: false,
			hasQuestionnaire: false,
			hasBlueprint: false,
			hasDataModel: true,
			includedViews: new Set(["user_flow", "api_io_contract"]),
			planModeCapabilities: {
				questionnaire: true,
				feature_plan: true,
				user_flow: true,
				blueprint: true,
				data_model: true,
				api_io_contract: true,
				activity_flow: true,
				sequence_flow: true,
				zod_schema_design: true,
			},
			dedicatedViewArtifacts: [],
		});

		expect(tabs).toEqual(["status", "data-model"]);
	});

	it("shows transition tabs for plan views after artifacts exist", () => {
		const tabs = buildVisiblePlanWorkspaceTabs({
			questionnaireGateLocked: false,
			hasFeaturePlan: false,
			hasQuestionnaire: false,
			hasBlueprint: false,
			hasDataModel: true,
			includedViews: new Set(["user_flow", "api_io_contract"]),
			planModeCapabilities: {
				questionnaire: true,
				feature_plan: true,
				user_flow: true,
				blueprint: true,
				data_model: true,
				api_io_contract: true,
				activity_flow: true,
				sequence_flow: true,
				zod_schema_design: true,
			},
			dedicatedViewArtifacts: [
				{ id: "user-flow-1", kind: "user_flow", title: "User Flow" },
				{
					id: "api-contract-1",
					kind: "api_io_contract",
					title: "API Contract",
				},
			],
		});

		expect(tabs).toEqual([
			"status",
			"data-model",
			"user-flow",
			"api-io-contract",
		]);
	});

	it("starts on Questionnaire and withholds Status until questionnaire answers are ready", () => {
		const markup = renderToStaticMarkup(
			createElement(PlanModeWorkspaceViewer, {
				sessionId: "task-1",
				taskMessages: [],
				activityArtifacts: [],
				initialTab: "status",
			}),
		);

		expect(markup).toContain(">Questionnaire</button>");
		expect(markup).toContain("No questionnaire session.");
		const additionalButton = markup.match(
			/<button[^>]*>追加確認<\/button>/,
		)?.[0];
		expect(additionalButton).not.toContain('disabled=""');
		expect(markup).not.toContain(">Status</button>");
		expect(markup).not.toContain(">spec</button>");
	});

	it("does not reapply the Questionnaire initial tab after the gate unlocks", () => {
		expect(resolveInitialPlanWorkspaceTabUpdate("questionnaire", true)).toBe(
			"questionnaire",
		);
		expect(
			resolveInitialPlanWorkspaceTabUpdate("questionnaire", false),
		).toBeNull();
		expect(resolveInitialPlanWorkspaceTabUpdate("status", false)).toBe(
			"status",
		);
	});
});

describe("WorkspaceBlueprintPreview", () => {
	it("renders a Mock Blueprint preview from message metadata", () => {
		const message = buildBlueprintMessage({
			id: "message-mock-blueprint-1",
			content: "# Mock Blueprint Summary\n\nShould not be primary.",
			metadataJson: {
				intent: "mock_blueprint",
				mockBlueprint: representativeMockBlueprint,
			},
		});

		const markup = renderToStaticMarkup(
			createElement(WorkspaceBlueprintPreview, {
				sessionId: "task-1",
				message,
				activityArtifacts: [],
			}),
		);

		expect(markup).toContain('data-blueprint-preview="true"');
		expect(markup).toMatch(/see meta|blueprint\.preview\.seeMeta/);
		expect(markup).not.toContain("Blueprint:");
		expect(markup).not.toContain("Not adopted");
		expect(markup).not.toContain("No Blueprint artifact.");
		expect(markup).not.toContain("Mock Blueprint Summary");
	});

	it("renders a Mock Blueprint preview from a linked activity artifact", () => {
		const message = buildBlueprintMessage({
			id: "message-mock-blueprint-1",
			content: "# Mock Blueprint Summary\n\nShould not be primary.",
			metadataJson: {
				intent: "mock_blueprint",
				artifactRef: {
					artifactId: "artifact-mock-blueprint-1",
					kind: "app_blueprint",
					version: 1,
				},
			},
		});
		const activityArtifact = buildActivityArtifact({
			id: "artifact-mock-blueprint-1",
			contentText: JSON.stringify(representativeMockBlueprint),
			metadataJson: {
				schemaName: "mock_blueprint",
				mockBlueprint: representativeMockBlueprint,
			},
		});

		const markup = renderToStaticMarkup(
			createElement(WorkspaceBlueprintPreview, {
				sessionId: "task-1",
				message,
				activityArtifacts: [activityArtifact],
			}),
		);

		expect(markup).toContain('data-blueprint-preview="true"');
		expect(markup).not.toContain("No Blueprint artifact.");
		expect(markup).not.toContain("Mock Blueprint Summary");
	});

	it("renders a Mock Blueprint preview from activity artifact JSON content", () => {
		const message = buildBlueprintMessage({
			id: "message-mock-blueprint-1",
			content: "# Mock Blueprint Summary\n\nShould not be primary.",
			metadataJson: {
				intent: "mock_blueprint",
				artifactRef: {
					artifactId: "artifact-mock-blueprint-1",
					kind: "app_blueprint",
					version: 1,
				},
			},
		});
		const activityArtifact = buildActivityArtifact({
			id: "artifact-mock-blueprint-1",
			contentText: JSON.stringify(representativeMockBlueprint),
			metadataJson: { schemaName: "mock_blueprint" },
		});

		const markup = renderToStaticMarkup(
			createElement(WorkspaceBlueprintPreview, {
				sessionId: "task-1",
				message,
				activityArtifacts: [activityArtifact],
			}),
		);

		expect(markup).toContain('data-blueprint-preview="true"');
		expect(markup).not.toContain("No Blueprint artifact.");
		expect(markup).not.toContain("Mock Blueprint Summary");
	});

	it("renders the latest Blueprint activity artifact when no message is selected", () => {
		const activityArtifact = buildActivityArtifact({
			id: "artifact-mock-blueprint-1",
			contentText: JSON.stringify(representativeMockBlueprint),
			metadataJson: { schemaName: "mock_blueprint" },
			createdAt: "1800000000",
		});

		const markup = renderToStaticMarkup(
			createElement(WorkspaceBlueprintPreview, {
				sessionId: "task-1",
				message: null,
				activityArtifacts: [activityArtifact],
			}),
		);

		expect(markup).toContain('data-blueprint-preview="true"');
		expect(markup).not.toContain("No Blueprint artifact.");
	});

	it("does not render Markdown fallback when Mock Blueprint conversion fails", () => {
		const message = buildBlueprintMessage({
			id: "message-broken-mock-blueprint",
			content: "# Mock Blueprint Summary\n\nShould not be primary.",
			metadataJson: {
				intent: "mock_blueprint",
				mockBlueprint: {
					artifactKind: "mock_blueprint",
					id: "broken",
					name: "Broken",
					version: 1,
				},
			},
		});

		const markup = renderToStaticMarkup(
			createElement(WorkspaceBlueprintPreview, {
				sessionId: "task-1",
				message,
				activityArtifacts: [],
			}),
		);

		expect(markup).toContain("Blueprint preview is unavailable.");
		expect(markup).not.toContain("Mock Blueprint Summary");
	});

	it("uses a linked activity artifact when message Mock Blueprint metadata is incomplete", () => {
		const message = buildBlueprintMessage({
			id: "message-broken-linked-mock-blueprint",
			content: "# Mock Blueprint Summary\n\nShould not be primary.",
			metadataJson: {
				intent: "mock_blueprint",
				artifactRef: {
					artifactId: "artifact-valid-mock-blueprint",
					kind: "app_blueprint",
					version: 1,
				},
				mockBlueprint: {
					artifactKind: "mock_blueprint",
					id: "broken",
					name: "Broken",
					version: 1,
				},
			},
		});
		const activityArtifact = buildActivityArtifact({
			id: "artifact-valid-mock-blueprint",
			contentText: JSON.stringify(representativeMockBlueprint),
			metadataJson: { schemaName: "mock_blueprint" },
		});

		const markup = renderToStaticMarkup(
			createElement(WorkspaceBlueprintPreview, {
				sessionId: "task-1",
				message,
				activityArtifacts: [activityArtifact],
			}),
		);

		expect(markup).toContain('data-blueprint-preview="true"');
		expect(markup).not.toContain("Blueprint preview is unavailable.");
		expect(markup).not.toContain("Mock Blueprint Summary");
	});

	it("selects the newest Blueprint message by numeric createdAt instead of array order", () => {
		const newerMessage = buildBlueprintMessage({
			id: "message-mock-blueprint-newer",
			createdAt: "1800000000",
			metadataJson: {
				intent: "mock_blueprint",
				mockBlueprint: representativeMockBlueprint,
			},
		});
		const olderMessage = buildBlueprintMessage({
			id: "message-blueprint-older",
			createdAt: "2026-06-02T00:00:00.000Z",
			metadataJson: {
				intent: "app_blueprint",
				appBlueprint: {
					id: "older-blueprint",
					name: "Older Blueprint",
					screens: [],
				},
			},
		});

		const workspaceMessages = selectPlanModeWorkspaceMessages({
			taskMessages: [newerMessage, olderMessage],
			activityArtifacts: [],
			generatedMessages: [],
			workspace: null,
		});

		expect(workspaceMessages.activeBlueprintMessage?.id).toBe(newerMessage.id);
	});
});
