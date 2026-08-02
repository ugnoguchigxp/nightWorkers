import ts from "@typescript/typescript6";
import { z } from "zod";
import type { PlanZodSchemaArtifact } from "../../../shared/schemas/plan-mode-artifact.schema";
import { planZodSchemaArtifactSchema } from "../../../shared/schemas/plan-mode-artifact.schema";
import { parseRepairedJsonWithSchema } from "../../services/structured-llm/json";
import {
	isZodMethodCall,
	parseZodObjectSource,
} from "./plan-view-zod-source-parser";

export {
	createPlanApiContractArtifact,
	parsePlanApiContractOutput,
	planApiContractOpenApiSchema,
	validateOpenApiDocument,
} from "./plan-api-contract-openapi";

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
