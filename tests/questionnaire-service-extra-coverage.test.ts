import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	acceptDesignQuestionnaireReview,
	createDesignQuestionnaire,
	generateDesignQuestionnaireFollowUp,
	generateDesignQuestionnaireReview,
	leaveDesignQuestionnaireReviewUnadopted,
	saveDesignQuestionnaireAnswers,
} from "../api/modules/questionnaire/questionnaire.service";

const mocks = vi.hoisted(() => {
	const state = {
		task: null as Record<string, unknown> | null,
		session: null as Record<string, unknown> | null,
		questions: [] as Array<Record<string, unknown>>,
		answerViews: [] as Array<Record<string, unknown>>,
	};
	return {
		state,
		getTask: vi.fn(),
		getMessage: vi.fn(),
		listMessages: vi.fn(),
		createMessage: vi.fn(),
		assertCapability: vi.fn(),
		isBlueprint: vi.fn(),
		resolveProjectContext: vi.fn(),
		buildContext: vi.fn(),
		publishTransition: vi.fn(),
		generateInitial: vi.fn(),
		generateFollowUp: vi.fn(),
		generateDecision: vi.fn(),
		generateReview: vi.fn(),
		getQuestions: vi.fn(),
		parseInitial: vi.fn(),
		parseDecision: vi.fn(),
		parseReview: vi.fn(),
		renderReview: vi.fn(),
		getSession: vi.fn(),
		answersComplete: vi.fn(),
		parseAnswerViews: vi.fn(),
		dedupe: vi.fn(),
		validateAnswer: vi.fn(),
		createSession: vi.fn(),
		createQuestionSet: vi.fn(),
		upsertAnswer: vi.fn(),
		listAnswers: vi.fn(),
		createReview: vi.fn(),
		updateReview: vi.fn(),
		updateSessionStatus: vi.fn(),
	};
});

vi.mock("../api/modules/nightworkers/nightworkers.plan-mode-core.port", () => ({
	createPlanModeTaskMessage: mocks.createMessage,
	getPlanModeTask: mocks.getTask,
	getPlanModeTaskMessage: mocks.getMessage,
	listPlanModeTaskMessages: mocks.listMessages,
}));
vi.mock(
	"../api/modules/nightworkers/nightworkers.plan-mode-settings.service",
	() => ({ assertPlanModeCapabilityEnabled: mocks.assertCapability }),
);
vi.mock(
	"../api/modules/nightworkers/nightworkers.planning-helpers.service",
	() => ({ isBlueprintMessage: mocks.isBlueprint }),
);
vi.mock("../api/modules/specification/plan-mode-project-stack-context", () => ({
	resolvePlanModeQuestionnaireProjectContext: mocks.resolveProjectContext,
}));
vi.mock("../api/modules/questionnaire/questionnaire.repository", () => ({
	createDesignQuestionnaireSession: mocks.createSession,
	createDesignQuestionnaireQuestionSet: mocks.createQuestionSet,
	upsertDesignQuestionnaireAnswer: mocks.upsertAnswer,
	listDesignQuestionnaireAnswers: mocks.listAnswers,
	createDesignQuestionnaireReview: mocks.createReview,
	updateDesignQuestionnaireReview: mocks.updateReview,
	updateDesignQuestionnaireSessionStatus: mocks.updateSessionStatus,
}));
vi.mock("../api/modules/questionnaire/questionnaire-context", () => ({
	buildQuestionnairePlanModeContext: mocks.buildContext,
}));
vi.mock("../api/modules/questionnaire/questionnaire-events", () => ({
	publishQuestionnaireTransition: mocks.publishTransition,
}));
vi.mock(
	"../api/modules/questionnaire/questionnaire-generation.service",
	() => ({
		generateDesignQuestionnaireRawOutput: mocks.generateInitial,
		generateDesignQuestionnaireFollowUpRawOutput: mocks.generateFollowUp,
		generateDesignQuestionnaireFollowUpDecisionRawOutput:
			mocks.generateDecision,
		generateDesignQuestionnaireReviewRawOutput: mocks.generateReview,
	}),
);
vi.mock("../api/modules/questionnaire/questionnaire-parser.service", () => ({
	getSessionQuestions: mocks.getQuestions,
	parseDesignQuestionnaireRaw: mocks.parseInitial,
	parseDesignQuestionnaireFollowUpDecisionRaw: mocks.parseDecision,
	parseDesignDecisionReviewRaw: mocks.parseReview,
	renderDesignDecisionReviewMarkdown: mocks.renderReview,
}));
vi.mock("../api/modules/questionnaire/questionnaire-query.service", () => ({
	getDesignQuestionnaireSession: mocks.getSession,
	listDesignQuestionnaires: vi.fn(),
}));
vi.mock("../api/modules/questionnaire/questionnaire-validation", () => ({
	areQuestionnaireAnswersComplete: mocks.answersComplete,
	parseQuestionnaireAnswerViews: mocks.parseAnswerViews,
	removeDuplicateFollowUpQuestions: mocks.dedupe,
	validateDesignQuestionnaireAnswerForQuestion: mocks.validateAnswer,
}));

