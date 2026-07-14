import ts from "@typescript/typescript6";
import { z } from "zod";
import type {
	PlanApiContractArtifact,
	PlanZodSchemaArtifact,
} from "../../../shared/schemas/plan-mode-artifact.schema";
import {
	planApiContractArtifactSchema,
	planZodSchemaArtifactSchema,
} from "../../../shared/schemas/plan-mode-artifact.schema";
import { parseRepairedJsonWithSchema } from "../../services/structured-llm/json";
import {
	isZodMethodCall,
	parseZodObjectSource,
} from "./plan-view-zod-source-parser";

const httpMethodSchema = z.enum([
	"get",
	"post",
	"put",
	"patch",
	"delete",
	"options",
	"head",
]);
const jsonSchemaFieldTypeSchema = z.enum([
	"string",
	"number",
	"integer",
	"boolean",
	"object",
	"array",
	"unknown",
]);
const httpParameterLocationSchema = z.enum([
	"query",
	"path",
	"header",
	"cookie",
]);

export const planApiContractDraftSchema = z.object({
	artifactKind: z.literal("plan_mode_api_contract"),
	view: z.literal("api_io_contract"),
	title: z.string().min(1),
	summary: z.string().min(1),
	operations: z
		.array(
			z.object({
				path: z.string().min(1),
				method: httpMethodSchema,
				operationId: z.string().min(1),
				summary: z.string(),
				description: z.string(),
				tags: z.array(z.string()),
				parameters: z.array(
					z.object({
						name: z.string().min(1),
						in: httpParameterLocationSchema,
						type: jsonSchemaFieldTypeSchema,
						required: z.boolean(),
						description: z.string(),
					}),
				),
				requestBody: z.object({
					description: z.string(),
					schemaName: z.string(),
					required: z.boolean(),
				}),
				responses: z
					.array(
						z.object({
							status: z.number().int().min(100).max(599),
							description: z.string(),
							schemaName: z.string(),
						}),
					)
					.min(1),
			}),
		)
		.min(1),
	componentSchemas: z.array(
		z.object({
			name: z.string().min(1),
			description: z.string(),
			fields: z.array(
				z.object({
					name: z.string().min(1),
					type: jsonSchemaFieldTypeSchema,
					required: z.boolean(),
					description: z.string(),
				}),
			),
		}),
	),
	stateTransitions: z.array(
		z.object({
			operationId: z.string().min(1),
			fromState: z.string(),
			toState: z.string(),
			successStatus: z.number().int().min(100).max(599),
			conflictStatuses: z.array(z.number().int().min(100).max(599)),
			stateField: z.string(),
			notes: z.array(z.string()),
		}),
	),
	validation: z.array(
		z.object({
			schemaName: z.string().min(1),
			owner: z.enum(["request", "response", "error", "shared"]),
			zodOwnerFile: z.string(),
			strictness: z.enum(["strict", "passthrough", "strip", "unknown"]),
			examples: z.array(
				z.object({
					name: z.string().min(1),
					valid: z.boolean(),
					payloadJson: z.string(),
					expectedIssues: z.array(z.string()),
				}),
			),
		}),
	),
	openQuestions: z.array(z.string()),
});

export const planZodSchemaDraftSchema = z.object({
	artifactKind: z.literal("plan_mode_zod_schema"),
	view: z.literal("zod_schema_design"),
	title: z.string().min(1),
	summary: z.string().min(1),
	schemaName: z.string().min(1),
	owner: z.enum([
		"llm_json",
		"worker_tool_input",
		"mcp_input",
		"provider_adapter",
		"local_config",
	]),
	zodSource: z.string().min(1),
	openQuestions: z.array(z.string()),
});

export function parsePlanZodSchemaOutput(
	rawOutput: string,
	options: { sourceText?: string | null } = {},
): PlanZodSchemaArtifact {
	const parsed = parseRepairedJsonWithSchema(
		rawOutput,
		planZodSchemaDraftSchema,
	);
	if (!parsed.ok)
		throw new Error("Plan Zod schema output did not contain valid JSON.");
	validatePlanZodSchemaTarget(parsed.value, options.sourceText);
	const parsedSource = parseZodObjectSource(parsed.value.zodSource);
	return planZodSchemaArtifactSchema.parse({
		...parsed.value,
		fields: parsedSource.fields,
		unsupportedExpressions: parsedSource.unsupportedExpressions,
	});
}

export function buildZodSchemaSourceEvidence(input: {
	task: string;
	featurePlan: string;
	questionnaire: string;
	blueprint: string;
	dataModel: string;
	prompt: string;
}) {
	return [
		input.task,
		input.featurePlan,
		input.questionnaire,
		input.blueprint,
		input.dataModel,
		input.prompt,
	].join("\n");
}

