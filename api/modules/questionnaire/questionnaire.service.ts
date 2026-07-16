import {
	type DesignQuestionnaireAnswer,
	type DesignQuestionnaireSession,
	designDecisionReviewSchema,
	designQuestionnaireAnswerSchema,
	designQuestionnaireFollowUpDecisionSchema,
	questionnaireChoiceFormSchema,
} from "../../../shared/schemas/design-questionnaire.schema";
import type { TraceProvenance } from "../../../shared/schemas/trace-provenance.schema";
import { AppError, NotFoundError } from "../../lib/errors";
import {
	buildDesignQuestionnaireFollowUpDecisionSystemPrompt,
	buildDesignQuestionnaireFollowUpDecisionUserPrompt,
	buildDesignQuestionnaireFollowUpUserPrompt,
	buildDesignQuestionnaireInitialUserPrompt,
	buildDesignQuestionnaireReviewSystemPrompt,
	buildDesignQuestionnaireReviewUserPrompt,
	buildDesignQuestionnaireSystemPrompt,
} from "../../services/structured-generation/prompts/design-questionnaire";
import { callStructuredOutputWithRepair } from "../../services/structured-generation/structured-output-repair.service";
import { createStructuredOutputContract } from "../../services/structured-llm";
import type {
	StructuredLlmModelTarget,
	StructuredLlmRole,
} from "../../services/structured-llm/settings";
import {
	createPlanModeTaskMessage,
	getPlanModeTask,
	getPlanModeTaskMessage,
	listPlanModeTaskMessages,
	type PlanModeTaskMessage,
} from "../nightworkers/nightworkers.plan-mode-core.port";
import { assertPlanModeCapabilityEnabled } from "../nightworkers/nightworkers.plan-mode-settings.service";
import { isBlueprintMessage } from "../nightworkers/nightworkers.planning-helpers.service";
import { resolvePlanModeProjectStackContext } from "../specification/plan-mode-project-stack-context";
import * as repo from "./questionnaire.repository";
import { buildQuestionnairePlanModeContext } from "./questionnaire-context";
import { publishQuestionnaireReady } from "./questionnaire-events";
import {
	buildDesignQuestionnaireSessionView,
	designDecisionReviewJsonSchema,
	designQuestionnaireFollowUpDecisionJsonSchema,
	getSessionQuestions,
	parseDesignDecisionReviewRaw,
	parseDesignQuestionnaireFollowUpDecisionRaw,
	parseDesignQuestionnaireRaw,
	questionnaireChoiceFormJsonSchema,
	renderDesignDecisionReviewMarkdown,
} from "./questionnaire-parser.service";
import {
	areQuestionnaireAnswersComplete,
	parseQuestionnaireAnswerViews,
	removeDuplicateFollowUpQuestions,
	validateDesignQuestionnaireAnswerForQuestion,
} from "./questionnaire-validation";

const MAX_DESIGN_QUESTIONNAIRE_PAGES = 4;
const PLAN_MODE_READ_ONLY_TASK_STATUSES = new Set([
	"completed",
	"cancelled",
	"failed",
	"timed_out",
]);

function assertPlanModeMutable(task: { status: string }) {
	if (!PLAN_MODE_READ_ONLY_TASK_STATUSES.has(task.status)) return;
	throw new AppError(
		409,
		"PLAN_MODE_READ_ONLY",
		"Terminal sessions cannot modify Plan Mode artifacts.",
	);
}

