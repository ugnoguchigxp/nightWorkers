import type { DesignQuestionnaireSession } from "../../../../shared/schemas/design-questionnaire.schema";
import type { QuestionnaireDecisionInventoryItem } from "../../../modules/questionnaire/questionnaire-validation";
import type { PlanModeQuestionnaireRepositoryPolicy } from "../../../modules/specification/plan-mode-project-stack-context";
import {
	bindSystemContextTextCatalog,
	p,
	type SystemContextP,
} from "../../../systemContexts/catalog";

type QuestionnaireSourceInput = {
	sourceBlueprintMessage?: {
		id: string;
		metadataJson?: unknown;
	} | null;
	taskPrompt: string;
	projectStackContext?: string | null;
	planModeContext?: string | null;
};

type SpecificationContext = {
	task: string;
	projectStackContext: string;
	implementationPlanGuidance: string;
	questionnaireDecisions: string;
	blueprintSummary: string;
	dataModelDdl: string;
	planViewReferences: string;
	planModeReferences: string;
	traceability: string;
	userRegenerationRequest?: string | null;
	artifactInputPrompt?: string | null;
};

type AdditionalQuestionnairePromptInput = {
	task: string;
	source: "user_requested" | "artifact_triggered" | "pre_feature_plan_gate";
	reason?: string | null;
	maxQuestions: number;
	projectStackContext?: string | null;
	planModeContext?: string | null;
	decisionInventory: QuestionnaireDecisionInventoryItem[];
};

function questionnaireRepositorySelectionGuidance(
	repositoryPolicy: PlanModeQuestionnaireRepositoryPolicy,
	p: SystemContextP,
) {
	return repositoryPolicy === "repository_fixed"
		? p("questionnaire.repository-fixed-guidance", {})
		: [
				p("questionnaire.starter-selection-applicability", {}),
				p("questionnaire.starter-tech-stack-question", {}),
				p("questionnaire.starter-database-question", {}),
			].join("");
}

export function buildDesignQuestionnaireSystemPrompt(
	repositoryPolicy: PlanModeQuestionnaireRepositoryPolicy = "starter_selection_required",
) {
	const { p } = bindSystemContextTextCatalog();
	return p("questionnaire.design", {
		completionVerificationGuidance: p(
			"questionnaire.completion-verification-guidance",
			{},
		),
		repositorySelectionGuidance: questionnaireRepositorySelectionGuidance(
			repositoryPolicy,
			p,
		),
	});
}

export function buildDesignQuestionnaireInitialUserPrompt(
	input: QuestionnaireSourceInput,
) {
	const metadata = (input.sourceBlueprintMessage?.metadataJson || {}) as {
		appBlueprint?: unknown;
		mockBlueprint?: unknown;
	};
	const source = input.sourceBlueprintMessage
		? {
				sourceKind: "blueprint",
				blueprintMessageId: input.sourceBlueprintMessage.id,
				blueprint: metadata.appBlueprint || metadata.mockBlueprint,
			}
		: {
				sourceKind: "plan_mode_intake",
				prompt: input.taskPrompt,
			};
	return [
		input.sourceBlueprintMessage
			? "次の App Blueprint artifact を入力に、実装前に決めたい質問フォームを生成してください。"
			: "次の Plan mode intake を入力に、実装前に決めたい質問フォームを生成してください。",
		"",
		JSON.stringify(source, null, 2),
		"",
		"## Project Stack Context",
		input.projectStackContext?.trim() || "Project stack は未検出です。",
		"",
		"## Plan Mode Context",
		input.planModeContext?.trim() || "Plan Mode の追加 context は未検出です。",
	].join("\n");
}

export function buildDesignQuestionnaireFollowUpUserPrompt(
	session: DesignQuestionnaireSession,
	projectStackContext?: string | null,
	planModeContext?: string | null,
) {
	return [
		"次の質問票と回答をもとに、追加確認が必要な質問だけを follow-up question set として返してください。",
		"answeredQuestions は既に回答済みの仕様判断です。選択肢が「未定」「後続決定」でも、その質問自体は回答済みとして扱ってください。",
		"answeredQuestions と同じ質問、同じ判断軸、同じ意味の言い換え、同じ選択肢集合の質問は絶対に繰り返さないでください。",
		"追加質問は unansweredQuestions と answeredQuestions のどちらにも存在しない新しい判断軸だけにしてください。",
		"",
		"## Project Stack Context",
		projectStackContext?.trim() || "Project stack は未検出です。",
		"",
		"## Plan Mode Context",
		planModeContext?.trim() || "Plan Mode の追加 context は未検出です。",
		"",
		JSON.stringify(buildSessionPromptPayload(session), null, 2),
	].join("\n");
}

export function buildDesignQuestionnaireFollowUpDecisionSystemPrompt(
	repositoryPolicy: PlanModeQuestionnaireRepositoryPolicy = "starter_selection_required",
) {
	const { p } = bindSystemContextTextCatalog();
	return p("questionnaire.follow-up-decision", {
		repositorySelectionGuidance: questionnaireRepositorySelectionGuidance(
			repositoryPolicy,
			p,
		),
	});
}

export function buildDesignQuestionnaireFollowUpDecisionUserPrompt(
	session: DesignQuestionnaireSession,
	projectStackContext?: string | null,
	planModeContext?: string | null,
) {
	return [
		"次の質問票とユーザー回答を評価し、Design Assembly に進めるか、さらに追質問が必要かを判定してください。",
		"追質問が必要な場合だけ、追加質問フォームを questionnaire に入れてください。",
		"answeredQuestions に含まれる質問と回答は必ず引き継ぎ、同じ質問や同じ判断軸を再生成しないでください。",
		"十分なら action は ready_for_design_assembly、questionnaire は null にしてください。",
		"",
		"## Project Stack Context",
		projectStackContext?.trim() || "Project stack は未検出です。",
		"",
		"## Plan Mode Context",
		planModeContext?.trim() || "Plan Mode の追加 context は未検出です。",
		"",
		JSON.stringify(buildSessionPromptPayload(session), null, 2),
	].join("\n");
}

