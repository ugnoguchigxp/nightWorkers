import {
	type AdditionalQuestionnaireDraft,
	additionalQuestionnaireDraftSchema,
	type DesignDecisionReview,
	type DesignQuestionnaire,
	type DesignQuestionnaireAnswer,
	type DesignQuestionnaireFollowUpDecision,
	type DesignQuestionnaireSession,
	designDecisionReviewSchema,
	designQuestionnaireAnswerSchema,
	designQuestionnaireFollowUpDecisionSchema,
	designQuestionnaireSchema,
	designQuestionnaireSessionStatusSchema,
	type QuestionnaireChoiceForm,
	questionnaireChoiceFormSchema,
} from "../../../shared/schemas/design-questionnaire.schema";
import { NotFoundError } from "../../lib/errors";
import { parseRepairedJsonWithSchema } from "../../services/structured-llm/json";
import * as repo from "./questionnaire.repository";

export {
	additionalQuestionnaireDraftJsonSchema,
	designDecisionReviewJsonSchema,
	designQuestionnaireFollowUpDecisionJsonSchema,
	questionnaireChoiceFormJsonSchema,
} from "./questionnaire-json-schemas";

export type DesignQuestionnaireSourceFallback = {
	taskId: string;
	repositoryId: string;
	sourceBlueprintMessageId?: string | null;
	sourceKind: "blueprint" | "plan_mode_intake";
};

type DesignQuestion =
	DesignQuestionnaire["questionSets"][number]["questions"][number];
type DesignQuestionDependency = NonNullable<
	DesignQuestion["dependsOn"]
>[number];
type QuestionnaireQuestionSetView = {
	questionnaire: DesignQuestionnaire | null;
};

export function parseDesignQuestionnaireRaw(
	rawOutput: string,
	fallbackSource?: DesignQuestionnaireSourceFallback,
	choiceFormOptions?: {
		questionSetId?: string;
		questionIdPrefix?: string;
		category?: string;
		purpose?: string;
		summary?: string;
	},
): { ok: true; value: DesignQuestionnaire } | { ok: false; error: unknown } {
	const choiceForm = parseRepairedJsonWithSchema(
		rawOutput,
		questionnaireChoiceFormSchema,
	);
	if (choiceForm.ok) {
		return {
			ok: true,
			value: adaptQuestionnaireChoiceForm(
				choiceForm.value,
				fallbackSource,
				choiceFormOptions,
			),
		};
	}

	const v1 = parseRepairedJsonWithSchema(rawOutput, designQuestionnaireSchema);
	if (v1.ok) return { ok: true, value: v1.value };
	return { ok: false, error: v1.error ?? choiceForm.error };
}

function adaptQuestionnaireChoiceForm(
	form: QuestionnaireChoiceForm,
	fallbackSource?: DesignQuestionnaireSourceFallback,
	options?: {
		questionSetId?: string;
		questionIdPrefix?: string;
		category?: string;
		purpose?: string;
		summary?: string;
	},
): DesignQuestionnaire {
	if (!fallbackSource?.taskId || !fallbackSource.repositoryId) {
		throw new Error(
			"Questionnaire choice form requires server-side source fallback.",
		);
	}
	const questionSetId = options?.questionSetId || "choice-form";
	const questionIdPrefix = options?.questionIdPrefix || "q";
	const category = options?.category || "実装前確認";
	return {
		version: 1,
		source: {
			taskId: fallbackSource.taskId,
			repositoryId: fallbackSource.repositoryId,
			sourceKind: fallbackSource.sourceKind,
			blueprintMessageId: fallbackSource.sourceBlueprintMessageId || null,
		},
		title: form.title,
		summary: options?.summary || "実装前に決めたい項目を選択式で確認します。",
		questionSets: [
			{
				id: questionSetId,
				title: form.title,
				category,
				purpose:
					options?.purpose ||
					"実装に入る前に、未決定の仕様判断を選択式で確定します。",
				questions: form.questions.map((question, questionIndex) => {
					const questionId =
						questionIdPrefix === "q"
							? `q${questionIndex + 1}`
							: `${questionIdPrefix}-q${questionIndex + 1}`;
					return {
						id: questionId,
						topic: `Question ${questionIndex + 1}`,
						question: question.text,
						why: "実装前に仕様判断が必要です。",
						answerType:
							question.type === "checkbox" ? "multi_choice" : "single_choice",
						options: question.options.map((label, optionIndex) => ({
							id: `${questionId}-o${optionIndex + 1}`,
							label,
							tradeoff: "選択後に設計判断として整理します。",
						})),
						blocks: ["実装前の仕様判断"],
						outputSection: `question-${questionIndex + 1}`,
					};
				}),
			},
		],
		openQuestions: [],
		dataModelHandoffNotes: [],
	};
}

