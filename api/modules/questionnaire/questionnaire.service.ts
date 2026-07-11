import {
	type DesignQuestionnaireAnswer,
	type DesignQuestionnaireSession,
	designQuestionnaireAnswerSchema,
} from "../../../shared/schemas/design-questionnaire.schema";
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
import { callStructuredJsonLLM } from "../../services/structured-llm";
import type { StructuredLlmModelTarget } from "../../services/structured-llm/settings";
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
import { publishQuestionnaireReady } from "./questionnaire-events";
import {
	buildDesignQuestionnaireSessionView,
	designDecisionReviewJsonSchema,
	designQuestionnaireFollowUpDecisionJsonSchema,
	getAnswerableSessionQuestions,
	getSessionQuestions,
	parseDesignDecisionReviewRaw,
	parseDesignQuestionnaireFollowUpDecisionRaw,
	parseDesignQuestionnaireRaw,
	questionnaireChoiceFormJsonSchema,
	renderDesignDecisionReviewMarkdown,
} from "./questionnaire-parser.service";
import {
	isDesignQuestionnaireAnswerComplete,
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

export async function createDesignQuestionnaire(
	taskId: string,
	sourceBlueprintMessageId?: string | null,
	sourcePrompt?: string,
	options: { routeOverride?: StructuredLlmModelTarget | null } = {},
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
	}).catch(async (error) => {
		const rawContent = (error as Error & { rawContent?: string }).rawContent;
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
	for (const answer of answers) {
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
		await repo.upsertDesignQuestionnaireAnswer({
			sessionId,
			questionId: parsed.questionId,
			answerJson: parsed,
		});
	}
	const updatedAnswers = await repo.listDesignQuestionnaireAnswers(sessionId);
	const updatedAnswerViews = updatedAnswers.map((answer) => ({
		questionId: answer.questionId,
		answer: designQuestionnaireAnswerSchema.parse(answer.answerJson),
	}));
	const requiredQuestions = getAnswerableSessionQuestions(
		session,
		updatedAnswerViews,
	);
	const answerByQuestionId = new Map(
		updatedAnswerViews.map((answer) => [answer.questionId, answer.answer]),
	);
	const nextStatus =
		requiredQuestions.length > 0 &&
		requiredQuestions.every((question) =>
			isDesignQuestionnaireAnswerComplete(
				question,
				answerByQuestionId.get(String(question.id)),
			),
		)
			? "review_ready"
			: "answering";
	if (nextStatus === "answering") {
		await repo.updateDesignQuestionnaireSessionStatus(sessionId, nextStatus);
		return getDesignQuestionnaireSession(taskId, sessionId);
	}
	const completedSession = await getDesignQuestionnaireSession(
		taskId,
		sessionId,
	);
	if (options.completionPolicy === "finalize_current_questions") {
		await repo.updateDesignQuestionnaireSessionStatus(
			sessionId,
			"review_ready",
		);
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
}) {
	return callStructuredJsonLLM(
		buildDesignQuestionnaireSystemPrompt(),
		buildDesignQuestionnaireInitialUserPrompt(input),
		{
			schemaName: "design_questionnaire",
			schema: questionnaireChoiceFormJsonSchema,
			taskId: input.taskId,
			role: "plan",
			routeOverride: input.routeOverride || null,
		},
	);
}

function buildQuestionnairePlanModeContext(messages: PlanModeTaskMessage[]) {
	const artifactLines: string[] = [];
	const authSignals = new Set<string>();
	for (const message of messages) {
		const metadata = isRecord(message.metadataJson) ? message.metadataJson : {};
		const intent = String(metadata.intent || "").trim();
		const view = String(metadata.view || "").trim();
		const artifactKind = String(metadata.artifactKind || "").trim();
		const title = String(metadata.title || "").trim();
		if (intent || view || artifactKind) {
			artifactLines.push(
				`- message=${message.id}; type=${message.messageType || "message"}; intent=${intent || "none"}; view=${view || "none"}; artifactKind=${artifactKind || "none"}; title=${title || compactQuestionnaireContext(message.content, 80)}`,
			);
		}
		for (const signal of detectAuthBoundarySignals([
			message.content,
			JSON.stringify(metadata),
		])) {
			authSignals.add(signal);
		}
	}
	const lines = [
		"Generated artifacts available before Questionnaire:",
		...(artifactLines.length > 0 ? artifactLines.slice(-12) : ["- none"]),
		"",
		"Auth / permission context:",
		authSignals.size > 0
			? `- detected surfaces/signals: ${Array.from(authSignals).sort().join(", ")}`
			: "- no explicit auth/protected/public signal detected",
		"- If public/protected/auth/admin surfaces are mixed or target placement is unclear, ask a concrete route/API/data protection question.",
		"- If context clearly shows public-only or auth-only target, do not ask redundant auth questions.",
	];
	return lines.join("\n");
}

function detectAuthBoundarySignals(values: Array<string | null | undefined>) {
	const joined = values.filter(Boolean).join("\n").toLowerCase();
	const signals: string[] = [];
	if (/\bauth\b|認証|login|ログイン|session|セッション/.test(joined))
		signals.push("auth");
	if (/protected|保護|private|非公開/.test(joined)) signals.push("protected");
	if (/public|公開|guest|anonymous|匿名/.test(joined)) signals.push("public");
	if (/admin|管理者|permission|権限|role|ロール/.test(joined))
		signals.push("permission");
	return signals;
}

function compactQuestionnaireContext(
	value: string | null | undefined,
	limit: number,
) {
	const text = String(value || "")
		.replace(/\s+/g, " ")
		.trim();
	if (text.length <= limit) return text;
	return `${text.slice(0, Math.max(0, limit - 1)).trim()}…`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
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
	return callStructuredJsonLLM(
		buildDesignQuestionnaireSystemPrompt(),
		buildDesignQuestionnaireFollowUpUserPrompt(
			session,
			projectStackContext,
			planModeContext,
		),
		{
			schemaName: "design_questionnaire_follow_up",
			schema: questionnaireChoiceFormJsonSchema,
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
	return callStructuredJsonLLM(
		buildDesignQuestionnaireFollowUpDecisionSystemPrompt(),
		buildDesignQuestionnaireFollowUpDecisionUserPrompt(
			session,
			projectStackContext,
			planModeContext,
		),
		{
			schemaName: "design_questionnaire_follow_up_decision",
			schema: designQuestionnaireFollowUpDecisionJsonSchema,
			taskId: session.taskId,
			role: "plan",
		},
	);
}

async function generateDesignQuestionnaireReviewRawOutput(
	session: DesignQuestionnaireSession,
) {
	return callStructuredJsonLLM(
		buildDesignQuestionnaireReviewSystemPrompt(),
		buildDesignQuestionnaireReviewUserPrompt(session),
		{
			schemaName: "design_decision_review",
			schema: designDecisionReviewJsonSchema,
			taskId: session.taskId,
			role: "review",
		},
	);
}
