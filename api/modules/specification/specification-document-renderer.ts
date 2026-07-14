import type {
	DesignQuestionnaire,
	DesignQuestionnaireAnswer,
} from "../../../shared/schemas/design-questionnaire.schema";
import type { PlanModeWorkspace } from "../../../shared/schemas/plan-mode-artifact.schema";
import {
	buildImplementationPlanGuidance,
	renderCompressedBlueprintNaturalLanguage,
} from "./specification-blueprint-renderer";
import {
	extractOmittedViewDecisions,
	formatDesignContextKind,
	isFlowViewKind,
	renderAssembledDataModelContract,
	renderDataModelDdlReference,
	renderMessageReferenceSummary,
	renderPlanModeReferences,
	renderPlanViewReferences,
	workspaceArtifacts,
} from "./specification-plan-reference-renderer";
import {
	compactText,
	digestText,
	findLatestBlueprintMessage,
	findLatestDataModelMessage,
	findLatestPlanViewMessage,
	getMessageApiContract,
	getMessageBlueprint,
	getMessageDataModelArtifact,
	getMessageZodSchema,
	renderApiContractReference,
	renderQuestionnaireAnswerMarkdown,
	renderZodSchemaReference,
	uniqueStrings,
} from "./specification-schema-reference-renderer";
import { FEATURE_PLAN_TRACEABILITY_STATEMENT } from "./specification-traceability";

export { renderQuestionnaireAnswerMarkdown } from "./specification-schema-reference-renderer";
export { FEATURE_PLAN_TRACEABILITY_STATEMENT } from "./specification-traceability";

type TaskMessageRow = {
	id: string;
	content?: string | null;
	messageType?: string | null;
	metadataJson?: unknown | null;
};
type TaskLike = {
	title?: string | null;
	description?: string | null;
	objective?: string | null;
};

type QuestionnaireAnswerRow = {
	questionId: string;
	answer: DesignQuestionnaireAnswer;
};
type QuestionnaireSessionLike = {
	id: string;
	questionSets: Array<{ questionnaire: DesignQuestionnaire | null }>;
	answers: QuestionnaireAnswerRow[];
};
export type AssembledDesignContextSectionKind =
	| "questionnaire"
	| "blueprint"
	| "data_model"
	| "api_io_contract"
	| "zod_schema_design"
	| "user_flow"
	| "activity_flow"
	| "sequence_flow"
	| "decision_review";

export type AssembledDesignContextSection = {
	kind: AssembledDesignContextSectionKind;
	title: string;
	sourceMessageId?: string | null;
	digest?: string | null;
	content: string;
};

export type AssembledDesignContext = {
	taskId: string;
	generatedAt: string;
	questionnaireSessionId?: string | null;
	summary: string;
	sections: AssembledDesignContextSection[];
	sourceMessageIds: string[];
	omittedViews: Array<{ view: string; reason?: string }>;
	warnings: string[];
};

export function buildSpecificationDocumentContext(input: {
	task: TaskLike;
	session: QuestionnaireSessionLike | null;
	workspace: PlanModeWorkspace;
	messages: TaskMessageRow[];
	projectStackContext?: string | null;
	preferredBlueprintMessageId?: string | null;
}) {
	const latestBlueprint = findLatestBlueprintMessage(input.messages, {
		kind: "blueprint",
		preferredMessageId: input.preferredBlueprintMessageId,
	});
	const latestDataModel = findLatestDataModelMessage(input.messages);
	const latestApiContract = findLatestPlanViewMessage(
		input.messages,
		"api_io_contract",
	);
	const latestZodSchema = findLatestPlanViewMessage(
		input.messages,
		"zod_schema_design",
	);
	const blueprint = getMessageBlueprint(latestBlueprint);
	const dataModelArtifact = getMessageDataModelArtifact(latestDataModel);
	const blueprintSummary = renderCompressedBlueprintNaturalLanguage(blueprint);
	const dataModelDdl = renderDataModelDdlReference(dataModelArtifact);
	const planViewReferences = renderPlanViewReferences({
		apiContract: getMessageApiContract(latestApiContract),
		zodSchema: getMessageZodSchema(latestZodSchema),
	});
	const planModeReferences = renderPlanModeReferences(
		input.workspace,
		input.messages,
	);
	const projectStackContext =
		input.projectStackContext?.trim() || "Project stack は未検出です。";
	const taskContext = [
		input.task.title,
		input.task.description,
		input.task.objective,
		projectStackContext,
		blueprintSummary,
		dataModelDdl,
		planViewReferences,
		planModeReferences,
	]
		.filter(Boolean)
		.join("\n");
	return {
		task: [
			`Title: ${input.task.title || "Untitled"}`,
			input.task.description ? `Description: ${input.task.description}` : null,
			input.task.objective ? `Objective: ${input.task.objective}` : null,
		]
			.filter(Boolean)
			.join("\n"),
		projectStackContext,
		implementationPlanGuidance: buildImplementationPlanGuidance(taskContext),
		questionnaireDecisions: input.session
			? renderQuestionnaireAnswerMarkdown(input.session)
			: "- Questionnaire は未生成です。",
		blueprintSummary,
		dataModelDdl,
		planViewReferences,
		planModeReferences,
		userRegenerationRequest: null as string | null,
		artifactInputPrompt: null as string | null,
		traceability: FEATURE_PLAN_TRACEABILITY_STATEMENT,
	};
}