export function toKebabId(value: string, fallback: string) {
	const normalized = value
		.normalize("NFKD")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return normalized || fallback;
}

export function toQuestionnaireDecisionKey(value: string, fallback: string) {
	const normalized = value
		.normalize("NFKD")
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, ".")
		.replace(/[._-]{2,}/g, ".")
		.replace(/^[._-]+|[._-]+$/g, "");
	return normalized || fallback;
}

export function parseDesignDecisionReviewRaw(
	rawOutput: string,
): { ok: true; value: DesignDecisionReview } | { ok: false; error: unknown } {
	try {
		return {
			ok: true,
			value: designDecisionReviewSchema.parse(JSON.parse(rawOutput)),
		};
	} catch (error) {
		return { ok: false, error };
	}
}

export function parseDesignQuestionnaireFollowUpDecisionRaw(
	rawOutput: string,
	fallbackSource: DesignQuestionnaireSourceFallback,
	nextSequence: number,
):
	| {
			ok: true;
			value: {
				action: DesignQuestionnaireFollowUpDecision["action"];
				rationale: string;
				questionnaire: DesignQuestionnaire | null;
			};
	  }
	| { ok: false; error: unknown } {
	const decision = parseRepairedJsonWithSchema(
		rawOutput,
		designQuestionnaireFollowUpDecisionSchema,
	);
	if (!decision.ok) return { ok: false, error: decision.error };
	return {
		ok: true,
		value: {
			...decision.value,
			questionnaire: decision.value.questionnaire
				? adaptQuestionnaireChoiceForm(
						decision.value.questionnaire,
						fallbackSource,
						{
							questionSetId: `follow-up-${nextSequence}`,
							questionIdPrefix: `follow-up-${nextSequence}`,
							category: "追質問",
							purpose: "回答内容から残った仕様の曖昧さを追加確認します。",
							summary: "回答後に残った未決定事項を選択式で追加確認します。",
						},
					)
				: null,
		},
	};
}

export function parseAdditionalQuestionnaireDraftRaw(
	rawOutput: string,
):
	| { ok: true; value: AdditionalQuestionnaireDraft }
	| { ok: false; error: unknown } {
	const parsed = parseRepairedJsonWithSchema(
		rawOutput,
		additionalQuestionnaireDraftSchema,
	);
	if (parsed.ok) return { ok: true, value: parsed.value };
	return { ok: false, error: parsed.error };
}

export async function buildDesignQuestionnaireSessionView(
	sessionId: string,
): Promise<DesignQuestionnaireSession> {
	const session = await repo.getDesignQuestionnaireSession(sessionId);
	if (!session) throw new NotFoundError("Questionnaire session not found");
	const [questionSets, answers, reviews] = await Promise.all([
		repo.listDesignQuestionnaireQuestionSets(sessionId),
		repo.listDesignQuestionnaireAnswers(sessionId),
		repo.listDesignQuestionnaireReviews(sessionId),
	]);
	return {
		id: session.id,
		taskId: session.taskId,
		repositoryId: session.repositoryId,
		sourceBlueprintMessageId: session.sourceBlueprintMessageId,
		status: designQuestionnaireSessionStatusSchema.parse(session.status),
		createdAt: session.createdAt,
		updatedAt: session.updatedAt,
		questionSets: questionSets.map((set) => ({
			id: set.id,
			sequence: set.sequence,
			questionnaire: set.questionnaireJson
				? designQuestionnaireSchema.safeParse(set.questionnaireJson).success
					? designQuestionnaireSchema.parse(set.questionnaireJson)
					: null
				: null,
			rawOutput: set.rawOutput,
			validationStatus: set.validationStatus as "valid" | "invalid",
			createdAt: set.createdAt,
		})),
		answers: answers.map((answer) => ({
			id: answer.id,
			questionId: answer.questionId,
			answer: designQuestionnaireAnswerSchema.parse(answer.answerJson),
			answeredAt: answer.answeredAt,
		})),
		reviews: reviews.map((review) => ({
			id: review.id,
			review: review.reviewJson
				? designDecisionReviewSchema.safeParse(review.reviewJson).success
					? designDecisionReviewSchema.parse(review.reviewJson)
					: null
				: null,
			publishedMessageId: review.publishedMessageId,
			status: review.status as
				| "draft"
				| "accepted"
				| "needs_edit"
				| "left_unadopted",
			createdAt: review.createdAt,
			updatedAt: review.updatedAt,
		})),
	};
}