function questionnairePersistenceError(stage: string, error: unknown) {
	return new Error(
		`Questionnaire永続化に失敗しました (${stage}): ${error instanceof Error ? error.message : String(error)}`,
		{ cause: error },
	);
}
export async function createDesignQuestionnaire(
	taskId: string,
	sourceBlueprintMessageId?: string | null,
	sourcePrompt?: string,
	options: {
		routeOverride?: StructuredLlmModelTarget | null;
		role?: StructuredLlmRole;
		usageTrace?: TraceProvenance;
		missionPilotActionKey?: string | null;
	} = {},
) {
	const task = await getPlanModeTask(taskId);
	if (!task) throw new NotFoundError("Task not found");
	assertPlanModeCapabilityEnabled("questionnaire");
	assertPlanModeMutable(task);
	const sourceBlueprintMessage = sourceBlueprintMessageId
		? (await getQuestionnaireTaskAndBlueprint(taskId, sourceBlueprintMessageId))
				.sourceBlueprintMessage
		: null;
	const projectStackContext = await resolvePlanModeProjectStackContext(
		task.repositoryId,
	);
	const taskMessages = await listPlanModeTaskMessages(taskId);
	const planModeContext = buildQuestionnairePlanModeContext(taskMessages);
	const rawOutput = await generateDesignQuestionnaireRawOutput({
		taskId,
		repositoryId: task.repositoryId,
		sourceBlueprintMessage,
		taskPrompt:
			sourcePrompt || task.objective || task.description || task.title,
		projectStackContext,
		planModeContext,
		routeOverride: options.routeOverride || null,
		role: options.role ?? "plan",
		usageTrace: options.usageTrace,
	}).catch(async (error) => {
		const rawContent =
			(error as Error & { rawContent?: string; rawText?: string }).rawText ??
			(error as Error & { rawContent?: string }).rawContent;
		if (rawContent?.trim()) return rawContent;
		throw error;
	});
	const parsed = parseDesignQuestionnaireRaw(rawOutput, {
		taskId,
		repositoryId: task.repositoryId,
		sourceBlueprintMessageId: sourceBlueprintMessage?.id ?? null,
		sourceKind: sourceBlueprintMessage ? "blueprint" : "plan_mode_intake",
	});
	const session = await repo.createDesignQuestionnaireSession({
		taskId,
		repositoryId: task.repositoryId,
		sourceBlueprintMessageId: sourceBlueprintMessageId || null,
		status: "draft",
		missionPilotActionKey: options.missionPilotActionKey ?? null,
	});
	if (parsed.ok) {
		await repo.createDesignQuestionnaireQuestionSet({
			sessionId: session.id,
			sequence: 1,
			questionnaireJson: parsed.value,
			rawOutput,
			validationStatus: "valid",
		});
		await repo.updateDesignQuestionnaireSessionStatus(session.id, "answering");
	} else {
		await repo.createDesignQuestionnaireQuestionSet({
			sessionId: session.id,
			sequence: 1,
			rawOutput,
			validationStatus: "invalid",
		});
		await repo.updateDesignQuestionnaireSessionStatus(session.id, "needs_edit");
	}
	const created = await getDesignQuestionnaireSession(taskId, session.id);
	if (created.status === "answering") await publishQuestionnaireReady(created);
	return created;
}

export async function listDesignQuestionnaires(taskId: string) {
	const task = await getPlanModeTask(taskId);
	if (!task) throw new NotFoundError("Task not found");
	const sessions = await repo.listDesignQuestionnaireSessionsForTask(taskId);
	return Promise.all(
		sessions.map((session) => buildDesignQuestionnaireSessionView(session.id)),
	);
}

export async function getDesignQuestionnaireSession(
	taskId: string,
	sessionId: string,
) {
	const session = await buildDesignQuestionnaireSessionView(sessionId);
	if (session.taskId !== taskId)
		throw new NotFoundError("Questionnaire session not found");
	return session;
}

export async function saveDesignQuestionnaireAnswers(
	taskId: string,
	sessionId: string,
	answers: DesignQuestionnaireAnswer[],
	options: {
		completionPolicy?: "assess_follow_up" | "finalize_current_questions";
	} = {},
) {
	const task = await getPlanModeTask(taskId);
	if (!task) throw new NotFoundError("Task not found");
	assertPlanModeCapabilityEnabled("questionnaire");
	assertPlanModeMutable(task);
	const session = await getDesignQuestionnaireSession(taskId, sessionId);
	if (session.status === "review_ready" || session.status === "accepted") {
		return session;
	}
	const questionById = new Map(
		getSessionQuestions(session).map((question) => [
			String(question.id),
			question,
		]),
	);
	const parsedAnswers = answers.map((answer) => {
		const parsed = designQuestionnaireAnswerSchema.parse(answer);
		const question = questionById.get(parsed.questionId);
		if (!question) {
			throw new AppError(
				422,
				"UNKNOWN_QUESTION",
				`Unknown question id: ${parsed.questionId}`,
			);
		}
		validateDesignQuestionnaireAnswerForQuestion(parsed, question);
		return parsed;
	});
	for (const parsed of parsedAnswers) {
		try {
			await repo.upsertDesignQuestionnaireAnswer({
				sessionId,
				questionId: parsed.questionId,
				answerJson: parsed,
			});
		} catch (error) {
			throw questionnairePersistenceError(`answer:${parsed.questionId}`, error);
		}
	}
	const updatedAnswers = await repo
		.listDesignQuestionnaireAnswers(sessionId)
		.catch((error) => {
			throw questionnairePersistenceError("answer-readback", error);
		});
	const updatedAnswerViews = parseQuestionnaireAnswerViews(updatedAnswers);
	const nextStatus = areQuestionnaireAnswersComplete(
		session,
		new Map(
			updatedAnswerViews.map((answer) => [answer.questionId, answer.answer]),
		),
	)
		? "review_ready"
		: "answering";
	if (
		nextStatus === "answering" ||
		options.completionPolicy === "finalize_current_questions"
	) {
		await repo
			.updateDesignQuestionnaireSessionStatus(sessionId, nextStatus)
			.catch((error) => {
				throw questionnairePersistenceError("session-status", error);
			});
	}
	if (nextStatus === "answering") {
		return getDesignQuestionnaireSession(taskId, sessionId);
	}
	const completedSession = await getDesignQuestionnaireSession(
		taskId,
		sessionId,
	);
	if (options.completionPolicy === "finalize_current_questions") {
		return getDesignQuestionnaireSession(taskId, sessionId);
	}
	return assessDesignQuestionnaireNextStep(taskId, completedSession);
}

