import {
	type DesignQuestionnaireAnswer,
	type DesignQuestionnaireSession,
	designQuestionnaireAnswerSchema,
} from "../../../shared/schemas/design-questionnaire.schema";
import type { TraceProvenance } from "../../../shared/schemas/trace-provenance.schema";
import { AppError, NotFoundError } from "../../lib/errors";
import type {
	StructuredLlmModelTarget,
	StructuredLlmRole,
} from "../../services/structured-llm/settings";
import type { StructuredProviderExecutionPolicy } from "../agentsShare";
import {
	createPlanModeTaskMessage,
	getPlanModeTask,
	getPlanModeTaskMessage,
	listPlanModeTaskMessages,
} from "../nightworkers/nightworkers.plan-mode-core.port";
import { assertPlanModeCapabilityEnabled } from "../nightworkers/nightworkers.plan-mode-settings.service";
import { isBlueprintMessage } from "../nightworkers/nightworkers.planning-helpers.service";
import { resolvePlanModeProjectStackContext } from "../specification/plan-mode-project-stack-context";
import * as repo from "./questionnaire.repository";
import { buildQuestionnairePlanModeContext } from "./questionnaire-context";
import { publishQuestionnaireTransition } from "./questionnaire-events";
import {
	generateDesignQuestionnaireFollowUpDecisionRawOutput,
	generateDesignQuestionnaireFollowUpRawOutput,
	generateDesignQuestionnaireRawOutput,
	generateDesignQuestionnaireReviewRawOutput,
} from "./questionnaire-generation.service";
import {
	getSessionQuestions,
	parseDesignDecisionReviewRaw,
	parseDesignQuestionnaireFollowUpDecisionRaw,
	parseDesignQuestionnaireRaw,
	renderDesignDecisionReviewMarkdown,
} from "./questionnaire-parser.service";
import { getDesignQuestionnaireSession } from "./questionnaire-query.service";
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
		executionPolicy?: StructuredProviderExecutionPolicy;
		usageTrace?: TraceProvenance;
		missionPilotActionKey?: string | null;
		signal?: AbortSignal;
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
		executionPolicy: options.executionPolicy,
		usageTrace: options.usageTrace,
		signal: options.signal,
	}).catch(async (error) => {
		const rawContent =
			(error as Error & { rawContent?: string; rawText?: string }).rawText ??
			(error as Error & { rawContent?: string }).rawContent;
		if (rawContent?.trim()) return rawContent;
		throw error;
	});
	options.signal?.throwIfAborted();
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
		return updateQuestionnaireStatus(taskId, session.id, "answering");
	} else {
		await repo.createDesignQuestionnaireQuestionSet({
			sessionId: session.id,
			sequence: 1,
			rawOutput,
			validationStatus: "invalid",
		});
		return updateQuestionnaireStatus(taskId, session.id, "needs_edit");
	}
}

export {
	getDesignQuestionnaireSession,
	listDesignQuestionnaires,
} from "./questionnaire-query.service";

export async function saveDesignQuestionnaireAnswers(
	taskId: string,
	sessionId: string,
	answers: DesignQuestionnaireAnswer[],
	options: {
		completionPolicy?: "assess_follow_up" | "finalize_current_questions";
		role?: StructuredLlmRole;
		executionPolicy?: StructuredProviderExecutionPolicy;
		usageTrace?: TraceProvenance;
	} = {},
) {
	const completionPolicy =
		options.completionPolicy ?? "finalize_current_questions";
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
	let persistedStatusSession: DesignQuestionnaireSession | null = null;
	if (
		nextStatus === "answering" ||
		completionPolicy === "finalize_current_questions"
	) {
		persistedStatusSession = await updateQuestionnaireStatus(
			taskId,
			sessionId,
			nextStatus,
		).catch((error) => {
			throw questionnairePersistenceError("session-status", error);
		});
	}
	if (nextStatus === "answering") {
		if (!persistedStatusSession)
			throw questionnairePersistenceError(
				"session-status",
				"updated Questionnaire session is missing",
			);
		return persistedStatusSession;
	}
	const completedSession = await getDesignQuestionnaireSession(
		taskId,
		sessionId,
	);
	if (completionPolicy === "finalize_current_questions") {
		if (!persistedStatusSession)
			throw questionnairePersistenceError(
				"session-status",
				"updated Questionnaire session is missing",
			);
		return persistedStatusSession;
	}
	return assessDesignQuestionnaireNextStep(taskId, completedSession, options);
}

