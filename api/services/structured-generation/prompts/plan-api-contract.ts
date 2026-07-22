import type { PlanApiContractArtifact } from "../../../../shared/schemas/plan-mode-artifact.schema";
import { p } from "../../../systemContexts/catalog";

export const PLAN_API_CONTRACT_PROMPT_VERSION = "plan-mode-api-contract-v1";

const planApiContractRequestBodyDraftSchema = {
	type: "object",
	additionalProperties: false,
	required: ["description", "schemaName", "required"],
	properties: {
		description: { type: "string" },
		schemaName: { type: "string" },
		required: { type: "boolean" },
	},
} as const;

const planApiContractResponseDraftSchema = {
	type: "object",
	additionalProperties: false,
	required: ["status", "description", "schemaName"],
	properties: {
		status: { type: "integer", minimum: 100, maximum: 599 },
		description: { type: "string" },
		schemaName: { type: "string" },
	},
} as const;

const planApiContractParameterDraftSchema = {
	type: "object",
	additionalProperties: false,
	required: ["name", "in", "type", "required", "description"],
	properties: {
		name: { type: "string" },
		in: { type: "string", enum: ["query", "path", "header", "cookie"] },
		type: {
			type: "string",
			enum: [
				"string",
				"number",
				"integer",
				"boolean",
				"object",
				"array",
				"unknown",
			],
		},
		required: { type: "boolean" },
		description: { type: "string" },
	},
} as const;

const planApiContractFieldDraftSchema = {
	type: "object",
	additionalProperties: false,
	required: ["name", "type", "required", "description"],
	properties: {
		name: { type: "string" },
		type: {
			type: "string",
			enum: [
				"string",
				"number",
				"integer",
				"boolean",
				"object",
				"array",
				"unknown",
			],
		},
		required: { type: "boolean" },
		description: { type: "string" },
	},
} as const;

export const planApiContractStructuredOutputSchema = {
	type: "object",
	additionalProperties: false,
	required: [
		"artifactKind",
		"view",
		"title",
		"summary",
		"operations",
		"componentSchemas",
		"stateTransitions",
		"validation",
		"openQuestions",
	],
	properties: {
		artifactKind: { type: "string", const: "plan_mode_api_contract" },
		view: { type: "string", const: "api_io_contract" },
		title: { type: "string" },
		summary: { type: "string" },
		operations: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				required: [
					"path",
					"method",
					"operationId",
					"summary",
					"description",
					"tags",
					"parameters",
					"requestBody",
					"responses",
				],
				properties: {
					path: { type: "string" },
					method: {
						type: "string",
						enum: ["get", "post", "put", "patch", "delete", "options", "head"],
					},
					operationId: { type: "string" },
					summary: { type: "string" },
					description: { type: "string" },
					tags: { type: "array", items: { type: "string" } },
					parameters: {
						type: "array",
						items: planApiContractParameterDraftSchema,
					},
					requestBody: planApiContractRequestBodyDraftSchema,
					responses: {
						type: "array",
						items: planApiContractResponseDraftSchema,
					},
				},
			},
		},
		componentSchemas: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				required: ["name", "description", "fields"],
				properties: {
					name: { type: "string" },
					description: { type: "string" },
					fields: {
						type: "array",
						items: planApiContractFieldDraftSchema,
					},
				},
			},
		},
		stateTransitions: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				required: [
					"operationId",
					"fromState",
					"toState",
					"successStatus",
					"conflictStatuses",
					"stateField",
					"notes",
				],
				properties: {
					operationId: { type: "string" },
					fromState: { type: "string" },
					toState: { type: "string" },
					successStatus: { type: "integer", minimum: 100, maximum: 599 },
					conflictStatuses: {
						type: "array",
						items: { type: "integer", minimum: 100, maximum: 599 },
					},
					stateField: { type: "string" },
					notes: { type: "array", items: { type: "string" } },
				},
			},
		},
		validation: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				required: [
					"schemaName",
					"owner",
					"zodOwnerFile",
					"strictness",
					"examples",
				],
				properties: {
					schemaName: { type: "string" },
					owner: {
						type: "string",
						enum: ["request", "response", "error", "shared"],
					},
					zodOwnerFile: { type: "string" },
					strictness: {
						type: "string",
						enum: ["strict", "passthrough", "strip", "unknown"],
					},
					examples: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							required: ["name", "valid", "payloadJson", "expectedIssues"],
							properties: {
								name: { type: "string" },
								valid: { type: "boolean" },
								payloadJson: { type: "string" },
								expectedIssues: { type: "array", items: { type: "string" } },
							},
						},
					},
				},
			},
		},
		openQuestions: { type: "array", items: { type: "string" } },
	},
} as const;

export function buildPlanApiContractSystemPrompt() {
	return p("planViews.api-contract", {});
}

export function buildPlanApiContractUserPrompt(input: {
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
		"次の context から API Contract view を1つ生成してください。",
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

export function renderPlanApiContractSummary(
	artifact: PlanApiContractArtifact,
) {
	const operations = Object.entries(artifact.openapi.paths).flatMap(
		([path, methods]) =>
			Object.entries(methods).map(([method, operation]) => {
				const summary = operation.summary ? ` - ${operation.summary}` : "";
				return `- ${method.toUpperCase()} ${path} (${operation.operationId})${summary}`;
			}),
	);
	return [
		`# ${artifact.title}`,
		"",
		artifact.summary,
		"",
		"## Operations",
		...operations,
	].join("\n");
}
