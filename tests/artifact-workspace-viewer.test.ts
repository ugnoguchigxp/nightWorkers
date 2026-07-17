import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import "../src/i18n/setup";
import { buildArtifactVersions } from "../src/modules/nightworkers/components/ArtifactPaneVersions";
import type { TaskMessage } from "../src/modules/nightworkers/types";
import { buildWorkbenchArtifactRefs } from "../src/modules/nightworkers/workbenchArtifactSelectors";
import {
	isDataModelMessage,
	isNormalBlueprintMessage,
	mergeWorkspaceTaskMessages,
} from "../src/modules/nightworkers/workbenchSelectors";
import {
	buildPlanModeArtifactContext,
	buildPlanModeExportDescriptor,
	buildVisiblePlanWorkspaceTabs,
	extractViewDecisions,
	getPlanWorkspaceTabLabel,
	PlanModeWorkspaceViewer,
	resetPlanWorkspaceScrollToTop,
	resolveInitialPlanWorkspaceTabUpdate,
	resolveQuestionnaireGenerationState,
	scrollPlanWorkspaceToTop,
	selectActiveDedicatedArtifact,
	shouldOpenQuestionnaireForEmptyBlueprint,
	shouldShowQuestionnaireStartAction,
	WorkspaceBlueprintPreview,
} from "../src/modules/planMode";
import { selectPlanModeWorkspaceMessages } from "../src/modules/specification";
import { representativeMockBlueprint } from "./fixtures/mock-blueprint";
import {
	buildActivityArtifact,
	buildBlueprintMessage,
	buildTask,
	buildTaskMessage,
} from "./helpers/nightworkers-fixtures";

function renderPlanModeViewer(
	props: Parameters<typeof PlanModeWorkspaceViewer>[0],
) {
	return renderToStaticMarkup(
		createElement(
			QueryClientProvider,
			{ client: new QueryClient() },
			createElement(PlanModeWorkspaceViewer, props),
		),
	);
}

describe("buildArtifactVersions", () => {
	it("does not scan message-backed versions for synthetic Test Mode artifacts", () => {
		const selectedArtifact = {
			id: "test-mode-task-1",
			taskId: "task-1",
			kind: "test_mode" as const,
			title: "Test Mode",
			source: { type: "test_mode" as const },
			createdAt: "2026-07-08T00:00:00.000Z",
		};
		const versions = buildArtifactVersions(
			selectedArtifact,
			[
				buildTaskMessage({
					id: "message-1",
					messageType: "markdown_document",
					metadataJson: {
						intent: "implementation_plan",
						markdownDocumentData: { title: "Implementation Plan" },
					},
				}),
			],
			[
				buildActivityArtifact({
					id: "artifact-1",
					kind: "diff",
				}),
			],
		);

		expect(versions).toEqual([selectedArtifact]);
	});
});

describe("buildWorkbenchArtifactRefs", () => {
	it("does not parse activity artifact content while building lightweight refs", () => {
		const parseSpy = vi.spyOn(JSON, "parse");

		try {
			const refs = buildWorkbenchArtifactRefs({
				task: buildTask(),
				messages: [],
				activityArtifacts: [
					buildActivityArtifact({
						id: "artifact-blueprint-1",
						kind: "app_blueprint",
						contentText: JSON.stringify({
							name: "Large Blueprint",
							screens: Array.from({ length: 100 }, (_, index) => ({
								name: `Screen ${index}`,
							})),
						}),
						metadataJson: {
							intent: "app_blueprint",
							title: "Large Blueprint",
						},
					}),
				],
			});

			expect(parseSpy).not.toHaveBeenCalled();
			expect(
				refs.some((ref) => ref.id === "artifact-artifact-blueprint-1"),
			).toBe(true);
		} finally {
			parseSpy.mockRestore();
		}
	});

	it("keeps content fallback for legacy activity artifact refs without metadata titles", () => {
		const refs = buildWorkbenchArtifactRefs({
			task: buildTask(),
			messages: [],
			activityArtifacts: [
				buildActivityArtifact({
					id: "artifact-legacy-blueprint-1",
					kind: "app_blueprint",
					contentText: JSON.stringify({
						name: "Legacy Blueprint",
						summary: "Parsed only when metadata cannot label the ref.",
						screens: [],
					}),
					metadataJson: {
						intent: "app_blueprint",
					},
				}),
			],
		});

		expect(refs).toContainEqual(
			expect.objectContaining({
				id: "artifact-artifact-legacy-blueprint-1",
				title: "Blueprint: Legacy Blueprint",
				summary: "Parsed only when metadata cannot label the ref.",
			}),
		);
	});
});

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
				planModeFocus: { kind: "artifact" },
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

	it("builds regeneration contexts for feature plan, data model, and dedicated views", () => {
		const featurePlanContext = buildPlanModeArtifactContext({
			sessionId: "task-1",
			activeTab: "feature-plan",
			featurePlanMessage: {
				id: "feature-plan-message",
				content: "# Feature Plan\n\nGenerate the implementation spec.",
			},
		});
		const dataModelContext = buildPlanModeArtifactContext({
			sessionId: "task-1",
			activeTab: "data-model",
			activeDataModelMessage: {
				id: "data-model-message",
				content: "# Data Model\n\nTables and relationships.",
			},
		});
		const dedicatedContext = buildPlanModeArtifactContext({
			sessionId: "task-1",
			activeTab: "api-io-contract",
			activeDedicatedMessage: {
				id: "api-message",
				content: "# API Contract\n\nGET /tasks",
			},
			activeDedicatedArtifact: {
				sourceMessageId: "api-artifact-source",
			},
			readyQuestionnaireSessionId: "questionnaire-ready",
		});

		expect(featurePlanContext).toMatchObject({
			artifactId: "plan-mode-workspace-task-1:feature_plan",
			title: "Feature Plan",
			metadata: {
				planModeTarget: "feature_plan",
				displayKind: "PLAN_MODE:FEATURE_PLAN",
				featurePlanMessageId: "feature-plan-message",
			},
		});
		expect(dataModelContext).toMatchObject({
			artifactId: "plan-mode-workspace-task-1:data_model",
			title: "Data Model",
			source: { type: "task_message", messageId: "data-model-message" },
			metadata: {
				planModeTarget: "data_model",
				sourceDataModelMessageId: "data-model-message",
			},
		});
		expect(dedicatedContext).toMatchObject({
			artifactId: "plan-mode-workspace-task-1:api_io_contract",
			title: "API Contract",
			source: { type: "task_message", messageId: "api-message" },
			metadata: {
				planModeTarget: "api_io_contract",
				questionnaireSessionId: "questionnaire-ready",
			},
		});
	});
});