export async function generateDesignQuestionnaireFollowUp(
	taskId: string,
	sessionId: string,
	options: {
		signal?: AbortSignal;
		usageTrace?: TraceProvenance;
		role?: StructuredLlmRole;
		executionPolicy?: StructuredProviderExecutionPolicy;
	} = {},
) {
	const task = await getPlanModeTask(taskId);
	if (!task) throw new NotFoundError("Task not found");
	assertPlanModeCapabilityEnabled("questionnaire");
	assertPlanModeMutable(task);
	const session = await getDesignQuestionnaireSession(taskId, sessionId);
	if (session.questionSets.length >= MAX_DESIGN_QUESTIONNAIRE_PAGES) {
		return updateQuestionnaireStatus(taskId, sessionId, "review_ready");
	}
	const rawOutput = await generateDesignQuestionnaireFollowUpRawOutput(
		session,
		{
			signal: options.signal,
			usageTrace: options.usageTrace,
			role: options.role,
			executionPolicy: options.executionPolicy,
		},
	);
	options.signal?.throwIfAborted();
	const nextSequence =
		session.questionSets.reduce((max, set) => Math.max(max, set.sequence), 0) +
		1;
	const parsed = parseDesignQuestionnaireRaw(
		rawOutput,
		{
			taskId: session.taskId,
			repositoryId: session.repositoryId,
			sourceBlueprintMessageId: session.sourceBlueprintMessageId,
			sourceKind: session.sourceBlueprintMessageId
				? "blueprint"
				: "plan_mode_intake",
		},
		{
			questionSetId: `follow-up-${nextSequence}`,
			questionIdPrefix: `follow-up-${nextSequence}`,
			category: "追加確認",
			purpose: "明示的に要求された追加の仕様判断を確認します。",
			summary: "明示的に要求された追加質問です。",
		},
	);
	await repo.createDesignQuestionnaireQuestionSet({
		sessionId,
		sequence: nextSequence,
		questionnaireJson: parsed.ok ? parsed.value : undefined,
		rawOutput,
		validationStatus: parsed.ok ? "valid" : "invalid",
	});
	return updateQuestionnaireStatus(
		taskId,
		sessionId,
		parsed.ok ? "answering" : "needs_edit",
	);
}

async function assessDesignQuestionnaireNextStep(
	taskId: string,
	session: DesignQuestionnaireSession,
	options: {
		role?: StructuredLlmRole;
		executionPolicy?: StructuredProviderExecutionPolicy;
		usageTrace?: TraceProvenance;
	} = {},
) {
	if (session.questionSets.length >= MAX_DESIGN_QUESTIONNAIRE_PAGES) {
		return updateQuestionnaireStatus(taskId, session.id, "review_ready");
	}
	const nextSequence =
		session.questionSets.reduce((max, set) => Math.max(max, set.sequence), 0) +
		1;
	const rawOutput = await generateDesignQuestionnaireFollowUpDecisionRawOutput(
		session,
		options,
	);
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
		return updateQuestionnaireStatus(taskId, session.id, "needs_edit");
	}
	if (parsed.value.action === "ready_for_design_assembly") {
		return updateQuestionnaireStatus(taskId, session.id, "review_ready");
	}
	if (!parsed.value.questionnaire) {
		await repo.createDesignQuestionnaireQuestionSet({
			sessionId: session.id,
			sequence: nextSequence,
			rawOutput,
			validationStatus: "invalid",
		});
		return updateQuestionnaireStatus(taskId, session.id, "needs_edit");
	}
	const dedupedQuestionnaire = removeDuplicateFollowUpQuestions(
		session,
		parsed.value.questionnaire,
	);
	if (!dedupedQuestionnaire) {
		return updateQuestionnaireStatus(taskId, session.id, "review_ready");
	}
	await repo.createDesignQuestionnaireQuestionSet({
		sessionId: session.id,
		sequence: nextSequence,
		questionnaireJson: dedupedQuestionnaire,
		rawOutput,
		validationStatus: "valid",
	});
	return updateQuestionnaireStatus(taskId, session.id, "answering");
}

export async function generateDesignQuestionnaireReview(
	taskId: string,
	sessionId: string,
	options: {
		signal?: AbortSignal;
		usageTrace?: TraceProvenance;
		role?: StructuredLlmRole;
		executionPolicy?: StructuredProviderExecutionPolicy;
	} = {},
) {
	const task = await getPlanModeTask(taskId);
	if (!task) throw new NotFoundError("Task not found");
	assertPlanModeCapabilityEnabled("questionnaire");
	assertPlanModeMutable(task);
	const session = await getDesignQuestionnaireSession(taskId, sessionId);
	const rawOutput = await generateDesignQuestionnaireReviewRawOutput(session, {
		signal: options.signal,
		usageTrace: options.usageTrace,
		role: options.role,
		executionPolicy: options.executionPolicy,
	});
	options.signal?.throwIfAborted();
	const parsed = parseDesignDecisionReviewRaw(rawOutput);
	const review = await repo.createDesignQuestionnaireReview({
		sessionId,
		reviewJson: parsed.ok ? parsed.value : null,
		status: parsed.ok ? "draft" : "needs_edit",
	});
	const updatedSession = await updateQuestionnaireStatus(
		taskId,
		sessionId,
		parsed.ok ? "review_ready" : "needs_edit",
	);
	return {
		session: updatedSession,
		reviewId: review.id,
		rawOutput,
		validationStatus: parsed.ok ? "valid" : "invalid",
	};
}

export async function acceptDesignQuestionnaireReview(
	taskId: string,
	sessionId: string,
	options: {
		missionPilotAction?: {
			idempotencyKey: string;
			toolCallId: string;
		};
	} = {},
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
			...(options.missionPilotAction
				? { missionPilotAction: options.missionPilotAction }
				: {}),
		},
	});
	await repo.updateDesignQuestionnaireReview(latestDraft.id, {
		status: "accepted",
		publishedMessageId: message.id,
	});
	return updateQuestionnaireStatus(taskId, sessionId, "accepted");
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
	return updateQuestionnaireStatus(taskId, sessionId, "needs_edit");
}

async function updateQuestionnaireStatus(
	taskId: string,
	sessionId: string,
	status: DesignQuestionnaireSession["status"],
) {
	await repo.updateDesignQuestionnaireSessionStatus(sessionId, status);
	const updated = await getDesignQuestionnaireSession(taskId, sessionId);
	await publishQuestionnaireTransition(updated);
	return updated;
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
