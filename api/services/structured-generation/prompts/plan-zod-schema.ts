import type { PlanZodSchemaArtifact } from "../../../../shared/schemas/plan-mode-artifact.schema";
import { p } from "../../../systemContexts/catalog";

export const PLAN_ZOD_SCHEMA_PROMPT_VERSION = "plan-mode-zod-schema-v1";

export const planZodSchemaStructuredOutputSchema = {
	type: "object",
	additionalProperties: false,
	required: [
		"artifactKind",
		"view",
		"title",
		"summary",
		"schemaName",
		"owner",
		"zodSource",
		"openQuestions",
	],
	properties: {
		artifactKind: { type: "string", const: "plan_mode_zod_schema" },
		view: { type: "string", const: "zod_schema_design" },
		title: { type: "string" },
		summary: { type: "string" },
		schemaName: { type: "string" },
		owner: {
			type: "string",
			enum: [
				"llm_json",
				"worker_tool_input",
				"mcp_input",
				"provider_adapter",
				"local_config",
			],
		},
		zodSource: { type: "string" },
		openQuestions: { type: "array", items: { type: "string" } },
	},
} as const;

export function buildPlanZodSchemaSystemPrompt() {
	return p("planViews.zod-schema", {});
}

export function buildPlanZodSchemaUserPrompt(input: {
	task: string;
	projectStackContext?: string | null;
	featurePlan: string;
	questionnaire: string;
	blueprint: string;
	dataModel: string;
	prompt: string;
	projectionPrompt?: string;
}) {
	if (input.projectionPrompt?.trim()) return input.projectionPrompt.trim();
	return [
		"次の context から Zod Schema view を1つ生成してください。",
		"",
		"## Task",
		input.task,
		"",
		"## Project Stack Context",
		input.projectStackContext?.trim() || "Project stack は未検出です。",
		"",
		"## Feature Plan",
		input.featurePlan,
		"",
		"## Questionnaire / Decisions",
		input.questionnaire,
		"",
		"## Blueprint Context",
		input.blueprint,
		"",
		"## Data Model Context",
		input.dataModel,
		"",
		"## User Prompt",
		input.prompt,
	].join("\n");
}

export function renderPlanZodSchemaSummary(artifact: PlanZodSchemaArtifact) {
	return [
		artifact.summary,
		"",
		`Schema: ${artifact.schemaName}`,
		`Fields: ${artifact.fields.length}`,
	].join("\n");
}
