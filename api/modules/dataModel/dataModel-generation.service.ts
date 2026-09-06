import mermaid from "mermaid";
import { z } from "zod";
import {
	type DataModelArtifact,
	dataModelArtifactSchema,
} from "../../../shared/schemas/plan-mode-artifact.schema";
import type { TraceProvenance } from "../../../shared/schemas/trace-provenance.schema";
import { NotFoundError } from "../../lib/errors";
import {
	buildDataModelSystemPrompt,
	buildDataModelUserPrompt,
	DATA_MODEL_PROMPT_VERSION,
	renderDataModelArtifactMarkdown,
} from "../../services/structured-generation/prompts/data-model";
import { createStructuredGenerationAppError } from "../../services/structured-generation/structured-generation-error";
import { callStructuredOutputWithRepair } from "../../services/structured-generation/structured-output-repair.service";
import { createStructuredOutputContract } from "../../services/structured-llm";
import { parseRepairedJsonWithSchema } from "../../services/structured-llm/json";
import { normalizeStructuredOutputJsonSchema } from "../../services/structured-llm/json-schema";
import type {
	StructuredLlmModelTarget,
	StructuredLlmRole,
} from "../../services/structured-llm/settings";
import type { StructuredProviderExecutionPolicy } from "../agentsShare";
import {
	createPlanModeTaskMessage,
	getPlanModeTask,
} from "../nightworkers/nightworkers.plan-mode-core.port";
import { assertPlanModeCapabilityEnabled } from "../nightworkers/nightworkers.plan-mode-settings.service";
import type { PlanArtifactSourceSelection } from "../specification/plan-artifact-input.types";
import { resolvePlanArtifactCanonicalInput } from "../specification/plan-artifact-input-context.service";
import {
	createPlanArtifactProjectionMetadata,
	projectPlanArtifactInput,
} from "../specification/plan-artifact-input-projection";
import {
	buildPlanArtifactPromptBudgetMetadata,
	PLAN_ARTIFACT_GENERATION_TIMEOUT_MS,
	renderPlanArtifactInput,
} from "../specification/plan-artifact-input-renderer";
import { createPlanArtifactSourceSelection } from "../specification/plan-artifact-source-selection";
import { getPlanModeWorkspace } from "../specification/plan-mode-workspace.service";
import { assertPlanModeMutable } from "../specification/specification-mutability";

const DATA_MODEL_MERMAID_MAX_ATTEMPTS = 2;

export type DataModelGenerationInput = {
	prompt?: string;
	questionnaireSessionId?: string | null;
	sourceSelection?: PlanArtifactSourceSelection;
	routeOverride?: StructuredLlmModelTarget | null;
	role?: StructuredLlmRole;
	executionPolicy?: StructuredProviderExecutionPolicy;
	trace?: TraceProvenance;
	llmUsageTrace?: TraceProvenance;
	signal?: AbortSignal;
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

	const canonical = await resolvePlanArtifactCanonicalInput({
		taskId,
		target: "data_model",
		questionnaireSessionId: input.questionnaireSessionId ?? null,
		sourceSelection:
			input.sourceSelection ??
			createPlanArtifactSourceSelection({ policy: "explicit_request" }),
		regenerationRequest: input.prompt ?? null,
	});
	const projection = projectPlanArtifactInput(canonical);
	const renderedInput = renderPlanArtifactInput(projection);
	const artifact = await generateArtifactFromLlm({
		taskId,
		task: renderedInput.task,
		projectStackContext: renderedInput.projectContext,
		featurePlan: renderedInput.featurePlan,
		questionnaire: renderedInput.questionnaire,
		blueprint: renderedInput.blueprint,
		prompt: renderedInput.regenerationRequest ?? "",
		projectionPrompt: renderedInput.prompt,
		projection,
		routeOverride: input.routeOverride || null,
		role: input.role ?? "plan",
		executionPolicy: input.executionPolicy,
		usageTrace: input.llmUsageTrace,
		signal: input.signal,
	});
	input.signal?.throwIfAborted();
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
			featurePlanMessageId: input.sourceSelection?.featurePlanMessageId ?? null,
			questionnaireSessionId: canonical.questionnaire?.sessionId ?? null,
			sourceBlueprintMessageId:
				input.sourceSelection?.blueprintMessageId ?? null,
			sourceMessageIds: projection.provenance.sourceMessageIds,
			generation: {
				promptVersion: DATA_MODEL_PROMPT_VERSION,
				inputProjection: createPlanArtifactProjectionMetadata(
					projection,
					canonical.questionnaire?.sessionId ?? null,
				),
			},
		},
		trace: input.trace,
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

async function generateArtifactFromLlm(input: {
	taskId: string;
	task: string;
	projectStackContext: string;
	featurePlan: string;
	questionnaire: string;
	blueprint: string;
	prompt: string;
	projectionPrompt?: string;
	projection: ReturnType<typeof projectPlanArtifactInput>;
	routeOverride: StructuredLlmModelTarget | null;
	role: StructuredLlmRole;
	executionPolicy?: StructuredProviderExecutionPolicy;
	usageTrace?: TraceProvenance;
	signal?: AbortSignal;
}) {
	let lastRawOutput: string | null = null;
	try {
		const schema = buildDataModelResponseJsonSchema();
		let repairContext: string | null = null;
		let lastError: unknown = null;
		for (
			let attempt = 1;
			attempt <= DATA_MODEL_MERMAID_MAX_ATTEMPTS;
			attempt += 1
		) {
			const systemPrompt = buildDataModelSystemPrompt(
				JSON.stringify(schema, null, 2),
			);
			const userPrompt = buildDataModelUserPrompt({ ...input, repairContext });
			const generated = await callStructuredOutputWithRepair({
				systemPrompt,
				userPrompt,
				options: {
					contract: createStructuredOutputContract({
						name: "plan_mode_data_model",
						runtimeSchema: dataModelArtifactSchema,
						providerJsonSchema: schema,
					}),
					taskId: input.taskId,
					runId: null,
					role: input.role,
					executionPolicy: input.executionPolicy,
					usageTrace: input.usageTrace,
					routeOverride: input.routeOverride,
					promptBudgetMetadata: buildPlanArtifactPromptBudgetMetadata({
						projection: input.projection,
						systemPrompt,
						userPrompt,
						role: input.role,
						routeOverride: input.routeOverride,
					}),
					timeoutMs: PLAN_ARTIFACT_GENERATION_TIMEOUT_MS,
					signal: input.signal,
				},
			});
			const rawOutput =
				generated.attempts.at(-1)?.rawText ?? JSON.stringify(generated.value);
			lastRawOutput = rawOutput;
			try {
				const artifact = generated.value;
				if (artifact.canonicalSource === "ddl" && !artifact.ddl?.trim()) {
					throw new Error("DDL-backed Data Model output must include ddl.");
				}
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
		throw createStructuredGenerationAppError({
			code: "DATA_MODEL_GENERATION_FAILED",
			fallbackMessage: "Data Model generation failed.",
			error: err,
			lastRawText: lastRawOutput,
		});
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
