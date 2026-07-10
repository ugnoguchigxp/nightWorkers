import mermaid from "mermaid";
import { z } from "zod";
import {
	type DataModelArtifact,
	dataModelArtifactSchema,
} from "../../../shared/schemas/plan-mode-artifact.schema";
import { AppError, NotFoundError } from "../../lib/errors";
import {
	buildDataModelSystemPrompt,
	buildDataModelUserPrompt,
	DATA_MODEL_PROMPT_VERSION,
	renderDataModelArtifactMarkdown,
} from "../../services/structured-generation/prompts/data-model";
import { callStructuredJsonLLM } from "../../services/structured-llm";
import { parseRepairedJsonWithSchema } from "../../services/structured-llm/json";
import { normalizeStructuredOutputJsonSchema } from "../../services/structured-llm/json-schema";
import type { StructuredLlmModelTarget } from "../../services/structured-llm/settings";
import {
	createPlanModeTaskMessage,
	getPlanModeTask,
	listPlanModeTaskMessages,
	type PlanModeTaskMessage,
} from "../nightworkers/nightworkers.plan-mode-core.port";
import { assertPlanModeCapabilityEnabled } from "../nightworkers/nightworkers.plan-mode-settings.service";
import {
	getDesignQuestionnaireSession,
	listDesignQuestionnaires,
} from "../questionnaire/questionnaire.service";
import { resolvePlanModeProjectStackContext } from "../specification/plan-mode-project-stack-context";
import { getPlanModeWorkspace } from "../specification/plan-mode-workspace.service";
import { renderQuestionnaireAnswerMarkdown } from "../specification/specification-document-renderer";
import { assertPlanModeMutable } from "../specification/specification-mutability";

const DATA_MODEL_MERMAID_MAX_ATTEMPTS = 3;

export type DataModelGenerationInput = {
	prompt?: string;
	questionnaireSessionId?: string | null;
	featurePlanMessageId?: string | null;
	sourceBlueprintMessageId?: string | null;
	routeOverride?: StructuredLlmModelTarget | null;
};

export class DataModelGenerationError extends Error {
	rawOutput?: string;

	constructor(message: string, rawOutput?: string) {
		super(message);
		this.name = "DataModelGenerationError";
		this.rawOutput = rawOutput;
	}
}

export async function generateDataModelArtifact(
	taskId: string,
	input: DataModelGenerationInput = {},
) {
	const task = await getPlanModeTask(taskId);
	if (!task) throw new NotFoundError("Task not found");
	assertPlanModeCapabilityEnabled("data_model");
	assertPlanModeMutable(task);

	const [messages, session] = await Promise.all([
		listPlanModeTaskMessages(taskId),
		resolveQuestionnaireSession(taskId, input.questionnaireSessionId),
	]);
	const featurePlanMessage = resolveSourceMessage(
		messages,
		input.featurePlanMessageId,
		"feature_plan",
	);
	const sourceBlueprintMessage = resolveSourceMessage(
		messages,
		input.sourceBlueprintMessageId,
		"blueprint",
	);
	const prompt =
		input.prompt?.trim() ||
		task.objective ||
		task.description ||
		task.title ||
		"No additional prompt.";
	const projectStackContext = await resolvePlanModeProjectStackContext(
		task.repositoryId,
	);
	const artifact = await generateArtifactFromLlm({
		taskId,
		task: renderTaskContext(task),
		projectStackContext,
		featurePlan: featurePlanMessage?.content || "Feature Plan は未生成です。",
		questionnaire: session
			? renderQuestionnaireAnswerMarkdown(session)
			: "Questionnaire は未生成です。",
		blueprint: sourceBlueprintMessage?.content || "Blueprint は未生成です。",
		prompt,
		routeOverride: input.routeOverride || null,
	});
	const message = await createPlanModeTaskMessage({
		taskId,
		role: "assistant",
		content: renderDataModelArtifactMarkdown(artifact),
		messageType: "markdown_document",
		payloadJson: {
			artifactKind: "plan_mode_dedicated_view",
			view: "data_model",
			source: "data-model",
			title: artifact.title,
			intent: "plan_mode_dedicated_view",
			artifactType: "data_model",
			dataModelArtifact: artifact,
			featurePlanMessageId: featurePlanMessage?.id ?? null,
			questionnaireSessionId: session?.id ?? null,
			sourceBlueprintMessageId: sourceBlueprintMessage?.id ?? null,
			sourceMessageIds: [
				featurePlanMessage?.id,
				sourceBlueprintMessage?.id,
			].filter((id): id is string => Boolean(id)),
			generation: {
				promptVersion: DATA_MODEL_PROMPT_VERSION,
			},
		},
	});
	return { message, workspace: await getPlanModeWorkspace(taskId) };
}