export function validatePlanZodSchemaTarget(
	artifact: z.infer<typeof planZodSchemaDraftSchema>,
	sourceText: string | null | undefined,
) {
	const combined = [
		artifact.title,
		artifact.summary,
		artifact.schemaName,
		artifact.zodSource,
	]
		.join("\n")
		.toLowerCase();
	const forbiddenMetaTerms = [
		"plandecision",
		"plan decision",
		"planmode",
		"plan mode",
		"questionnaire",
		"decisionschema",
		"decision schema",
		"nightworkers",
	];
	const matched = forbiddenMetaTerms.find((term) => combined.includes(term));
	if (matched) {
		throw new Error(
			`Plan Zod schema output targeted Plan Mode metadata instead of the target application schema: ${matched}`,
		);
	}
	validatePlanZodSchemaScope(artifact, sourceText);
}

export function validatePlanZodSchemaScope(
	artifact: z.infer<typeof planZodSchemaDraftSchema>,
	sourceText: string | null | undefined,
) {
	const declaredSchemaNames = extractZodConstSchemaNames(artifact.zodSource);
	const aggregateSchema = declaredSchemaNames.find((name) =>
		/(?:runtime|aggregate|root)schema$/i.test(name),
	);
	if (aggregateSchema) {
		throw new Error(
			`Plan Zod schema output included an aggregate/root schema: ${aggregateSchema}`,
		);
	}
	const context = normalizeScopeText(sourceText || "");
	const scopedRules = [
		{
			label: "settings/preference schema",
			namePattern: /(?:settings|setting|preferences|preference|config)schema$/i,
			contextPattern:
				/settings?|preferences?|config|設定|既定|デフォルト|default/i,
		},
		{
			label: "sort schema",
			namePattern: /(?:sort|order|ordering)schema$/i,
			contextPattern: /sort|order|ordering|並び替え|並び順|ソート/i,
		},
		{
			label: "filter/search schema",
			namePattern: /(?:filter|search|query)schema$/i,
			contextPattern: /filter|search|query|絞り込み|検索|フィルタ/i,
		},
		{
			label: "list/category/group management schema",
			namePattern: /(?:list|category|group)(?:input)?schema$/i,
			contextPattern: /list|category|group|リスト|カテゴリ|分類|グループ/i,
		},
	];
	for (const rule of scopedRules) {
		const schemaName = declaredSchemaNames.find((name) =>
			rule.namePattern.test(name),
		);
		if (schemaName && !rule.contextPattern.test(context)) {
			throw new Error(
				`Plan Zod schema output included ${rule.label} without source scope evidence: ${schemaName}`,
			);
		}
	}
	if (declaredSchemaNames.length > 4) {
		throw new Error(
			`Plan Zod schema output included too many object schemas for a focused validation view: ${declaredSchemaNames.length}`,
		);
	}
}

export function extractZodConstSchemaNames(zodSource: string) {
	const sourceFile = ts.createSourceFile(
		"plan-zod-schema.ts",
		zodSource,
		ts.ScriptTarget.Latest,
		true,
	);
	const names: string[] = [];
	sourceFile.forEachChild((node) => {
		if (!ts.isVariableStatement(node)) return;
		for (const declaration of node.declarationList.declarations) {
			if (!ts.isIdentifier(declaration.name) || !declaration.initializer)
				continue;
			if (containsZodObjectCall(declaration.initializer)) {
				names.push(declaration.name.text);
			}
		}
	});
	return names;
}

export function containsZodObjectCall(expression: ts.Expression): boolean {
	if (ts.isCallExpression(expression) && isZodMethodCall(expression, "object"))
		return true;
	if (ts.isCallExpression(expression))
		return containsZodObjectCall(expression.expression);
	if (ts.isPropertyAccessExpression(expression))
		return containsZodObjectCall(expression.expression);
	if (ts.isParenthesizedExpression(expression))
		return containsZodObjectCall(expression.expression);
	return false;
}

export function normalizeScopeText(value: string) {
	return value.toLowerCase();
}

export function parsePlanApiContractOutput(
	rawOutput: string,
): PlanApiContractArtifact {
	const artifact = parseRepairedJsonWithSchema(
		rawOutput,
		planApiContractArtifactSchema,
	);
	if (artifact.ok) {
		validateApiContractOperationReferences(artifact.value);
		return artifact.value;
	}

	const draft = parseRepairedJsonWithSchema(
		rawOutput,
		planApiContractDraftSchema,
	);
	if (!draft.ok)
		throw new Error("Plan API contract output did not contain valid JSON.");
	const normalized = normalizePlanApiContractDraft(draft.value);
	validateApiContractOperationReferences(normalized);
	return normalized;
}