export function buildAdditionalDesignQuestionnaireSystemPrompt(
	repositoryPolicy: PlanModeQuestionnaireRepositoryPolicy = "starter_selection_required",
) {
	const { p } = bindSystemContextTextCatalog();
	return p("questionnaire.additional", {
		repositorySelectionGuidance: questionnaireRepositorySelectionGuidance(
			repositoryPolicy,
			p,
		),
	});
}

export function buildAdditionalDesignQuestionnaireUserPrompt(
	input: AdditionalQuestionnairePromptInput,
) {
	return [
		"次の Plan Mode context から、今追加でユーザーに確認すべき実装判断だけを返してください。",
		`追加質問の最大件数: ${input.maxQuestions}`,
		`source: ${input.source}`,
		`reason: ${input.reason?.trim() || "明示理由なし"}`,
		"",
		"## Task",
		input.task,
		"",
		"## Project Stack Context",
		input.projectStackContext?.trim() || "Project stack は未検出です。",
		"",
		"## Plan Mode Context",
		input.planModeContext?.trim() || "Plan Mode の追加 context は未検出です。",
		"",
		"## Decision Inventory",
		JSON.stringify(input.decisionInventory, null, 2),
	].join("\n");
}

export function buildDesignQuestionnaireReviewSystemPrompt() {
	return p("questionnaire.review", {});
}

export function buildDesignQuestionnaireReviewUserPrompt(
	session: DesignQuestionnaireSession,
) {
	return JSON.stringify(
		{
			sessionId: session.id,
			sourceBlueprintMessageId: session.sourceBlueprintMessageId,
			questionSets: session.questionSets.map((set) => set.questionnaire),
			answers: session.answers.map((answer) => answer.answer),
		},
		null,
		2,
	);
}

export function buildSpecificationDocumentSystemPrompt(
	input?: { additionalSystemContext?: string | null },
	p: SystemContextP = bindSystemContextTextCatalog().p,
) {
	return input?.additionalSystemContext
		? p("questionnaire.specification-with-additional", {
				additionalSystemContext: input.additionalSystemContext,
			})
		: p("questionnaire.specification", {});
}

export function buildSpecificationDocumentUserPrompt(
	context: SpecificationContext,
) {
	if (context.artifactInputPrompt?.trim())
		return context.artifactInputPrompt.trim();
	return [
		"次の圧縮済み context から Specification を作成してください。",
		"",
		"## Task",
		context.task,
		"",
		"## Target Project Context",
		context.projectStackContext,
		"",
		"## Implementation Plan Guidance",
		context.implementationPlanGuidance,
		context.userRegenerationRequest?.trim()
			? [
					"",
					"## User Regeneration Request",
					context.userRegenerationRequest.trim(),
					"",
					"上記の再生成指示を優先してください。ただし、指摘されていない既存 artifact の確定判断は維持し、Feature Plan 全体を不要に広げないでください。",
				].join("\n")
			: null,
		"",
		"## Questionnaire Decisions",
		context.questionnaireDecisions,
		"",
		"## Blueprint Summary",
		context.blueprintSummary,
		"",
		"## Data Model DDL Reference",
		context.dataModelDdl,
		"",
		"## Plan View References",
		context.planViewReferences,
		"",
		"## Plan Mode References",
		context.planModeReferences,
		"",
		"## Traceability",
		context.traceability,
	]
		.filter((line): line is string => line !== null)
		.join("\n");
}

function buildSessionPromptPayload(session: DesignQuestionnaireSession) {
	const allQuestions = session.questionSets.flatMap((set) =>
		(set.questionnaire?.questionSets || []).flatMap(
			(questionSet) => questionSet.questions,
		),
	);
	const questionById = new Map(
		allQuestions.map((question) => [question.id, question]),
	);
	const answeredQuestionIds = new Set(
		session.answers.map((answer) => answer.questionId),
	);
	return {
		sessionId: session.id,
		taskId: session.taskId,
		repositoryId: session.repositoryId,
		sourceBlueprintMessageId: session.sourceBlueprintMessageId,
		questionSets: session.questionSets.map((set) => set.questionnaire),
		answers: session.answers.map((answer) => answer.answer),
		answeredQuestions: session.answers.map((answer) => {
			const question = questionById.get(answer.questionId);
			const optionById = new Map(
				(question?.options || []).map((option) => [option.id, option]),
			);
			return {
				questionId: answer.questionId,
				question: question?.question ?? null,
				topic: question?.topic ?? null,
				answerType: question?.answerType ?? null,
				selectedOptionLabels: answer.answer.selectedOptionIds.map(
					(optionId) => optionById.get(optionId)?.label ?? optionId,
				),
				rankedOptionLabels: answer.answer.rankedOptionIds.map(
					(optionId) => optionById.get(optionId)?.label ?? optionId,
				),
				booleanValue: answer.answer.booleanValue ?? null,
				freeText: answer.answer.freeText ?? null,
				deferred: answer.answer.deferred,
			};
		}),
		unansweredQuestions: allQuestions
			.filter((question) => !answeredQuestionIds.has(question.id))
			.map((question) => ({
				questionId: question.id,
				question: question.question,
				topic: question.topic,
				answerType: question.answerType,
				optionLabels: (question.options || []).map((option) => option.label),
			})),
	};
}