export async function generateDesignQuestionnaireFollowUp(
	taskId: string,
	sessionId: string,
) {
	const task = await getPlanModeTask(taskId);
	if (!task) throw new NotFoundError("Task not found");
	assertPlanModeCapabilityEnabled("questionnaire");
	assertPlanModeMutable(task);
	const session = await getDesignQuestionnaireSession(taskId, sessionId);
	if (session.questionSets.length >= MAX_DESIGN_QUESTIONNAIRE_PAGES) {
		await repo.updateDesignQuestionnaireSessionStatus(
			sessionId,
			"review_ready",
		);
		return getDesignQuestionnaireSession(taskId, sessionId);
	}
	const rawOutput = await generateDesignQuestionnaireFollowUpRawOutput(session);
	const parsed = parseDesignQuestionnaireRaw(rawOutput, {
		taskId: session.taskId,
		repositoryId: session.repositoryId,
		sourceBlueprintMessageId: session.sourceBlueprintMessageId,
		sourceKind: session.sourceBlueprintMessageId
			? "blueprint"
			: "plan_mode_intake",
	});
	const nextSequence =
		session.questionSets.reduce((max, set) => Math.max(max, set.sequence), 0) +
		1;
	await repo.createDesignQuestionnaireQuestionSet({
		sessionId,
		sequence: nextSequence,
		questionnaireJson: parsed.ok ? parsed.value : undefined,
		rawOutput,
		validationStatus: parsed.ok ? "valid" : "invalid",
	});
	await repo.updateDesignQuestionnaireSessionStatus(
		sessionId,
		parsed.ok ? "answering" : "needs_edit",
	);
	const updated = await getDesignQuestionnaireSession(taskId, sessionId);
	if (updated.status === "answering") await publishQuestionnaireReady(updated);
	return updated;
}

async function assessDesignQuestionnaireNextStep(
	taskId: string,
	session: DesignQuestionnaireSession,
) {
	if (session.questionSets.length >= MAX_DESIGN_QUESTIONNAIRE_PAGES) {
		await repo.updateDesignQuestionnaireSessionStatus(
			session.id,
			"review_ready",
		);
		return getDesignQuestionnaireSession(taskId, session.id);
	}
	const nextSequence =
		session.questionSets.reduce((max, set) => Math.max(max, set.sequence), 0) +
		1;
	const rawOutput =
		await generateDesignQuestionnaireFollowUpDecisionRawOutput(session);
	const parsed = parseDesignQuestionnaireFollowUpDecisionRaw(
		rawOutput,
		{
			taskId: session.taskId,
			repositoryId: session.repositoryId,
			sourceBlueprintMessageId: session.sourceBlueprintMessageId,
			sourceKind: session.sourceBlueprintMessageId
				? "blueprint"
				: "plan_mode_intake",
		},
		nextSequence,
	);
	if (!parsed.ok) {
		await repo.createDesignQuestionnaireQuestionSet({
			sessionId: session.id,
			sequence: nextSequence,
			rawOutput,
			validationStatus: "invalid",
		});
		await repo.updateDesignQuestionnaireSessionStatus(session.id, "needs_edit");
		return getDesignQuestionnaireSession(taskId, session.id);
	}
	if (parsed.value.action === "ready_for_design_assembly") {
		await repo.updateDesignQuestionnaireSessionStatus(
			session.id,
			"review_ready",
		);
		return getDesignQuestionnaireSession(taskId, session.id);
	}
	if (!parsed.value.questionnaire) {
		await repo.createDesignQuestionnaireQuestionSet({
			sessionId: session.id,
			sequence: nextSequence,
			rawOutput,
			validationStatus: "invalid",
		});
		await repo.updateDesignQuestionnaireSessionStatus(session.id, "needs_edit");
		return getDesignQuestionnaireSession(taskId, session.id);
	}
	const dedupedQuestionnaire = removeDuplicateFollowUpQuestions(
		session,
		parsed.value.questionnaire,
	);
	if (!dedupedQuestionnaire) {
		await repo.updateDesignQuestionnaireSessionStatus(
			session.id,
			"review_ready",
		);
		return getDesignQuestionnaireSession(taskId, session.id);
	}
	await repo.createDesignQuestionnaireQuestionSet({
		sessionId: session.id,
		sequence: nextSequence,
		questionnaireJson: dedupedQuestionnaire,
		rawOutput,
		validationStatus: "valid",
	});
	await repo.updateDesignQuestionnaireSessionStatus(session.id, "answering");
	const updated = await getDesignQuestionnaireSession(taskId, session.id);
	await publishQuestionnaireReady(updated);
	return updated;
}