const taskId = "00000000-0000-4000-8000-000000000001";
const repositoryId = "00000000-0000-4000-8000-000000000002";
const sessionId = "00000000-0000-4000-8000-000000000003";
const blueprintId = "00000000-0000-4000-8000-000000000004";

function task(overrides: Record<string, unknown> = {}) {
	return {
		id: taskId,
		repositoryId,
		status: "planning",
		revision: 7,
		title: "Task title",
		description: "Task description",
		objective: "Task objective",
		...overrides,
	};
}

function questionSet(
	sequence: number,
	overrides: Record<string, unknown> = {},
) {
	return {
		id: `question-set-${sequence}`,
		sequence,
		questionnaire: { version: 1 },
		rawOutput: "raw",
		validationStatus: "valid",
		createdAt: "2026-08-01T00:00:00.000Z",
		...overrides,
	};
}

function session(overrides: Record<string, unknown> = {}) {
	return {
		id: sessionId,
		taskId,
		repositoryId,
		sourceBlueprintMessageId: null,
		status: "answering",
		questionSets: [questionSet(1)],
		answers: [],
		reviews: [],
		createdAt: "2026-08-01T00:00:00.000Z",
		updatedAt: "2026-08-01T00:00:00.000Z",
		...overrides,
	};
}

function answer(questionId = "question-one") {
	return { questionId };
}

function review(overrides: Record<string, unknown> = {}) {
	return {
		version: 1,
		sessionId,
		sourceBlueprintMessageId: null,
		title: "Decision Review",
		summary: "Summary",
		decisions: [],
		deferredItems: [],
		unresolvedQuestions: [],
		dataModelHandoffNotes: [],
		...overrides,
	};
}

async function expectCode(promise: Promise<unknown>, code: string) {
	await expect(promise).rejects.toMatchObject({ code });
}

beforeEach(() => {
	vi.resetAllMocks();
	mocks.state.task = task();
	mocks.state.session = session();
	mocks.state.questions = [{ id: "question-one", answerType: "multi_choice" }];
	mocks.state.answerViews = [
		{ questionId: "question-one", answer: answer("question-one") },
	];
	mocks.getTask.mockImplementation(async () => mocks.state.task);
	mocks.getMessage.mockResolvedValue({
		id: blueprintId,
		taskId,
		messageType: "markdown_document",
	});
	mocks.listMessages.mockResolvedValue([{ id: "message-1" }]);
	mocks.createMessage.mockResolvedValue({ id: "published-message-1" });
	mocks.isBlueprint.mockReturnValue(true);
	mocks.resolveProjectContext.mockResolvedValue({
		projectStackContext: { stack: "typescript" },
		repositoryPolicy: { policy: "safe" },
	});
	mocks.buildContext.mockReturnValue({ digest: "context" });
	mocks.generateInitial.mockResolvedValue("initial raw");
	mocks.generateFollowUp.mockResolvedValue("follow-up raw");
	mocks.generateDecision.mockResolvedValue("decision raw");
	mocks.generateReview.mockResolvedValue("review raw");
	mocks.parseInitial.mockReturnValue({ ok: true, value: { version: 1 } });
	mocks.parseDecision.mockReturnValue({
		ok: true,
		value: { action: "ready_for_design_assembly", questionnaire: null },
	});
	mocks.parseReview.mockReturnValue({ ok: true, value: review() });
	mocks.renderReview.mockReturnValue("# Decision Review");
	mocks.getSession.mockImplementation(async () => mocks.state.session);
	mocks.getQuestions.mockImplementation(() => mocks.state.questions);
	mocks.validateAnswer.mockReturnValue(undefined);
	mocks.parseAnswerViews.mockImplementation(() => mocks.state.answerViews);
	mocks.answersComplete.mockReturnValue(true);
	mocks.dedupe.mockImplementation((_session, questionnaire) => questionnaire);
	mocks.createSession.mockResolvedValue({ id: sessionId });
	mocks.createQuestionSet.mockResolvedValue({ id: "question-set-created" });
	mocks.upsertAnswer.mockResolvedValue({ id: "answer-1" });
	mocks.listAnswers.mockResolvedValue([
		{ questionId: "question-one", answerJson: answer("question-one") },
	]);
	mocks.createReview.mockResolvedValue({ id: "review-row-1" });
	mocks.updateReview.mockResolvedValue({ id: "review-row-1" });
	mocks.updateSessionStatus.mockImplementation(async (_id, status) => {
		mocks.state.session = { ...(mocks.state.session ?? {}), status };
		return mocks.state.session;
	});
});

