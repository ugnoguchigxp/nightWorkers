// biome-ignore-all lint/correctness/useHookAtTopLevel: these hook factories run against a mocked React dispatcher to exercise returned actions directly.
import { beforeEach, describe, expect, it, vi } from "vitest";

const commands = vi.hoisted(() => ({
	generateBlueprintArtifact: vi.fn(),
	generateDataModelArtifact: vi.fn(),
	generateFeaturePlanArtifact: vi.fn(),
	generatePlanViewArtifact: vi.fn(),
	startDesignQuestionnaire: vi.fn(),
	submitDesignQuestionnaireAnswers: vi.fn(),
	generateAdditionalDesignQuestionnaireQuestions: vi.fn(),
}));

vi.mock("../src/modules/blueprint", () => ({
	generateBlueprintArtifact: commands.generateBlueprintArtifact,
}));
vi.mock("../src/modules/dataModel", () => ({
	generateDataModelArtifact: commands.generateDataModelArtifact,
}));
vi.mock("../src/modules/specification", async () => {
	const actual = await vi.importActual<object>("../src/modules/specification");
	return {
		...actual,
		generateFeaturePlanArtifact: commands.generateFeaturePlanArtifact,
	};
});
vi.mock("../src/modules/planMode/planViewCommands", async () => {
	const actual = await vi.importActual<object>(
		"../src/modules/planMode/planViewCommands",
	);
	return {
		...actual,
		generatePlanViewArtifact: commands.generatePlanViewArtifact,
	};
});
vi.mock("../src/modules/questionnaire", () => ({
	startDesignQuestionnaire: commands.startDesignQuestionnaire,
	submitDesignQuestionnaireAnswers: commands.submitDesignQuestionnaireAnswers,
	generateAdditionalDesignQuestionnaireQuestions:
		commands.generateAdditionalDesignQuestionnaireQuestions,
	buildSubmittableQuestionnaireAnswers: () => [],
}));

import {
	usePlanModeArtifactGeneration,
	usePlanModeArtifactGenerationForWorkspace,
} from "../src/modules/planMode/usePlanModeArtifactGeneration";
import { usePlanModeQuestionnaireActions } from "../src/modules/planMode/usePlanModeQuestionnaireActions";

function response(body: unknown, ok = true) {
	return new Response(JSON.stringify(body), {
		status: ok ? 200 : 500,
		headers: { "content-type": "application/json" },
	});
}

function errorResponse(code: string, message: string) {
	return response({ error: { code, message } }, false);
}

const generatedMessage = { id: "generated-1", taskId: "task-1" };
const workspace = {
	taskId: "task-1",
	repositoryId: "repo-1",
	dedicatedViewArtifacts: [],
};

function artifactInput(overrides: Record<string, unknown> = {}) {
	const queryClient = {
		getQueryData: vi.fn(() => null),
		invalidateQueries: vi.fn(),
		setQueryData: vi.fn(),
	};
	const setGeneratedMessages = vi.fn((update) =>
		typeof update === "function" ? update([]) : update,
	);
	const runAction = vi.fn(
		async (_action: string, fn: () => Promise<unknown>) => {
			await fn();
			return true;
		},
	);
	return {
		sessionId: "task-1",
		isImplementationLocked: false,
		planModeCapabilities: {
			blueprint: true,
			data_model: true,
			feature_plan: true,
			user_flow: true,
			activity_flow: true,
			sequence_flow: true,
			api_io_contract: true,
			zod_schema_design: true,
		},
		activeQuestionnaireSummary: null,
		readyQuestionnaireSession: { id: "questionnaire-1" },
		featurePlanMessage: { id: "feature-current" },
		activeBlueprintSourceMessageId: "blueprint-current",
		activeDataModelMessage: { id: "data-current" },
		activeDedicatedView: "user_flow" as const,
		activeDedicatedMessage: { id: "view-current" },
		attemptedMermaidRenderRepairs: { current: new Set<string>() },
		queryClient,
		setGeneratedMessages,
		runAction,
		selectActiveTab: vi.fn(),
		...overrides,
	};
}