describe("buildPlanModeExportDescriptor", () => {
	it("exports the currently selected Plan Mode tab", () => {
		const featurePlanMessage = buildTaskMessage({
			content: "# Feature Plan\n\nSelected feature plan",
			messageType: "markdown_document",
		});
		const apiMessage = buildTaskMessage({
			id: "api-contract-message",
			content: '{"openapi":"3.1.0"}',
			messageType: "api_contract",
			metadataJson: {
				apiContract: { title: "Tasks API", openapi: { openapi: "3.1.0" } },
			},
		});
		const common = {
			scopeId: "task-1",
			workspace: null,
			viewDecisions: [],
			activeQuestionnaireSession: null,
			featurePlanMessage,
			activeBlueprintMessage: null,
			activeDataModelMessage: null,
			activeDedicatedMessage: apiMessage,
		};

		expect(
			buildPlanModeExportDescriptor({
				...common,
				activeTab: "feature-plan",
			}).markdown,
		).toContain("Selected feature plan");
		const apiExport = buildPlanModeExportDescriptor({
			...common,
			activeTab: "api-io-contract",
		});
		expect(apiExport.fileStem).toBe("plan-mode-api-contract");
		expect(apiExport.markdown).toContain('"title": "Tasks API"');
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
	it("tracks Questionnaire generation through its ready refresh trigger", () => {
		expect(
			resolveQuestionnaireGenerationState([
				buildTaskMessage({
					id: "questionnaire-starting",
					metadataJson: { intent: "design_questionnaire_starting" },
				}),
			]),
		).toEqual({
			status: "generating",
			messageId: "questionnaire-starting",
		});
		expect(
			resolveQuestionnaireGenerationState([
				buildTaskMessage({
					id: "questionnaire-starting",
					metadataJson: { intent: "design_questionnaire_starting" },
				}),
				buildTaskMessage({
					id: "questionnaire-ready",
					metadataJson: { intent: "design_questionnaire_ready" },
				}),
			]),
		).toEqual({ status: "ready", messageId: "questionnaire-ready" });
	});

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

	it("keeps workspace tabs available while Questionnaire is incomplete", () => {
		const tabs = buildVisiblePlanWorkspaceTabs({
			hasFeaturePlan: true,
			hasQuestionnaire: true,
			hasBlueprint: true,
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
			],
		});

		expect(tabs).toEqual([
			"status",
			"feature-plan",
			"questionnaire",
			"blueprint",
			"data-model",
			"user-flow",
		]);
	});

	it("respects Status as the initial tab before questionnaire answers are ready", () => {
		const markup = renderPlanModeViewer({
			sessionId: "task-1",
			taskMessages: [],
			activityArtifacts: [],
			initialTab: "status",
		});

		expect(markup).toContain(">Status</button>");
		expect(markup).toContain("nightworkers-plan-workspace-tab-active");
		expect(markup).not.toContain("No questionnaire session.");
		expect(markup).not.toContain(">spec</button>");
	});

	it("does not duplicate verification definitions above the feature plan", () => {
		const featurePlan = buildTaskMessage({
			id: "feature-plan-message",
			content:
				"# Feature Plan\n\n## 完了条件\n- [AC-001] ユーザーを作成でき、長い完了条件も省略されずに読める",
			messageType: "markdown_document",
			metadataJson: {
				intent: "feature_plan",
				title: "Feature Plan",
				verificationDocumentId: "55555555-5555-4555-8555-555555555555",
				verificationSidecarMessageId: "verification-message",
				markdownDocumentData: {
					title: "Feature Plan",
				},
			},
		});
		const verificationSidecar = buildTaskMessage({
			id: "verification-message",
			content: "{}",
			messageType: "verification_json",
			metadataJson: {
				intent: "feature_plan_verification",
				verificationDocument: {
					conditions: [
						{
							id: "AC-001",
							text: "ユーザーを作成でき、長い完了条件も省略されずに読める",
							status: "pending",
							required: true,
						},
					],
				},
			},
		});

		const markup = renderPlanModeViewer({
			sessionId: "11111111-1111-4111-8111-111111111111",
			taskMessages: [featurePlan, verificationSidecar],
			activityArtifacts: [],
			initialTab: "feature-plan",
		});

		expect(markup.match(/AC-001/g)).toHaveLength(1);
		expect(markup).toContain(
			"ユーザーを作成でき、長い完了条件も省略されずに読める",
		);
		expect(markup).not.toContain("未確認");
		expect(markup).not.toContain("nightworkers-structured-artifact-row");
	});

	it("renders blueprint and data model tabs from task messages", () => {
		const blueprint = buildBlueprintMessage({
			id: "message-blueprint",
			content: "# Blueprint fallback",
			metadataJson: {
				intent: "mock_blueprint",
				mockBlueprint: representativeMockBlueprint,
			},
		});
		const dataModel = buildTaskMessage({
			id: "message-data-model",
			messageType: "markdown_document",
			content: "# Data Model\n\n- users\n- tasks",
			metadataJson: {
				intent: "app_blueprint",
				artifactType: "data_model",
				source: "data-model",
				dataModelTarget: { sourceBlueprintMessageId: "message-blueprint" },
				appBlueprint: { name: "Data Model" },
			},
		});

		const blueprintMarkup = renderPlanModeViewer({
			sessionId: "task-1",
			taskMessages: [blueprint, dataModel],
			activityArtifacts: [],
			initialTab: "blueprint",
		});
		const dataModelMarkup = renderPlanModeViewer({
			sessionId: "task-1",
			taskMessages: [blueprint, dataModel],
			activityArtifacts: [],
			initialTab: "data-model",
		});

		expect(blueprintMarkup).toContain('data-blueprint-preview="true"');
		expect(dataModelMarkup).toContain("Data Model");
		expect(dataModelMarkup).toContain("users");
		expect(dataModelMarkup).toContain("tasks");
	});

	it("does not reapply Questionnaire over a user-selected tab", () => {
		expect(resolveInitialPlanWorkspaceTabUpdate("questionnaire")).toBeNull();
		expect(resolveInitialPlanWorkspaceTabUpdate("status")).toBe("status");
	});

	it("keeps generated Blueprint focus from being pushed back to Questionnaire", () => {
		expect(
			shouldOpenQuestionnaireForEmptyBlueprint({
				hasQuestionnaireSessions: true,
				hasBlueprintMessages: false,
				activeTab: "blueprint",
			}),
		).toBe(true);
		expect(
			shouldOpenQuestionnaireForEmptyBlueprint({
				hasQuestionnaireSessions: true,
				hasBlueprintMessages: false,
				activeTab: "blueprint",
				preserveGeneratedBlueprintFocus: true,
			}),
		).toBe(false);
		expect(
			shouldOpenQuestionnaireForEmptyBlueprint({
				hasQuestionnaireSessions: true,
				hasBlueprintMessages: true,
				activeTab: "blueprint",
			}),
		).toBe(false);
	});

	it("resets the Plan Mode workspace scrollbar to the top", () => {
		const scrollCalls: ScrollToOptions[] = [];
		const scrollable = {
			scrollTop: 240,
			scrollTo: (options: ScrollToOptions) => scrollCalls.push(options),
		};
		const fallbackScrollable = { scrollTop: 240 };

		scrollPlanWorkspaceToTop(scrollable);
		scrollPlanWorkspaceToTop(fallbackScrollable);

		expect(scrollCalls).toEqual([{ top: 0, left: 0, behavior: "auto" }]);
		expect(fallbackScrollable.scrollTop).toBe(0);
	});

	it("schedules the Plan Mode workspace scrollbar reset against the latest element", () => {
		let scheduledReset: (() => void) | null = null;
		let scrollable: { scrollTop: number } | null = null;

		resetPlanWorkspaceScrollToTop(() => scrollable, {
			requestAnimationFrame: (callback) => {
				scheduledReset = callback;
			},
		});
		scrollable = { scrollTop: 240 };
		scheduledReset?.();

		expect(scrollable.scrollTop).toBe(0);
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