describe("createDesignQuestionnaire", () => {
	it("rejects a missing task and a terminal task", async () => {
		mocks.state.task = null;
		await expect(createDesignQuestionnaire(taskId)).rejects.toMatchObject({
			code: "NOT_FOUND",
		});

		mocks.state.task = task({ status: "completed" });
		await expectCode(createDesignQuestionnaire(taskId), "PLAN_MODE_READ_ONLY");
	});

	it.each([
		"cancelled",
		"failed",
		"timed_out",
	])("rejects terminal %s task mutation", async (status) => {
		mocks.state.task = task({ status });
		await expectCode(createDesignQuestionnaire(taskId), "PLAN_MODE_READ_ONLY");
	});

	it("propagates questionnaire capability rejection", async () => {
		const error = new Error("capability disabled");
		mocks.assertCapability.mockImplementation(() => {
			throw error;
		});
		await expect(createDesignQuestionnaire(taskId)).rejects.toBe(error);
	});

	it("generates from explicit prompt and optional provider settings", async () => {
		const signal = new AbortController().signal;
		const routeOverride = { providerEndpointId: "provider", model: "model" };
		await createDesignQuestionnaire(taskId, null, "Explicit prompt", {
			routeOverride,
			role: "review",
			executionPolicy: { strategy: "single" },
			usageTrace: { source: "test" },
			commandIdempotencyKey: "command-1",
			signal,
		});

		expect(mocks.generateInitial).toHaveBeenCalledWith({
			taskId,
			repositoryId,
			sourceBlueprintMessage: null,
			taskPrompt: "Explicit prompt",
			projectStackContext: { stack: "typescript" },
			repositoryPolicy: { policy: "safe" },
			planModeContext: { digest: "context" },
			routeOverride,
			role: "review",
			executionPolicy: { strategy: "single" },
			usageTrace: { source: "test" },
			signal,
		});
		expect(mocks.createSession).toHaveBeenCalledWith(
			expect.objectContaining({
				sourceBlueprintMessageId: null,
				commandIdempotencyKey: "command-1",
			}),
		);
		expect(mocks.createQuestionSet).toHaveBeenCalledWith(
			expect.objectContaining({
				questionnaireJson: { version: 1 },
				validationStatus: "valid",
			}),
		);
		expect(mocks.state.session?.status).toBe("answering");
		expect(mocks.publishTransition).toHaveBeenCalled();
	});

	it.each([
		[
			"objective",
			{ objective: "Objective", description: "Description" },
			"Objective",
		],
		[
			"description",
			{ objective: "", description: "Description" },
			"Description",
		],
		["title", { objective: "", description: "", title: "Title" }, "Title"],
	] as const)("uses task %s as prompt fallback", async (_name, overrides, expected) => {
		mocks.state.task = task(overrides);
		await createDesignQuestionnaire(taskId);
		expect(mocks.generateInitial).toHaveBeenCalledWith(
			expect.objectContaining({
				taskPrompt: expected,
				routeOverride: null,
				role: "plan",
			}),
		);
	});

	it("validates and carries an owned Blueprint source", async () => {
		await createDesignQuestionnaire(taskId, blueprintId);

		expect(mocks.getTask).toHaveBeenCalledTimes(2);
		expect(mocks.generateInitial).toHaveBeenCalledWith(
			expect.objectContaining({
				sourceBlueprintMessage: expect.objectContaining({ id: blueprintId }),
			}),
		);
		expect(mocks.parseInitial).toHaveBeenCalledWith(
			"initial raw",
			expect.objectContaining({
				sourceBlueprintMessageId: blueprintId,
				sourceKind: "blueprint",
			}),
			expect.any(Object),
		);
	});

	it("rejects Blueprint lookup task disappearance", async () => {
		mocks.getTask.mockResolvedValueOnce(task()).mockResolvedValueOnce(null);
		await expect(
			createDesignQuestionnaire(taskId, blueprintId),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it.each([
		[null, "missing message"],
		[{ id: blueprintId, taskId: "other-task" }, "foreign message"],
	] as const)("rejects %s Blueprint source", async (message) => {
		mocks.getMessage.mockResolvedValue(message);
		await expectCode(
			createDesignQuestionnaire(taskId, blueprintId),
			"SOURCE_BLUEPRINT_NOT_FOUND",
		);
	});

	it("rejects a non-Blueprint source message", async () => {
		mocks.isBlueprint.mockReturnValue(false);
		await expectCode(
			createDesignQuestionnaire(taskId, blueprintId),
			"SOURCE_BLUEPRINT_REQUIRED",
		);
	});

	it("recovers rawText from an LLM error and persists invalid parse output", async () => {
		const error = Object.assign(new Error("parse failed"), {
			rawText: " recovered raw ",
			rawContent: "ignored raw content",
		});
		mocks.generateInitial.mockRejectedValue(error);
		mocks.parseInitial.mockReturnValue({ ok: false, error: "invalid" });

		await createDesignQuestionnaire(taskId, "", undefined, {
			routeOverride: null,
			commandIdempotencyKey: null,
		});

		expect(mocks.parseInitial).toHaveBeenCalledWith(
			" recovered raw ",
			expect.objectContaining({ sourceKind: "plan_mode_intake" }),
			expect.any(Object),
		);
		expect(mocks.createQuestionSet).toHaveBeenCalledWith({
			sessionId,
			sequence: 1,
			rawOutput: " recovered raw ",
			validationStatus: "invalid",
		});
		expect(mocks.state.session?.status).toBe("needs_edit");
	});

	it("recovers rawContent when rawText is absent", async () => {
		mocks.generateInitial.mockRejectedValue(
			Object.assign(new Error("provider failed"), {
				rawContent: "raw content",
			}),
		);
		await createDesignQuestionnaire(taskId);
		expect(mocks.parseInitial).toHaveBeenCalledWith(
			"raw content",
			expect.any(Object),
			expect.any(Object),
		);
	});

	it.each([
		[new Error("provider unavailable"), "no raw fields"],
		[
			Object.assign(new Error("empty raw"), {
				rawText: "  ",
				rawContent: "usable but shadowed",
			}),
			"blank rawText shadows content",
		],
	] as const)("propagates LLM failure with %s", async (error) => {
		mocks.generateInitial.mockRejectedValue(error);
		await expect(createDesignQuestionnaire(taskId)).rejects.toBe(error);
	});

	it("checks cancellation after generation before parsing or persistence", async () => {
		const signal = {
			throwIfAborted: vi.fn(() => {
				throw new Error("aborted");
			}),
		} as unknown as AbortSignal;
		await expect(
			createDesignQuestionnaire(taskId, null, undefined, { signal }),
		).rejects.toThrow("aborted");
		expect(mocks.parseInitial).not.toHaveBeenCalled();
		expect(mocks.createSession).not.toHaveBeenCalled();
	});

	it("propagates session and question-set persistence failures", async () => {
		const sessionError = new Error("session insert failed");
		mocks.createSession.mockRejectedValueOnce(sessionError);
		await expect(createDesignQuestionnaire(taskId)).rejects.toBe(sessionError);

		const setError = new Error("set insert failed");
		mocks.createQuestionSet.mockRejectedValueOnce(setError);
		await expect(createDesignQuestionnaire(taskId)).rejects.toBe(setError);
	});
});

describe("saveDesignQuestionnaireAnswers", () => {
	it("rejects missing task and revision conflict before capability checks", async () => {
		mocks.state.task = null;
		await expect(
			saveDesignQuestionnaireAnswers(taskId, sessionId, [answer()]),
		).rejects.toMatchObject({ code: "NOT_FOUND" });

		mocks.state.task = task({ revision: 8 });
		await expect(
			saveDesignQuestionnaireAnswers(taskId, sessionId, [answer()], {
				expectedTaskRevision: 7,
			}),
		).rejects.toMatchObject({
			code: "TASK_REVISION_CONFLICT",
			details: { currentTaskRevision: 8 },
		});
		expect(mocks.assertCapability).not.toHaveBeenCalled();
	});

	it("accepts matching revision and returns immutable session states", async () => {
		for (const status of ["review_ready", "accepted"]) {
			mocks.state.session = session({ status });
			await expect(
				saveDesignQuestionnaireAnswers(taskId, sessionId, [answer()], {
					expectedTaskRevision: 7,
				}),
			).resolves.toMatchObject({ status });
		}
		expect(mocks.upsertAnswer).not.toHaveBeenCalled();
	});

	it("rejects schema-invalid and unknown-question answers", async () => {
		await expect(
			saveDesignQuestionnaireAnswers(taskId, sessionId, [
				{ questionId: "INVALID ID" },
			]),
		).rejects.toThrow();

		await expectCode(
			saveDesignQuestionnaireAnswers(taskId, sessionId, [answer("unknown")]),
			"UNKNOWN_QUESTION",
		);
	});

	it("validates and upserts each parsed answer", async () => {
		mocks.state.questions = [{ id: "question-one" }, { id: "question-two" }];
		mocks.answersComplete.mockReturnValue(false);
		mocks.state.answerViews = [];

		await saveDesignQuestionnaireAnswers(taskId, sessionId, [
			answer("question-one"),
			answer("question-two"),
		]);

		expect(mocks.validateAnswer).toHaveBeenCalledTimes(2);
		expect(mocks.upsertAnswer).toHaveBeenCalledTimes(2);
		expect(mocks.state.session?.status).toBe("answering");
	});

	it("propagates answer validation failure before writes", async () => {
		const error = new Error("answer invalid");
		mocks.validateAnswer.mockImplementation(() => {
			throw error;
		});
		await expect(
			saveDesignQuestionnaireAnswers(taskId, sessionId, [answer()]),
		).rejects.toBe(error);
		expect(mocks.upsertAnswer).not.toHaveBeenCalled();
	});

	it.each([
		[new Error("database unavailable"), "database unavailable"],
		["raw failure", "raw failure"],
	] as const)("wraps answer persistence error %#", async (error, message) => {
		mocks.upsertAnswer.mockRejectedValue(error);
		await expect(
			saveDesignQuestionnaireAnswers(taskId, sessionId, [answer()]),
		).rejects.toThrow(
			`Questionnaire永続化に失敗しました (answer:question-one): ${message}`,
		);
	});

	it.each([
		[new Error("read failed"), "read failed"],
		[{ reason: "offline" }, "[object Object]"],
	] as const)("wraps answer readback error %#", async (error, message) => {
		mocks.listAnswers.mockRejectedValue(error);
		await expect(
			saveDesignQuestionnaireAnswers(taskId, sessionId, [answer()]),
		).rejects.toThrow(
			`Questionnaire永続化に失敗しました (answer-readback): ${message}`,
		);
	});

	it("propagates answer readback parse errors", async () => {
		const error = new Error("stored answer malformed");
		mocks.parseAnswerViews.mockImplementation(() => {
			throw error;
		});
		await expect(
			saveDesignQuestionnaireAnswers(taskId, sessionId, [answer()]),
		).rejects.toBe(error);
	});

	it("passes readback answers to completeness evaluation", async () => {
		mocks.answersComplete.mockReturnValue(false);
		await saveDesignQuestionnaireAnswers(taskId, sessionId, [answer()]);
		expect(mocks.answersComplete).toHaveBeenCalledWith(
			expect.any(Object),
			expect.any(Map),
		);
		expect(
			mocks.answersComplete.mock.calls[0]?.[1].get("question-one"),
		).toEqual(answer("question-one"));
	});

	it("wraps answering status persistence failure", async () => {
		mocks.answersComplete.mockReturnValue(false);
		mocks.updateSessionStatus.mockRejectedValue(new Error("status failed"));
		await expect(
			saveDesignQuestionnaireAnswers(taskId, sessionId, [answer()]),
		).rejects.toThrow(
			"Questionnaire永続化に失敗しました (session-status): status failed",
		);
	});

	it("rejects a missing answering status result", async () => {
		mocks.answersComplete.mockReturnValue(false);
		mocks.getSession
			.mockResolvedValueOnce(session())
			.mockResolvedValueOnce(null);
		await expect(
			saveDesignQuestionnaireAnswers(taskId, sessionId, [answer()]),
		).rejects.toThrow("updated Questionnaire session is missing");
	});

	it("finalizes complete answers by default and with explicit policy", async () => {
		for (const options of [
			{},
			{ completionPolicy: "finalize_current_questions" },
		] as const) {
			mocks.state.session = session();
			await expect(
				saveDesignQuestionnaireAnswers(taskId, sessionId, [answer()], options),
			).resolves.toMatchObject({ status: "review_ready" });
		}
		expect(mocks.generateDecision).not.toHaveBeenCalled();
	});

	it("rejects a missing finalized status result", async () => {
		mocks.getSession
			.mockResolvedValueOnce(session())
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(session());
		await expect(
			saveDesignQuestionnaireAnswers(taskId, sessionId, [answer()]),
		).rejects.toThrow("updated Questionnaire session is missing");
	});

	it("skips pre-assessment status persistence for assess_follow_up", async () => {
		await saveDesignQuestionnaireAnswers(taskId, sessionId, [answer()], {
			completionPolicy: "assess_follow_up",
		});
		expect(mocks.generateDecision).toHaveBeenCalled();
		expect(mocks.updateSessionStatus).toHaveBeenCalledTimes(1);
		expect(mocks.state.session?.status).toBe("review_ready");
	});
});

describe("follow-up generation and assessment", () => {
	it("rejects missing and terminal tasks", async () => {
		mocks.state.task = null;
		await expect(
			generateDesignQuestionnaireFollowUp(taskId, sessionId),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		mocks.state.task = task({ status: "failed" });
		await expectCode(
			generateDesignQuestionnaireFollowUp(taskId, sessionId),
			"PLAN_MODE_READ_ONLY",
		);
	});

	it("stops explicit follow-up at the maximum page count", async () => {
		mocks.state.session = session({
			questionSets: [1, 2, 3, 4].map((sequence) => questionSet(sequence)),
		});
		await expect(
			generateDesignQuestionnaireFollowUp(taskId, sessionId),
		).resolves.toMatchObject({ status: "review_ready" });
		expect(mocks.generateFollowUp).not.toHaveBeenCalled();
	});

	it.each([
		[true, "answering", "valid"],
		[false, "needs_edit", "invalid"],
	] as const)("persists explicit follow-up parse ok=%s", async (ok, status, validationStatus) => {
		mocks.state.session = session({
			sourceBlueprintMessageId: blueprintId,
			questionSets: [questionSet(3), questionSet(1)],
		});
		mocks.parseInitial.mockReturnValue(
			ok ? { ok: true, value: { version: 1 } } : { ok: false },
		);
		const signal = new AbortController().signal;

		await generateDesignQuestionnaireFollowUp(taskId, sessionId, {
			signal,
			usageTrace: { source: "test" },
			role: "review",
			executionPolicy: { strategy: "single" },
		});

		expect(mocks.generateFollowUp).toHaveBeenCalledWith(expect.any(Object), {
			signal,
			usageTrace: { source: "test" },
			role: "review",
			executionPolicy: { strategy: "single" },
		});
		expect(mocks.parseInitial).toHaveBeenCalledWith(
			"follow-up raw",
			expect.objectContaining({
				sourceBlueprintMessageId: blueprintId,
				sourceKind: "blueprint",
			}),
			expect.objectContaining({
				questionSetId: "follow-up-4",
				questionIdPrefix: "follow-up-4",
			}),
		);
		expect(mocks.createQuestionSet).toHaveBeenCalledWith(
			expect.objectContaining({
				sequence: 4,
				questionnaireJson: ok ? { version: 1 } : undefined,
				validationStatus,
			}),
		);
		expect(mocks.state.session?.status).toBe(status);
	});

	it("uses sequence one and intake source for empty optional question sets", async () => {
		mocks.state.session = session({ questionSets: [] });
		await generateDesignQuestionnaireFollowUp(taskId, sessionId);
		expect(mocks.parseInitial).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({ sourceKind: "plan_mode_intake" }),
			expect.objectContaining({ questionSetId: "follow-up-1" }),
		);
	});

	it("checks cancellation after explicit follow-up generation", async () => {
		const signal = {
			throwIfAborted: vi.fn(() => {
				throw new Error("aborted");
			}),
		} as unknown as AbortSignal;
		await expect(
			generateDesignQuestionnaireFollowUp(taskId, sessionId, { signal }),
		).rejects.toThrow("aborted");
		expect(mocks.createQuestionSet).not.toHaveBeenCalled();
	});

	it("propagates explicit follow-up LLM, question-set, and status failures", async () => {
		const llmError = new Error("follow-up unavailable");
		mocks.generateFollowUp.mockRejectedValueOnce(llmError);
		await expect(
			generateDesignQuestionnaireFollowUp(taskId, sessionId),
		).rejects.toBe(llmError);

		const setError = new Error("set insert failed");
		mocks.createQuestionSet.mockRejectedValueOnce(setError);
		await expect(
			generateDesignQuestionnaireFollowUp(taskId, sessionId),
		).rejects.toBe(setError);

		const statusError = new Error("status failed");
		mocks.updateSessionStatus.mockRejectedValueOnce(statusError);
		await expect(
			generateDesignQuestionnaireFollowUp(taskId, sessionId),
		).rejects.toBe(statusError);
	});

	it("stops assessed follow-up at maximum pages", async () => {
		mocks.state.session = session({
			questionSets: [1, 2, 3, 4].map((sequence) => questionSet(sequence)),
		});
		await saveDesignQuestionnaireAnswers(taskId, sessionId, [answer()], {
			completionPolicy: "assess_follow_up",
		});
		expect(mocks.generateDecision).not.toHaveBeenCalled();
		expect(mocks.state.session?.status).toBe("review_ready");
	});

	it.each([
		[{ ok: false }, "needs_edit", "invalid"],
		[
			{ ok: true, value: { action: "follow_up", questionnaire: null } },
			"needs_edit",
			"invalid",
		],
	] as const)("handles assessed decision boundary %#", async (parsed, status, validationStatus) => {
		mocks.parseDecision.mockReturnValue(parsed);
		await saveDesignQuestionnaireAnswers(taskId, sessionId, [answer()], {
			completionPolicy: "assess_follow_up",
		});
		expect(mocks.createQuestionSet).toHaveBeenCalledWith(
			expect.objectContaining({ sequence: 2, validationStatus }),
		);
		expect(mocks.state.session?.status).toBe(status);
	});

	it("moves ready decision directly to review_ready", async () => {
		await saveDesignQuestionnaireAnswers(taskId, sessionId, [answer()], {
			completionPolicy: "assess_follow_up",
		});
		expect(mocks.createQuestionSet).not.toHaveBeenCalled();
		expect(mocks.state.session?.status).toBe("review_ready");
	});

	it("deduplicates all proposed follow-up questions into review_ready", async () => {
		mocks.parseDecision.mockReturnValue({
			ok: true,
			value: { action: "follow_up", questionnaire: { version: 1 } },
		});
		mocks.dedupe.mockReturnValue(null);
		await saveDesignQuestionnaireAnswers(taskId, sessionId, [answer()], {
			completionPolicy: "assess_follow_up",
		});
		expect(mocks.dedupe).toHaveBeenCalled();
		expect(mocks.createQuestionSet).not.toHaveBeenCalled();
		expect(mocks.state.session?.status).toBe("review_ready");
	});

	it("persists a deduped follow-up and returns to answering", async () => {
		const questionnaire = { version: 1, title: "Follow-up" };
		const deduped = { ...questionnaire, deduped: true };
		mocks.state.session = session({ sourceBlueprintMessageId: blueprintId });
		mocks.parseDecision.mockReturnValue({
			ok: true,
			value: { action: "follow_up", questionnaire },
		});
		mocks.dedupe.mockReturnValue(deduped);

		await saveDesignQuestionnaireAnswers(taskId, sessionId, [answer()], {
			completionPolicy: "assess_follow_up",
			role: "review",
			executionPolicy: { strategy: "single" },
			usageTrace: { source: "test" },
		});

		expect(mocks.generateDecision).toHaveBeenCalledWith(
			expect.any(Object),
			expect.objectContaining({ role: "review" }),
		);
		expect(mocks.parseDecision).toHaveBeenCalledWith(
			"decision raw",
			expect.objectContaining({
				sourceKind: "blueprint",
				sourceBlueprintMessageId: blueprintId,
			}),
			2,
		);
		expect(mocks.createQuestionSet).toHaveBeenCalledWith(
			expect.objectContaining({
				questionnaireJson: deduped,
				validationStatus: "valid",
			}),
		);
		expect(mocks.state.session?.status).toBe("answering");
	});
});

describe("review generation and acceptance", () => {
	it("rejects missing review task and terminal review mutation", async () => {
		mocks.state.task = null;
		await expect(
			generateDesignQuestionnaireReview(taskId, sessionId),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		mocks.state.task = task({ status: "cancelled" });
		await expectCode(
			generateDesignQuestionnaireReview(taskId, sessionId),
			"PLAN_MODE_READ_ONLY",
		);
	});

	it.each([
		[true, "draft", "review_ready", "valid"],
		[false, "needs_edit", "needs_edit", "invalid"],
	] as const)("persists review parse ok=%s", async (ok, reviewStatus, sessionStatus, validationStatus) => {
		mocks.parseReview.mockReturnValue(
			ok ? { ok: true, value: review() } : { ok: false },
		);
		const signal = new AbortController().signal;

		const result = await generateDesignQuestionnaireReview(taskId, sessionId, {
			signal,
			usageTrace: { source: "test" },
			role: "review",
			executionPolicy: { strategy: "single" },
		});

		expect(mocks.generateReview).toHaveBeenCalledWith(expect.any(Object), {
			signal,
			usageTrace: { source: "test" },
			role: "review",
			executionPolicy: { strategy: "single" },
		});
		expect(mocks.createReview).toHaveBeenCalledWith({
			sessionId,
			reviewJson: ok ? review() : null,
			status: reviewStatus,
		});
		expect(result).toMatchObject({
			reviewId: "review-row-1",
			rawOutput: "review raw",
			validationStatus,
			session: { status: sessionStatus },
		});
	});

	it("checks cancellation after review generation", async () => {
		const signal = {
			throwIfAborted: vi.fn(() => {
				throw new Error("aborted");
			}),
		} as unknown as AbortSignal;
		await expect(
			generateDesignQuestionnaireReview(taskId, sessionId, { signal }),
		).rejects.toThrow("aborted");
		expect(mocks.createReview).not.toHaveBeenCalled();
	});

	it("propagates review LLM, parse, persistence, and status failures", async () => {
		const llm = new Error("review LLM failed");
		mocks.generateReview.mockRejectedValueOnce(llm);
		await expect(
			generateDesignQuestionnaireReview(taskId, sessionId),
		).rejects.toBe(llm);

		const parse = new Error("review parse failed");
		mocks.parseReview.mockImplementationOnce(() => {
			throw parse;
		});
		await expect(
			generateDesignQuestionnaireReview(taskId, sessionId),
		).rejects.toBe(parse);

		const persist = new Error("review insert failed");
		mocks.createReview.mockRejectedValueOnce(persist);
		await expect(
			generateDesignQuestionnaireReview(taskId, sessionId),
		).rejects.toBe(persist);

		const status = new Error("status failed");
		mocks.updateSessionStatus.mockRejectedValueOnce(status);
		await expect(
			generateDesignQuestionnaireReview(taskId, sessionId),
		).rejects.toBe(status);
	});

	it("rejects acceptance without a draft review", async () => {
		for (const reviews of [
			[],
			[{ id: "review-1", status: "accepted", review: review() }],
			[{ id: "review-1", status: "draft", review: null }],
		]) {
			mocks.state.session = session({ reviews });
			await expectCode(
				acceptDesignQuestionnaireReview(taskId, sessionId),
				"NO_REVIEW_DRAFT",
			);
		}
	});

	it("rejects acceptance when the task disappeared", async () => {
		mocks.state.task = null;
		await expect(
			acceptDesignQuestionnaireReview(taskId, sessionId),
		).rejects.toMatchObject({ code: "NOT_FOUND", message: "Task not found" });
	});

	it("accepts the first usable draft and publishes its optional provenance", async () => {
		const decisionReview = review({ title: "Accepted Design" });
		mocks.state.session = session({
			sourceBlueprintMessageId: blueprintId,
			reviews: [
				{ id: "old", status: "needs_edit", review: review() },
				{ id: "draft-1", status: "draft", review: decisionReview },
			],
		});

		await expect(
			acceptDesignQuestionnaireReview(taskId, sessionId),
		).resolves.toMatchObject({ status: "accepted" });
		expect(mocks.createMessage).toHaveBeenCalledWith({
			taskId,
			role: "assistant",
			content: "# Decision Review",
			messageType: "markdown_document",
			payloadJson: {
				intent: "design_decision_review",
				title: "Accepted Design",
				designDecisionReview: decisionReview,
				source: "design-questionnaire",
				sourceBlueprintMessageId: blueprintId,
				questionnaireSessionId: sessionId,
			},
		});
		expect(mocks.updateReview).toHaveBeenCalledWith("draft-1", {
			status: "accepted",
			publishedMessageId: "published-message-1",
		});
	});

	it("propagates acceptance message, review, and status persistence failures", async () => {
		mocks.state.session = session({
			reviews: [{ id: "draft-1", status: "draft", review: review() }],
		});
		const messageError = new Error("message failed");
		mocks.createMessage.mockRejectedValueOnce(messageError);
		await expect(
			acceptDesignQuestionnaireReview(taskId, sessionId),
		).rejects.toBe(messageError);

		const reviewError = new Error("review update failed");
		mocks.updateReview.mockRejectedValueOnce(reviewError);
		await expect(
			acceptDesignQuestionnaireReview(taskId, sessionId),
		).rejects.toBe(reviewError);

		const statusError = new Error("session update failed");
		mocks.updateSessionStatus.mockRejectedValueOnce(statusError);
		await expect(
			acceptDesignQuestionnaireReview(taskId, sessionId),
		).rejects.toBe(statusError);
	});
});

describe("leaveDesignQuestionnaireReviewUnadopted", () => {
	it("rejects missing task", async () => {
		mocks.state.task = null;
		await expect(
			leaveDesignQuestionnaireReviewUnadopted(taskId, sessionId),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("leaves the latest review unadopted", async () => {
		mocks.state.session = session({
			reviews: [
				{ id: "latest-review", status: "draft", review: review() },
				{ id: "older-review", status: "draft", review: review() },
			],
		});
		await expect(
			leaveDesignQuestionnaireReviewUnadopted(taskId, sessionId),
		).resolves.toMatchObject({ status: "needs_edit" });
		expect(mocks.updateReview).toHaveBeenCalledWith("latest-review", {
			status: "left_unadopted",
		});
	});

	it("handles a session without reviews", async () => {
		mocks.state.session = session({ reviews: [] });
		await leaveDesignQuestionnaireReviewUnadopted(taskId, sessionId);
		expect(mocks.updateReview).not.toHaveBeenCalled();
		expect(mocks.state.session?.status).toBe("needs_edit");
	});

	it("rejects terminal tasks and propagates update failures", async () => {
		mocks.state.task = task({ status: "timed_out" });
		await expectCode(
			leaveDesignQuestionnaireReviewUnadopted(taskId, sessionId),
			"PLAN_MODE_READ_ONLY",
		);

		mocks.state.task = task();
		mocks.state.session = session({
			reviews: [{ id: "review-1", status: "draft", review: review() }],
		});
		const error = new Error("review update failed");
		mocks.updateReview.mockRejectedValue(error);
		await expect(
			leaveDesignQuestionnaireReviewUnadopted(taskId, sessionId),
		).rejects.toBe(error);
	});
});