export function parseDataModelOutput(rawOutput: string): DataModelArtifact {
	const parsed = parseRepairedJsonWithSchema(
		rawOutput,
		dataModelArtifactSchema,
	);
	if (!parsed.ok)
		throw new DataModelGenerationError(
			"Data Model LLM output did not contain valid JSON.",
			rawOutput,
		);
	if (parsed.value.canonicalSource === "ddl" && !parsed.value.ddl?.trim()) {
		throw new DataModelGenerationError(
			"DDL-backed Data Model output must include ddl.",
			rawOutput,
		);
	}
	return parsed.value;
}

export function buildDataModelResponseJsonSchema() {
	return normalizeStructuredOutputJsonSchema(
		z.toJSONSchema(dataModelArtifactSchema),
	);
}

async function resolveQuestionnaireSession(
	taskId: string,
	sessionId?: string | null,
) {
	if (sessionId) return getDesignQuestionnaireSession(taskId, sessionId);
	const sessions = await listDesignQuestionnaires(taskId);
	return (
		sessions.find((session) => session.status === "accepted") ||
		sessions.find((session) => session.status === "review_ready") ||
		null
	);
}

function resolveSourceMessage(
	messages: PlanModeTaskMessage[],
	messageId: string | null | undefined,
	kind: "feature_plan" | "blueprint",
) {
	if (messageId) {
		return (
			messages.find(
				(message) => message.id === messageId && isMessageKind(message, kind),
			) || null
		);
	}
	return (
		[...messages].reverse().find((message) => isMessageKind(message, kind)) ||
		null
	);
}

async function generateArtifactFromLlm(input: {
	taskId: string;
	task: string;
	projectStackContext: string;
	featurePlan: string;
	questionnaire: string;
	blueprint: string;
	prompt: string;
	routeOverride: StructuredLlmModelTarget | null;
}) {
	try {
		const schema = buildDataModelResponseJsonSchema();
		let repairContext: string | null = null;
		let lastError: unknown = null;
		for (
			let attempt = 1;
			attempt <= DATA_MODEL_MERMAID_MAX_ATTEMPTS;
			attempt += 1
		) {
			const rawOutput = await callStructuredJsonLLM(
				buildDataModelSystemPrompt(JSON.stringify(schema, null, 2)),
				buildDataModelUserPrompt({ ...input, repairContext }),
				{
					schemaName: "plan_mode_data_model",
					schema,
					taskId: input.taskId,
					runId: null,
					role: "plan",
					routeOverride: input.routeOverride,
				},
			);
			try {
				const artifact = parseDataModelOutput(rawOutput);
				const mermaidError = await validateDataModelMermaidArtifact(artifact);
				if (!mermaidError) return artifact;
				lastError = new Error(mermaidError.error);
				repairContext = buildDataModelMermaidRepairContext({
					artifact,
					chart: mermaidError.chart,
					error: mermaidError.error,
				});
			} catch (err) {
				lastError = err;
				repairContext = buildDataModelOutputRepairContext(rawOutput, err);
			}
		}
		throw lastError instanceof Error
			? lastError
			: new Error("Data Model generation failed.");
	} catch (err) {
		if (err instanceof AppError) throw err;
		const message =
			err instanceof Error ? err.message : "Data Model generation failed.";
		throw new AppError(502, "DATA_MODEL_GENERATION_FAILED", message);
	}
}

async function validateDataModelMermaidArtifact(artifact: DataModelArtifact) {
	if (artifact.derivedTables.length === 0) return null;
	const chart = buildDataModelMermaidErDiagram(artifact);
	try {
		await mermaid.parse(chart);
		return null;
	} catch (err) {
		return { chart, error: err instanceof Error ? err.message : String(err) };
	}
}

function buildDataModelMermaidRepairContext(input: {
	artifact: DataModelArtifact;
	chart: string;
	error: string;
}) {
	return [
		"### Error",
		input.error,
		"",
		"### Previous Mermaid source",
		"```mermaid",
		input.chart.trim(),
		"```",
		"",
		"### Previous Data Model artifact JSON",
		JSON.stringify(input.artifact, null, 2),
	].join("\n");
}

function buildDataModelOutputRepairContext(rawOutput: string, err: unknown) {
	return [
		"### Error",
		err instanceof Error ? err.message : String(err),
		"",
		"### Previous raw output",
		rawOutput,
	].join("\n");
}