export async function generateDesignQuestionnaireReview(
	taskId: string,
	sessionId: string,
) {
	const task = await getPlanModeTask(taskId);
	if (!task) throw new NotFoundError("Task not found");
	assertPlanModeCapabilityEnabled("questionnaire");
	assertPlanModeMutable(task);
	const session = await getDesignQuestionnaireSession(taskId, sessionId);
	const rawOutput = await generateDesignQuestionnaireReviewRawOutput(session);
	const parsed = parseDesignDecisionReviewRaw(rawOutput);
	const review = await repo.createDesignQuestionnaireReview({
		sessionId,
		reviewJson: parsed.ok ? parsed.value : null,
		status: parsed.ok ? "draft" : "needs_edit",
	});
	await repo.updateDesignQuestionnaireSessionStatus(
		sessionId,
		parsed.ok ? "review_ready" : "needs_edit",
	);
	return {
		session: await getDesignQuestionnaireSession(taskId, sessionId),
		reviewId: review.id,
		rawOutput,
		validationStatus: parsed.ok ? "valid" : "invalid",
	};
}

export async function acceptDesignQuestionnaireReview(
	taskId: string,
	sessionId: string,
) {
	const task = await getPlanModeTask(taskId);
	if (!task) throw new NotFoundError("Task not found");
	assertPlanModeCapabilityEnabled("questionnaire");
	assertPlanModeMutable(task);
	const session = await getDesignQuestionnaireSession(taskId, sessionId);
	const latestDraft = session.reviews.find(
		(review) => review.status === "draft" && review.review,
	);
	if (!latestDraft?.review) {
		throw new AppError(
			422,
			"NO_REVIEW_DRAFT",
			"A draft Decision Review is required.",
		);
	}
	const message = await createPlanModeTaskMessage({
		taskId,
		role: "assistant",
		content: renderDesignDecisionReviewMarkdown(latestDraft.review),
		messageType: "markdown_document",
		payloadJson: {
			intent: "design_decision_review",
			title: latestDraft.review.title,
			designDecisionReview: latestDraft.review,
			source: "design-questionnaire",
			sourceBlueprintMessageId: session.sourceBlueprintMessageId,
			questionnaireSessionId: session.id,
		},
	});
	await repo.updateDesignQuestionnaireReview(latestDraft.id, {
		status: "accepted",
		publishedMessageId: message.id,
	});
	await repo.updateDesignQuestionnaireSessionStatus(sessionId, "accepted");
	return getDesignQuestionnaireSession(taskId, sessionId);
}

export async function leaveDesignQuestionnaireReviewUnadopted(
	taskId: string,
	sessionId: string,
) {
	const task = await getPlanModeTask(taskId);
	if (!task) throw new NotFoundError("Task not found");
	assertPlanModeCapabilityEnabled("questionnaire");
	assertPlanModeMutable(task);
	const session = await getDesignQuestionnaireSession(taskId, sessionId);
	const latestReview = session.reviews[0];
	if (latestReview) {
		await repo.updateDesignQuestionnaireReview(latestReview.id, {
			status: "left_unadopted",
		});
	}
	await repo.updateDesignQuestionnaireSessionStatus(sessionId, "needs_edit");
	return getDesignQuestionnaireSession(taskId, sessionId);
}