describe("Plan Mode artifact generation action coverage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		commands.generateBlueprintArtifact.mockResolvedValue(
			response({ message: generatedMessage, workspace }),
		);
		commands.generateDataModelArtifact.mockResolvedValue(
			response({ message: generatedMessage, workspace }),
		);
		commands.generateFeaturePlanArtifact.mockResolvedValue(
			response({ message: generatedMessage, workspace }),
		);
		commands.generatePlanViewArtifact.mockResolvedValue(
			response({ message: generatedMessage, workspace }),
		);
	});

	it("guards artifact generation without a session, while locked, or without capability", async () => {
		for (const overrides of [
			{ sessionId: null },
			{ isImplementationLocked: true },
			{ planModeCapabilities: {} },
		]) {
			const actions = usePlanModeArtifactGeneration(
				artifactInput(overrides) as never,
			);
			expect(
				await actions.generatePlanModeArtifact("blueprint", "blueprint"),
			).toBe(false);
		}
		expect(commands.generateBlueprintArtifact).not.toHaveBeenCalled();
	});

	it.each([
		["blueprint", "blueprint"],
		["data-model", "data_model"],
		["feature-plan", "feature_plan"],
	] as const)("generates %s and updates messages/workspace", async (action, nextTab) => {
		const input = artifactInput();
		const actions = usePlanModeArtifactGeneration(input as never);
		expect(await actions.generatePlanModeArtifact(action, nextTab)).toBe(true);
		expect(input.setGeneratedMessages).toHaveBeenCalled();
		expect(input.queryClient.invalidateQueries).toHaveBeenCalledTimes(2);
		expect(input.queryClient.setQueryData).toHaveBeenCalledWith(
			expect.anything(),
			workspace,
		);
	});

	it("passes the latest source fallbacks for all artifact types", async () => {
		const input = artifactInput();
		input.queryClient.getQueryData.mockReturnValue({
			featurePlanArtifacts: [
				{ sourceMessageId: "feature-latest", createdAt: "2026-03-01" },
			],
			blueprintArtifacts: [
				{ sourceMessageId: "blueprint-latest", createdAt: "2026-03-01" },
			],
			dataModelArtifacts: [
				{ sourceMessageId: "data-latest", createdAt: "2026-03-01" },
			],
			dedicatedViewArtifacts: [
				{ sourceMessageId: "view-latest", createdAt: "2026-03-01" },
			],
		} as never);
		const actions = usePlanModeArtifactGeneration(input as never);
		await actions.generatePlanModeArtifact("blueprint", "blueprint");
		await actions.generatePlanModeArtifact("data-model", "data_model");
		await actions.generatePlanModeArtifact("feature-plan", "status");
		expect(commands.generateBlueprintArtifact).toHaveBeenCalledWith(
			"task-1",
			expect.objectContaining({
				sourceBlueprintMessageId: "blueprint-current",
			}),
		);
		expect(commands.generateDataModelArtifact).toHaveBeenCalledWith(
			"task-1",
			expect.objectContaining({
				featurePlanMessageId: "feature-latest",
				sourceBlueprintMessageId: "blueprint-latest",
			}),
		);
		expect(commands.generateFeaturePlanArtifact).toHaveBeenCalledWith(
			"task-1",
			expect.objectContaining({
				sourceDataModelMessageId: "data-latest",
				sourceDedicatedViewMessageIds: expect.any(Array),
			}),
		);
	});

	it("routes unanswered blocking questions to confirmation or questionnaire", async () => {
		const confirm = vi.fn(() => false);
		vi.stubGlobal("window", { confirm });
		let input = artifactInput({
			activeQuestionnaireSummary: { blockingUnansweredCount: 2 },
		});
		let actions = usePlanModeArtifactGeneration(input as never);
		await actions.generatePlanModeArtifact("feature-plan", "status");
		expect(input.selectActiveTab).toHaveBeenCalledWith("questionnaire");
		expect(commands.generateFeaturePlanArtifact).not.toHaveBeenCalled();

		confirm.mockReturnValue(true);
		input = artifactInput({
			activeQuestionnaireSummary: { blockingUnansweredCount: 1 },
		});
		actions = usePlanModeArtifactGeneration(input as never);
		await actions.generatePlanModeArtifact("feature-plan", "status");
		expect(commands.generateFeaturePlanArtifact).toHaveBeenCalledWith(
			"task-1",
			expect.objectContaining({ proceedWithUnansweredBlocking: true }),
		);
		vi.unstubAllGlobals();
	});

	it("throws typed questionnaire and plain generation errors", async () => {
		commands.generateFeaturePlanArtifact.mockResolvedValueOnce(
			errorResponse(
				"BLOCKING_QUESTIONNAIRE_ANSWERS_REQUIRED",
				"Questionnaire answers are required.",
			),
		);
		const input = artifactInput();
		let actions = usePlanModeArtifactGeneration(input as never);
		await expect(
			actions.generatePlanModeArtifact("feature-plan", "status"),
		).rejects.toThrow("Questionnaire");
		expect(input.selectActiveTab).toHaveBeenCalledWith("questionnaire");

		commands.generateBlueprintArtifact.mockResolvedValueOnce(
			errorResponse("BLUEPRINT_FAILED", "blueprint failed"),
		);
		actions = usePlanModeArtifactGeneration(artifactInput() as never);
		await expect(
			actions.generatePlanModeArtifact("blueprint", "blueprint"),
		).rejects.toThrow("blueprint failed");
	});

	it("tolerates successful responses without message or workspace", async () => {
		commands.generateBlueprintArtifact.mockResolvedValueOnce(response({}));
		const input = artifactInput();
		const actions = usePlanModeArtifactGeneration(input as never);
		await actions.generatePlanModeArtifact("blueprint", "blueprint");
		expect(input.setGeneratedMessages).not.toHaveBeenCalled();
		expect(input.queryClient.setQueryData).not.toHaveBeenCalled();
	});

	it("filters and sequentially generates dedicated views", async () => {
		const firstWorkspace = { ...workspace, marker: "first" };
		const secondWorkspace = { ...workspace, marker: "second" };
		commands.generatePlanViewArtifact
			.mockResolvedValueOnce(
				response({ message: { id: "view-1" }, workspace: firstWorkspace }),
			)
			.mockResolvedValueOnce(
				response({ message: { id: "view-2" }, workspace: secondWorkspace }),
			);
		const input = artifactInput();
		const actions = usePlanModeArtifactGeneration(input as never);
		expect(
			await actions.generateDedicatedViews([
				"invalid",
				"user_flow",
				"activity_flow",
			]),
		).toBe(true);
		expect(commands.generatePlanViewArtifact).toHaveBeenCalledTimes(2);
		expect(input.setGeneratedMessages.mock.results[0]?.value).toEqual([
			{ id: "view-1" },
			{ id: "view-2" },
		]);
		expect(input.queryClient.setQueryData).toHaveBeenCalledWith(
			expect.anything(),
			secondWorkspace,
		);
	});

	it("guards empty dedicated views and surfaces failures", async () => {
		for (const overrides of [
			{ sessionId: null },
			{ isImplementationLocked: true },
			{ planModeCapabilities: {} },
		]) {
			const actions = usePlanModeArtifactGeneration(
				artifactInput(overrides) as never,
			);
			expect(await actions.generateDedicatedViews(["user_flow"])).toBe(false);
		}
		commands.generatePlanViewArtifact.mockResolvedValueOnce(
			errorResponse("PLAN_VIEW_FAILED", "view failed"),
		);
		const actions = usePlanModeArtifactGeneration(artifactInput() as never);
		await expect(actions.generateDedicatedViews(["user_flow"])).rejects.toThrow(
			"view failed",
		);
	});

	it("returns no focus for an unmapped-but-valid view and empty response", async () => {
		commands.generatePlanViewArtifact.mockResolvedValueOnce(response({}));
		const input = artifactInput({
			planModeCapabilities: { zod_schema_design: true },
		});
		const actions = usePlanModeArtifactGeneration(input as never);
		await actions.generateDedicatedViews(["zod_schema_design"]);
		expect(input.setGeneratedMessages).not.toHaveBeenCalled();
	});

	it("guards and executes Mermaid repair once per active view", async () => {
		const invalidFailures = [
			[{ stage: "svg_import" }, {}],
			[{ stage: "chart_parse" }, { sessionId: null }],
			[{ stage: "chart_parse" }, { isImplementationLocked: true }],
			[{ stage: "chart_parse" }, { activeDedicatedView: null }],
			[{ stage: "chart_parse" }, { activeDedicatedView: "invalid" }],
			[{ stage: "chart_parse" }, { activeDedicatedMessage: null }],
		] as const;
		for (const [failure, overrides] of invalidFailures) {
			const actions = usePlanModeArtifactGeneration(
				artifactInput(overrides as never) as never,
			);
			await actions.repairDedicatedViewAfterMermaidFailure({
				message: "failure",
				chart: "A-->",
				...failure,
			} as never);
		}
		expect(commands.generatePlanViewArtifact).not.toHaveBeenCalled();

		const input = artifactInput();
		const actions = usePlanModeArtifactGeneration(input as never);
		await actions.repairDedicatedViewAfterMermaidFailure({
			stage: "chart_render",
			message: "parse failed",
			chart: "A-->",
		} as never);
		expect(commands.generatePlanViewArtifact).toHaveBeenCalledWith(
			"task-1",
			"user_flow",
			expect.objectContaining({
				mermaidRenderRepair: expect.objectContaining({
					sourceMessageId: "view-current",
					stage: "chart_render",
				}),
			}),
		);
		expect(input.attemptedMermaidRenderRepairs.current).toContain(
			"task-1:user_flow",
		);
		await actions.repairDedicatedViewAfterMermaidFailure({
			stage: "chart_render",
			message: "again",
			chart: "A-->",
		} as never);
		expect(commands.generatePlanViewArtifact).toHaveBeenCalledTimes(1);
	});

	it("handles empty and failed Mermaid repair responses", async () => {
		commands.generatePlanViewArtifact.mockResolvedValueOnce(response({}));
		let input = artifactInput();
		let actions = usePlanModeArtifactGeneration(input as never);
		await actions.repairDedicatedViewAfterMermaidFailure({
			stage: "chart_parse",
			message: "bad",
			chart: "bad",
		} as never);
		expect(input.setGeneratedMessages).not.toHaveBeenCalled();

		commands.generatePlanViewArtifact.mockResolvedValueOnce(
			errorResponse("PLAN_VIEW_REPAIR_FAILED", "repair failed"),
		);
		input = artifactInput();
		actions = usePlanModeArtifactGeneration(input as never);
		await expect(
			actions.repairDedicatedViewAfterMermaidFailure({
				stage: "chart_parse",
				message: "bad",
				chart: "bad",
			} as never),
		).rejects.toThrow("repair failed");
	});

	it("derives the active workspace view, latest artifact, and source message", () => {
		const input = artifactInput({
			activeTab: "user-flow",
			workspace: {
				dedicatedViewArtifacts: [
					{
						kind: "user_flow",
						sourceMessageId: "old",
						createdAt: "2026-01-01",
					},
					{
						kind: "user_flow",
						sourceMessageId: "new",
						createdAt: "2026-02-01",
					},
				],
			},
			combinedTaskMessages: [{ id: "new" }],
		});
		const result = usePlanModeArtifactGenerationForWorkspace(input as never);
		expect(result.activeDedicatedView).toBe("user_flow");
		expect(result.activeDedicatedArtifact?.sourceMessageId).toBe("new");
		expect(result.activeDedicatedMessage?.id).toBe("new");

		const none = usePlanModeArtifactGenerationForWorkspace(
			artifactInput({
				activeTab: "status",
				workspace: null,
				combinedTaskMessages: [],
			}) as never,
		);
		expect(none.activeDedicatedView).toBeNull();
		expect(none.activeDedicatedArtifact).toBeNull();
		expect(none.activeDedicatedMessage).toBeNull();
	});
});