export function validateApiContractOperationReferences(
	artifact: PlanApiContractArtifact,
) {
	const operationIds = new Set(
		Object.values(artifact.openapi.paths).flatMap((methods) =>
			Object.values(methods).map((operation) => operation.operationId),
		),
	);
	for (const transition of artifact.stateTransitions) {
		if (!operationIds.has(transition.operationId)) {
			throw new Error(
				`State transition references unknown operationId: ${transition.operationId}`,
			);
		}
	}
}

export function normalizePlanApiContractDraft(
	draft: z.infer<typeof planApiContractDraftSchema>,
): PlanApiContractArtifact {
	const components = Object.fromEntries(
		draft.componentSchemas.map((schema) => [
			schema.name,
			{
				type: "object",
				description: blankToUndefined(schema.description),
				properties: Object.fromEntries(
					schema.fields.map((field) => [
						field.name,
						{
							...jsonSchemaTypeForField(field.type),
							description: blankToUndefined(field.description),
						},
					]),
				),
				required: schema.fields
					.filter((field) => field.required)
					.map((field) => field.name),
			},
		]),
	);
	const paths: PlanApiContractArtifact["openapi"]["paths"] = {};
	for (const operationDraft of draft.operations) {
		const pathOperations = paths[operationDraft.path] ?? {};
		paths[operationDraft.path] = pathOperations;
		const requestSchemaName = operationDraft.requestBody.schemaName.trim();
		const operation: PlanApiContractArtifact["openapi"]["paths"][string][string] =
			{
				operationId: operationDraft.operationId,
				summary: blankToNull(operationDraft.summary),
				description: blankToNull(operationDraft.description),
				tags: operationDraft.tags,
				responses: Object.fromEntries(
					operationDraft.responses.map((response) => [
						String(response.status),
						{
							description: response.description || "Response",
							...contentForSchemaName(response.schemaName),
						},
					]),
				),
			};
		if (operationDraft.parameters.length > 0) {
			operation.parameters = operationDraft.parameters.map((parameter) => ({
				name: parameter.name,
				in: parameter.in,
				required: parameter.in === "path" ? true : parameter.required,
				description: blankToUndefined(parameter.description),
				schema: jsonSchemaTypeForField(parameter.type),
			}));
		}
		if (requestSchemaName) {
			operation.requestBody = {
				required: operationDraft.requestBody.required,
				description: blankToUndefined(operationDraft.requestBody.description),
				...contentForSchemaName(requestSchemaName),
			};
		}
		pathOperations[operationDraft.method] = operation;
	}
	const parsed = planApiContractArtifactSchema.parse({
		artifactKind: "plan_mode_api_contract",
		view: "api_io_contract",
		title: draft.title,
		summary: draft.summary,
		openapi: {
			openapi: "3.1.0",
			info: {
				title: draft.title,
				version: "0.1.0",
			},
			paths,
			components: {
				schemas: components,
			},
		},
		stateTransitions: draft.stateTransitions.map((transition) => ({
			operationId: transition.operationId,
			fromState: blankToNull(transition.fromState),
			toState: blankToNull(transition.toState),
			successStatus: transition.successStatus,
			conflictStatuses: transition.conflictStatuses,
			stateField: blankToNull(transition.stateField),
			notes: transition.notes,
		})),
		validation: draft.validation.map((entry) => ({
			schemaName: entry.schemaName,
			owner: entry.owner,
			zodOwnerFile: blankToNull(entry.zodOwnerFile),
			strictness: entry.strictness,
			examples: entry.examples.map((example) => ({
				name: example.name,
				valid: example.valid,
				payload: parsePayloadJson(example.payloadJson),
				expectedIssues: example.expectedIssues,
			})),
		})),
		openQuestions: draft.openQuestions,
	});
	return parsed;
}

export function contentForSchemaName(schemaName: string) {
	const normalized = schemaName.trim();
	if (!normalized) return {};
	return {
		content: {
			"application/json": {
				schema: {
					$ref: `#/components/schemas/${normalized}`,
				},
			},
		},
	};
}

export function jsonSchemaTypeForField(
	type: z.infer<typeof jsonSchemaFieldTypeSchema>,
) {
	if (type === "unknown") return {};
	if (type === "array") return { type: "array", items: {} };
	return { type };
}

export function parsePayloadJson(payloadJson: string): unknown {
	try {
		return JSON.parse(payloadJson);
	} catch {
		return payloadJson;
	}
}

export function blankToNull(value: string) {
	const normalized = value.trim();
	return normalized ? normalized : null;
}

export function blankToUndefined(value: string) {
	const normalized = value.trim();
	return normalized ? normalized : undefined;
}