async function getQuestionnaireTaskAndBlueprint(
	taskId: string,
	sourceBlueprintMessageId: string,
) {
	const task = await getPlanModeTask(taskId);
	if (!task) throw new NotFoundError("Task not found");
	const sourceBlueprintMessage = await getPlanModeTaskMessage(
		sourceBlueprintMessageId,
	);
	if (!sourceBlueprintMessage || sourceBlueprintMessage.taskId !== taskId) {
		throw new AppError(
			422,
			"SOURCE_BLUEPRINT_NOT_FOUND",
			"Source Blueprint message not found.",
		);
	}
	if (!isBlueprintMessage(sourceBlueprintMessage)) {
		throw new AppError(
			422,
			"SOURCE_BLUEPRINT_REQUIRED",
			"Source message must be a Blueprint.",
		);
	}
	return { task, sourceBlueprintMessage };
}

async function generateDesignQuestionnaireRawOutput(input: {
	taskId: string;
	repositoryId: string;
	sourceBlueprintMessage: PlanModeTaskMessage | null;
	taskPrompt: string;
	projectStackContext?: string | null;
	planModeContext?: string | null;
	routeOverride?: StructuredLlmModelTarget | null;
	role: StructuredLlmRole;
	usageTrace?: TraceProvenance;
}) {
	return generateQuestionnaireRawOutput(
		buildDesignQuestionnaireSystemPrompt(),
		buildDesignQuestionnaireInitialUserPrompt(input),
		{
			name: "design_questionnaire",
			runtimeSchema: questionnaireChoiceFormSchema,
			providerJsonSchema: questionnaireChoiceFormJsonSchema,
			taskId: input.taskId,
			role: input.role,
			usageTrace: input.usageTrace,
			routeOverride: input.routeOverride || null,
		},
	);
}

async function generateDesignQuestionnaireFollowUpRawOutput(
	session: DesignQuestionnaireSession,
) {
	const projectStackContext = await resolvePlanModeProjectStackContext(
		session.repositoryId,
	);
	const planModeContext = buildQuestionnairePlanModeContext(
		await listPlanModeTaskMessages(session.taskId),
	);
	return generateQuestionnaireRawOutput(
		buildDesignQuestionnaireSystemPrompt(),
		buildDesignQuestionnaireFollowUpUserPrompt(
			session,
			projectStackContext,
			planModeContext,
		),
		{
			name: "design_questionnaire_follow_up",
			runtimeSchema: questionnaireChoiceFormSchema,
			providerJsonSchema: questionnaireChoiceFormJsonSchema,
			taskId: session.taskId,
			role: "plan",
		},
	);
}

async function generateDesignQuestionnaireFollowUpDecisionRawOutput(
	session: DesignQuestionnaireSession,
) {
	const projectStackContext = await resolvePlanModeProjectStackContext(
		session.repositoryId,
	);
	const planModeContext = buildQuestionnairePlanModeContext(
		await listPlanModeTaskMessages(session.taskId),
	);
	return generateQuestionnaireRawOutput(
		buildDesignQuestionnaireFollowUpDecisionSystemPrompt(),
		buildDesignQuestionnaireFollowUpDecisionUserPrompt(
			session,
			projectStackContext,
			planModeContext,
		),
		{
			name: "design_questionnaire_follow_up_decision",
			runtimeSchema: designQuestionnaireFollowUpDecisionSchema,
			providerJsonSchema: designQuestionnaireFollowUpDecisionJsonSchema,
			taskId: session.taskId,
			role: "plan",
		},
	);
}

async function generateDesignQuestionnaireReviewRawOutput(
	session: DesignQuestionnaireSession,
) {
	return generateQuestionnaireRawOutput(
		buildDesignQuestionnaireReviewSystemPrompt(),
		buildDesignQuestionnaireReviewUserPrompt(session),
		{
			name: "design_decision_review",
			runtimeSchema: designDecisionReviewSchema,
			providerJsonSchema: designDecisionReviewJsonSchema,
			taskId: session.taskId,
			role: "review",
		},
	);
}

async function generateQuestionnaireRawOutput<T>(
	systemPrompt: string,
	userPrompt: string,
	input: {
		name: string;
		runtimeSchema: import("zod").ZodType<T>;
		providerJsonSchema: unknown;
		taskId: string;
		role: StructuredLlmRole;
		usageTrace?: TraceProvenance;
		routeOverride?: StructuredLlmModelTarget | null;
	},
) {
	const generated = await callStructuredOutputWithRepair({
		systemPrompt,
		userPrompt,
		options: {
			contract: createStructuredOutputContract({
				name: input.name,
				runtimeSchema: input.runtimeSchema,
				providerJsonSchema: input.providerJsonSchema,
			}),
			taskId: input.taskId,
			role: input.role,
			usageTrace: input.usageTrace,
			routeOverride: input.routeOverride,
		},
	});
	return generated.attempts.at(-1)?.rawText ?? JSON.stringify(generated.value);
}