function questionnaireSession(overrides: Record<string, unknown> = {}) {
	return {
		id: "questionnaire-1",
		status: "in_progress",
		answers: [{ questionId: "q1", answer: { selectedOptionIds: ["yes"] } }],
		...overrides,
	};
}

function questionnaireInput(overrides: Record<string, unknown> = {}) {
	const runAction = vi.fn(
		async (_action: string, fn: () => Promise<unknown>) => {
			await fn();
			return true;
		},
	);
	const functionalSetter = vi.fn((update) =>
		typeof update === "function" ? update([]) : update,
	);
	return {
		sessionId: "task-1",
		isImplementationLocked: false,
		questionnaireEnabled: true,
		activeBlueprintMessage: { id: "blueprint-1" },
		activeQuestionnaireSession: questionnaireSession(),
		unansweredQuestions: [],
		questionGroups: [],
		answers: {},
		runAction,
		selectActiveTab: vi.fn(),
		setActiveSessionId: vi.fn(),
		setAnswers: vi.fn(),
		setSessions: functionalSetter,
		setAssemblyReadySessionIds: vi.fn((update) =>
			typeof update === "function" ? update(new Set()) : update,
		),
		setActionNotice: vi.fn(),
		...overrides,
	};
}

describe("Plan Mode questionnaire action coverage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		commands.startDesignQuestionnaire.mockImplementation(() =>
			Promise.resolve(response(questionnaireSession())),
		);
		commands.submitDesignQuestionnaireAnswers.mockImplementation(() =>
			Promise.resolve(response(questionnaireSession())),
		);
		commands.generateAdditionalDesignQuestionnaireQuestions.mockImplementation(
			() =>
				Promise.resolve(
					response({
						session: questionnaireSession(),
						result: { addedCount: 2, skippedDuplicateCount: 0 },
					}),
				),
		);
	});

	it("guards and starts questionnaire sessions", async () => {
		for (const overrides of [
			{ sessionId: null },
			{ isImplementationLocked: true },
			{ questionnaireEnabled: false },
		]) {
			const actions = usePlanModeQuestionnaireActions(
				questionnaireInput(overrides) as never,
			);
			await actions.startQuestionnaire();
		}
		expect(commands.startDesignQuestionnaire).not.toHaveBeenCalled();

		let input = questionnaireInput();
		let actions = usePlanModeQuestionnaireActions(input as never);
		await actions.startQuestionnaire();
		expect(commands.startDesignQuestionnaire).toHaveBeenCalledWith("task-1", {
			sourceBlueprintMessageId: "blueprint-1",
		});
		expect(input.setActiveSessionId).toHaveBeenCalledWith("questionnaire-1");
		expect(input.selectActiveTab).toHaveBeenCalledWith("questionnaire");

		commands.startDesignQuestionnaire.mockResolvedValueOnce(
			errorResponse("QUESTIONNAIRE_START_FAILED", "start failed"),
		);
		input = questionnaireInput({ activeBlueprintMessage: null });
		actions = usePlanModeQuestionnaireActions(input as never);
		await expect(actions.startQuestionnaire()).rejects.toThrow("start failed");
	});

	it("guards answer submission and routes completed sessions", async () => {
		for (const overrides of [
			{ sessionId: null },
			{ activeQuestionnaireSession: null },
			{ unansweredQuestions: [{}] },
			{ isImplementationLocked: true },
		]) {
			const actions = usePlanModeQuestionnaireActions(
				questionnaireInput(overrides) as never,
			);
			await actions.submitAnswersForNextStep();
		}
		expect(commands.submitDesignQuestionnaireAnswers).not.toHaveBeenCalled();

		const input = questionnaireInput({
			activeQuestionnaireSession: questionnaireSession({ status: "accepted" }),
		});
		const actions = usePlanModeQuestionnaireActions(input as never);
		await actions.submitAnswersForNextStep();
		expect(input.selectActiveTab).toHaveBeenCalledWith("status");
	});

	it("submits answers, inserts or replaces sessions, and marks completion", async () => {
		const completed = questionnaireSession({ status: "accepted" });
		commands.submitDesignQuestionnaireAnswers.mockImplementation(() =>
			Promise.resolve(response(completed)),
		);
		const input = questionnaireInput();
		const actions = usePlanModeQuestionnaireActions(input as never);
		await actions.submitAnswersForNextStep();
		expect(commands.submitDesignQuestionnaireAnswers).toHaveBeenCalled();
		expect(input.setSessions.mock.results[0]?.value).toEqual([completed]);
		expect(input.setAnswers).toHaveBeenCalledWith({
			q1: { selectedOptionIds: ["yes"] },
		});
		expect(input.setAssemblyReadySessionIds.mock.results[0]?.value).toContain(
			"questionnaire-1",
		);
		expect(input.selectActiveTab).toHaveBeenCalledWith("status");

		const existingInput = questionnaireInput({
			setSessions: vi.fn((update) =>
				update([
					questionnaireSession({ id: "questionnaire-1", status: "draft" }),
					questionnaireSession({ id: "other" }),
				]),
			),
		});
		const existingActions = usePlanModeQuestionnaireActions(
			existingInput as never,
		);
		await existingActions.submitAnswersForNextStep();
		expect(existingInput.setSessions.mock.results[0]?.value[0].status).toBe(
			"accepted",
		);
	});

	it("handles incomplete submissions and failures", async () => {
		commands.submitDesignQuestionnaireAnswers.mockResolvedValueOnce(
			response(questionnaireSession({ status: "in_progress" })),
		);
		let input = questionnaireInput();
		let actions = usePlanModeQuestionnaireActions(input as never);
		await actions.submitAnswersForNextStep();
		expect(input.setAssemblyReadySessionIds).not.toHaveBeenCalled();

		commands.submitDesignQuestionnaireAnswers.mockResolvedValueOnce(
			errorResponse("QUESTIONNAIRE_SUBMIT_FAILED", "submit failed"),
		);
		input = questionnaireInput();
		actions = usePlanModeQuestionnaireActions(input as never);
		await expect(actions.submitAnswersForNextStep()).rejects.toThrow(
			"submit failed",
		);
	});

	it("guards, creates, and reports additional questions", async () => {
		for (const overrides of [
			{ sessionId: null },
			{ isImplementationLocked: true },
			{ questionnaireEnabled: false },
		]) {
			const actions = usePlanModeQuestionnaireActions(
				questionnaireInput(overrides) as never,
			);
			await actions.requestAdditionalQuestionnaireQuestions();
		}
		expect(
			commands.generateAdditionalDesignQuestionnaireQuestions,
		).not.toHaveBeenCalled();

		let input = questionnaireInput();
		let actions = usePlanModeQuestionnaireActions(input as never);
		await actions.requestAdditionalQuestionnaireQuestions();
		expect(input.setActiveSessionId).toHaveBeenCalledWith("questionnaire-1");
		expect(input.setActionNotice).toHaveBeenCalledWith(
			"追加質問を 2 件作成しました。",
		);
		expect(input.selectActiveTab).toHaveBeenCalledWith("questionnaire");

		commands.generateAdditionalDesignQuestionnaireQuestions.mockResolvedValueOnce(
			response({
				session: null,
				result: { addedCount: 0, skippedDuplicateCount: 1 },
			}),
		);
		input = questionnaireInput();
		actions = usePlanModeQuestionnaireActions(input as never);
		await actions.requestAdditionalQuestionnaireQuestions();
		expect(input.setActiveSessionId).not.toHaveBeenCalled();
		expect(input.setActionNotice).toHaveBeenCalledWith(
			"追加質問はありません。",
		);

		commands.generateAdditionalDesignQuestionnaireQuestions.mockResolvedValueOnce(
			errorResponse("QUESTIONNAIRE_ADDITIONAL_FAILED", "additional failed"),
		);
		actions = usePlanModeQuestionnaireActions(questionnaireInput() as never);
		await expect(
			actions.requestAdditionalQuestionnaireQuestions(),
		).rejects.toThrow("additional failed");
	});
});