export function getSessionQuestions(session: {
	questionSets: QuestionnaireQuestionSetView[];
}): DesignQuestion[] {
	return session.questionSets.flatMap((set) =>
		(set.questionnaire?.questionSets || []).flatMap(
			(questionSet) => questionSet.questions,
		),
	);
}

export function getAnswerableSessionQuestions(
	session: { questionSets: QuestionnaireQuestionSetView[] },
	answers: Array<{ questionId: string; answer: DesignQuestionnaireAnswer }>,
) {
	const answerByQuestionId = new Map(
		answers.map((answer) => [answer.questionId, answer.answer]),
	);
	return getSessionQuestions(session).filter((question) =>
		isDesignQuestionDependencySatisfied(question, answerByQuestionId),
	);
}

function isDesignQuestionDependencySatisfied(
	question: DesignQuestion,
	answerByQuestionId: Map<string, DesignQuestionnaireAnswer>,
) {
	const dependencies = Array.isArray(question.dependsOn)
		? question.dependsOn
		: [];
	return dependencies.every((dependency) => {
		const answer = answerByQuestionId.get(String(dependency.questionId));
		if (!answer) return false;
		return evaluateDesignQuestionDependency(answer, dependency);
	});
}

function evaluateDesignQuestionDependency(
	answer: DesignQuestionnaireAnswer,
	dependency: DesignQuestionDependency,
) {
	const expected = dependency.value;
	const values = [
		...answer.selectedOptionIds,
		...answer.rankedOptionIds,
		...(answer.freeText?.trim() ? [answer.freeText.trim()] : []),
	];
	const hasExpectedString = Array.isArray(expected)
		? expected.some((value) => values.includes(String(value)))
		: values.includes(String(expected));
	if (typeof expected === "boolean") {
		if (dependency.operator === "equals")
			return answer.booleanValue === expected;
		if (dependency.operator === "not_equals")
			return answer.booleanValue !== expected;
		return false;
	}
	if (dependency.operator === "equals" || dependency.operator === "includes") {
		return hasExpectedString;
	}
	if (
		dependency.operator === "not_equals" ||
		dependency.operator === "excludes"
	) {
		return !hasExpectedString;
	}
	return false;
}

export function renderDesignDecisionReviewMarkdown(
	review: DesignDecisionReview,
) {
	const lines = [`# ${review.title}`, "", review.summary, ""];
	lines.push("## Decisions");
	if (review.decisions.length === 0) lines.push("- No decisions yet.");
	for (const decision of review.decisions) {
		lines.push(`- **${decision.outputSection}**: ${decision.decision}`);
		lines.push(`  - Rationale: ${decision.rationale}`);
		if (decision.tradeoffs.length > 0)
			lines.push(`  - Tradeoffs: ${decision.tradeoffs.join("; ")}`);
		lines.push(
			`  - Source questions: ${decision.sourceQuestionIds.join(", ")}`,
		);
	}
	lines.push("", "## Deferred");
	if (review.deferredItems.length === 0) lines.push("- None.");
	for (const item of review.deferredItems) {
		lines.push(`- ${item.topic}: ${item.reason}`);
	}
	lines.push("", "## Unresolved");
	if (review.unresolvedQuestions.length === 0) lines.push("- None.");
	for (const item of review.unresolvedQuestions) {
		lines.push(`- ${item.topic}: ${item.reason}`);
	}
	lines.push("", "## Data Model Handoff");
	if (review.dataModelHandoffNotes.length === 0) lines.push("- None.");
	for (const note of review.dataModelHandoffNotes) {
		lines.push(`- ${note.summary}: ${note.constraint}`);
	}
	return lines.join("\n");
}