export function buildAssembledDesignContext(input: {
	taskId: string;
	task: TaskLike;
	session: QuestionnaireSessionLike | null;
	workspace: PlanModeWorkspace;
	messages: TaskMessageRow[];
	projectStackContext?: string | null;
}): AssembledDesignContext {
	const latestBlueprint = findLatestBlueprintMessage(input.messages, {
		kind: "blueprint",
	});
	const latestDataModel = findLatestDataModelMessage(input.messages);
	const latestApiContract = findLatestPlanViewMessage(
		input.messages,
		"api_io_contract",
	);
	const latestZodSchema = findLatestPlanViewMessage(
		input.messages,
		"zod_schema_design",
	);
	const sections: AssembledDesignContextSection[] = [];
	const warnings: string[] = [];

	if (input.session) {
		const content = renderQuestionnaireAnswerMarkdown(input.session);
		sections.push({
			kind: "questionnaire",
			title: "Questionnaire Decisions",
			sourceMessageId: null,
			digest: digestText(content),
			content,
		});
	} else {
		warnings.push("Questionnaire は未生成です。");
	}

	const blueprint = getMessageBlueprint(latestBlueprint);
	if (blueprint) {
		const content = renderCompressedBlueprintNaturalLanguage(blueprint);
		sections.push({
			kind: "blueprint",
			title: String(blueprint.name || "Blueprint"),
			sourceMessageId: latestBlueprint?.id ?? null,
			digest: digestText(content),
			content,
		});
	} else {
		warnings.push("Blueprint は未生成です。");
	}

	const dataModelArtifact = getMessageDataModelArtifact(latestDataModel);
	if (dataModelArtifact) {
		const content = renderAssembledDataModelContract(dataModelArtifact);
		sections.push({
			kind: "data_model",
			title: String(dataModelArtifact.title || "Data Model"),
			sourceMessageId: latestDataModel?.id ?? null,
			digest: digestText(content),
			content,
		});
	} else {
		warnings.push("Data Model は未生成です。");
	}

	const apiContract = getMessageApiContract(latestApiContract);
	if (apiContract) {
		const content = renderApiContractReference(apiContract);
		sections.push({
			kind: "api_io_contract",
			title: String(apiContract.title || "API Contract"),
			sourceMessageId: latestApiContract?.id ?? null,
			digest: digestText(content),
			content,
		});
	}

	const zodSchema = getMessageZodSchema(latestZodSchema);
	if (zodSchema) {
		const content = renderZodSchemaReference(zodSchema);
		sections.push({
			kind: "zod_schema_design",
			title: String(zodSchema.schemaName || zodSchema.title || "Zod Schema"),
			sourceMessageId: latestZodSchema?.id ?? null,
			digest: digestText(content),
			content,
		});
	}

	for (const artifact of workspaceArtifacts(
		input.workspace,
		"dedicatedViewArtifacts",
	)) {
		if (!isFlowViewKind(artifact.kind)) continue;
		const message = input.messages.find(
			(item) => item.id === artifact.sourceMessageId,
		);
		const content = compactText(
			renderMessageReferenceSummary(message, "dedicated_view"),
			1600,
		);
		if (!content) continue;
		sections.push({
			kind: artifact.kind,
			title: artifact.title || formatDesignContextKind(artifact.kind),
			sourceMessageId: artifact.sourceMessageId,
			digest: digestText(content),
			content,
		});
	}

	for (const artifact of workspaceArtifacts(
		input.workspace,
		"decisionReviews",
	)) {
		const message = input.messages.find(
			(item) => item.id === artifact.sourceMessageId,
		);
		const content = compactText(
			renderMessageReferenceSummary(message, "decision_review"),
			1400,
		);
		if (!content) continue;
		sections.push({
			kind: "decision_review",
			title: artifact.title || "Decision Review",
			sourceMessageId: artifact.sourceMessageId,
			digest: digestText(content),
			content,
		});
	}

	const omittedViews = extractOmittedViewDecisions(input.messages);
	const sourceMessageIds = uniqueStrings(
		sections
			.map((section) => section.sourceMessageId)
			.filter((id): id is string => Boolean(id)),
	);
	const projectStackContext = input.projectStackContext?.trim();
	const summary = [
		`Task: ${input.task.title || "Untitled"}`,
		input.task.objective
			? `Objective: ${compactText(input.task.objective, 180)}`
			: "",
		projectStackContext
			? `Project: ${compactText(projectStackContext, 240)}`
			: "",
		`Sections: ${sections.map((section) => section.kind).join(", ") || "none"}`,
		omittedViews.length > 0
			? `Omitted views: ${omittedViews.map((item) => item.view).join(", ")}`
			: "",
	]
		.filter(Boolean)
		.join("\n");

	return {
		taskId: input.taskId,
		generatedAt: new Date().toISOString(),
		questionnaireSessionId: input.session?.id ?? null,
		summary,
		sections,
		sourceMessageIds,
		omittedViews,
		warnings,
	};
}