function buildDataModelMermaidErDiagram(artifact: DataModelArtifact) {
	const relationEdges = artifact.relations;
	const tableNames = artifact.derivedTables.map(
		(table, index) => table.name || `table_${index + 1}`,
	);
	const entityByTableName = new Map(
		tableNames.map((tableName) => [
			tableName,
			sanitizeMermaidIdentifier(tableName),
		]),
	);
	const lines = ["erDiagram"];

	artifact.derivedTables.forEach((table, index) => {
		const tableName = tableNames[index] || `table_${index + 1}`;
		const entityName =
			entityByTableName.get(tableName) || sanitizeMermaidIdentifier(tableName);
		lines.push(`  ${entityName} {`);
		if (table.columns.length === 0) {
			lines.push("    string no_columns");
		}
		table.columns.forEach((column, columnIndex) => {
			const columnName = column.name || `column_${columnIndex + 1}`;
			const type = sanitizeMermaidType(column.type || "string");
			const keys = mermaidColumnKeys(tableName, column, relationEdges);
			const comment = mermaidColumnComment(column);
			lines.push(
				`    ${sanitizeMermaidIdentifier(columnName)} ${type}${keys ? ` ${keys}` : ""}${
					comment ? ` "${comment}"` : ""
				}`,
			);
		});
		lines.push("  }");
	});

	relationEdges.forEach((relation) => {
		const fromTable = splitRelationEndpoint(relation.from)[0];
		const toTable = splitRelationEndpoint(relation.to)[0];
		const fromEntity =
			entityByTableName.get(fromTable) || sanitizeMermaidIdentifier(fromTable);
		const toEntity =
			entityByTableName.get(toTable) || sanitizeMermaidIdentifier(toTable);
		if (!fromEntity || !toEntity) return;
		lines.push(
			`  ${fromEntity} ${mermaidCardinality(relation.cardinality)} ${toEntity} : ${sanitizeMermaidLabel(
				relation.reason || "relates",
			)}`,
		);
	});

	return lines.join("\n");
}

function mermaidColumnKeys(
	tableName: string,
	column: DataModelArtifact["derivedTables"][number]["columns"][number],
	relations: DataModelArtifact["relations"],
) {
	const flags = [];
	if (column.primaryKey === true) flags.push("PK");
	if (isForeignKeyColumn(tableName, column.name, relations)) flags.push("FK");
	if (column.unique === true) flags.push("UK");
	return flags.join(", ");
}

function mermaidColumnComment(
	column: DataModelArtifact["derivedTables"][number]["columns"][number],
) {
	const notes = [];
	if (column.nullable === false) notes.push("not null");
	if (column.defaultValue) notes.push(`default ${column.defaultValue}`);
	return notes.join(", ");
}

function isForeignKeyColumn(
	tableName: string,
	columnName: string,
	relations: DataModelArtifact["relations"],
) {
	if (!columnName) return false;
	return relations.some((relation) => {
		return endpointMatchesColumn(relation.from, tableName, columnName);
	});
}

function endpointMatchesColumn(
	endpoint: string,
	tableName: string,
	columnName: string,
) {
	const [endpointTable, endpointColumn] = splitRelationEndpoint(endpoint);
	if (!endpointColumn) return false;
	return endpointTable === tableName && endpointColumn === columnName;
}

function splitRelationEndpoint(endpoint: string) {
	const trimmed = endpoint.trim();
	const dotIndex = trimmed.lastIndexOf(".");
	if (dotIndex > 0 && dotIndex < trimmed.length - 1) {
		return [trimmed.slice(0, dotIndex), trimmed.slice(dotIndex + 1)] as const;
	}
	return [trimmed, ""] as const;
}

function mermaidCardinality(value: string) {
	const labels: Record<string, string> = {
		one_to_one: "||--||",
		one_to_many: "||--o{",
		many_to_one: "}o--||",
		many_to_many: "}o--o{",
	};
	return labels[value] || "--";
}

function sanitizeMermaidIdentifier(value: string) {
	const sanitized = value
		.trim()
		.replace(/[^a-zA-Z0-9_]/g, "_")
		.replace(/^([0-9])/, "_$1")
		.replace(/_+/g, "_");
	return sanitized || "unnamed";
}

function sanitizeMermaidType(value: string) {
	const sanitized = value
		.trim()
		.split(/\s+/)[0]
		.replace(/[^a-zA-Z0-9_]/g, "_")
		.replace(/^([0-9])/, "t_$1")
		.replace(/_+/g, "_");
	return sanitized || "string";
}

function sanitizeMermaidLabel(value: string) {
	const label =
		value
			.replace(/["`:]/g, " ")
			.replace(/\s+/g, " ")
			.trim()
			.split(" ")
			.slice(0, 10)
			.join(" ") || "relates";
	return `"${label}"`;
}

function isMessageKind(
	message: PlanModeTaskMessage,
	kind: "feature_plan" | "blueprint",
) {
	if (message.messageType !== "markdown_document") return false;
	const metadata = (message.metadataJson || {}) as Record<string, unknown>;
	if (kind === "feature_plan") return metadata.intent === "feature_plan";
	return (
		(metadata.intent === "app_blueprint" && Boolean(metadata.appBlueprint)) ||
		(metadata.intent === "mock_blueprint" && Boolean(metadata.mockBlueprint))
	);
}

function renderTaskContext(task: {
	title?: string | null;
	description?: string | null;
	objective?: string | null;
}) {
	return [
		`Title: ${task.title || "Untitled"}`,
		task.description ? `Description: ${task.description}` : "",
		task.objective ? `Objective: ${task.objective}` : "",
	]
		.filter(Boolean)
		.join("\n");
}