export function renderAssembledDesignContextMarkdown(
	context: AssembledDesignContext,
) {
	const lines = [
		"[Assembled Design Context]",
		`taskId: ${context.taskId}`,
		`generatedAt: ${context.generatedAt}`,
		context.questionnaireSessionId
			? `questionnaireSessionId: ${context.questionnaireSessionId}`
			: "",
		"",
		"## Summary",
		context.summary || "No assembled design context summary.",
	];
	if (context.omittedViews.length > 0) {
		lines.push(
			"",
			"## Omitted Views",
			...context.omittedViews.map(
				(item) => `- ${item.view}${item.reason ? `: ${item.reason}` : ""}`,
			),
		);
	}
	if (context.warnings.length > 0) {
		lines.push(
			"",
			"## Warnings",
			...context.warnings.map((warning) => `- ${warning}`),
		);
	}
	for (const section of context.sections) {
		lines.push(
			"",
			`## ${formatDesignContextKind(section.kind)}: ${section.title}`,
			section.sourceMessageId
				? `sourceMessageId: ${section.sourceMessageId}`
				: "",
			section.digest ? `digest: ${section.digest}` : "",
			"",
			section.content || "No content.",
		);
	}
	if (context.sourceMessageIds.length > 0) {
		lines.push(
			"",
			"## Source Messages",
			...context.sourceMessageIds.map((id) => `- ${id}`),
		);
	}
	return lines.filter((line) => line !== "").join("\n");
}

export function sanitizeSpecificationTargetNaming(
	content: string,
	projectStackContext: string,
) {
	const targetProjectName = extractTargetProjectName(projectStackContext);
	if (isNightWorkersTargetProject(projectStackContext, targetProjectName))
		return content;
	if (!/\bNightWorkers?\b/i.test(content)) return content;
	const replacement = targetProjectName
		? `対象プロジェクト（${targetProjectName}）`
		: "対象プロジェクト";
	return content.replace(/\bNightWorkers?\b/gi, replacement);
}

function extractTargetProjectName(projectStackContext: string) {
	const match = projectStackContext.match(/^-\s*Project name:\s*(.+)$/im);
	const name = match?.[1]?.trim();
	return name || null;
}

function isNightWorkersTargetProject(
	projectStackContext: string,
	targetProjectName: string | null,
) {
	return (
		/^nightworkers$/i.test(targetProjectName || "") ||
		/(^|\/)nightWorkers(\/|$)/.test(projectStackContext)
	);
}
