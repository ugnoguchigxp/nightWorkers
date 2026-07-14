import ts from "@typescript/typescript6";
import type { PlanZodSchemaArtifact } from "../../../shared/schemas/plan-mode-artifact.schema";

export function parseZodObjectSource(zodSource: string): {
	fields: PlanZodSchemaArtifact["fields"];
	unsupportedExpressions: string[];
} {
	const sourceFile = ts.createSourceFile(
		"plan-zod-schema.ts",
		zodSource,
		ts.ScriptTarget.Latest,
		true,
	);
	const objectLiteral = findFirstZodObjectLiteral(sourceFile);
	if (!objectLiteral) {
		throw new Error(
			"Zod schema source must contain a top-level z.object({...}) schema.",
		);
	}
	const fields: PlanZodSchemaArtifact["fields"] = [];
	const unsupportedExpressions: string[] = [];
	fields.push(...parseZodObjectFields(objectLiteral, sourceFile));
	for (const field of fields) {
		if (field.type === "unknown") {
			unsupportedExpressions.push(`${field.name}: ${field.zodExpression}`);
		}
	}
	if (fields.length === 0) {
		throw new Error("Zod schema source must define at least one object field.");
	}
	return { fields, unsupportedExpressions };
}

export function parseZodObjectFields(
	objectLiteral: ts.ObjectLiteralExpression,
	sourceFile: ts.SourceFile,
): PlanZodSchemaArtifact["fields"] {
	const fields: PlanZodSchemaArtifact["fields"] = [];
	for (const property of objectLiteral.properties) {
		if (!ts.isPropertyAssignment(property)) continue;
		const name = propertyNameText(property.name);
		if (!name) continue;
		const expression = property.initializer;
		const field = analyzeZodFieldExpression(name, expression, sourceFile);
		fields.push(field);
	}
	return fields;
}

export function findFirstZodObjectLiteral(
	sourceFile: ts.SourceFile,
): ts.ObjectLiteralExpression | null {
	const visit = (node: ts.Node): ts.ObjectLiteralExpression | null => {
		if (ts.isCallExpression(node) && isZodMethodCall(node, "object")) {
			const firstArg = node.arguments[0];
			if (firstArg && ts.isObjectLiteralExpression(firstArg)) {
				return firstArg;
			}
		}
		return ts.forEachChild(node, visit) ?? null;
	};
	return visit(sourceFile);
}

export function analyzeZodFieldExpression(
	name: string,
	expression: ts.Expression,
	sourceFile: ts.SourceFile,
): PlanZodSchemaArtifact["fields"][number] {
	const analysis: PlanZodSchemaArtifact["fields"][number] = {
		name,
		type: "unknown",
		required: true,
		description: null,
		enumOptions: [],
		defaultValue: null,
		referencedSchema: null,
		children: [],
		rules: [],
		zodExpression: expression.getText(sourceFile),
	};
	collectZodCalls(expression, sourceFile, analysis);
	if (analysis.type === "unknown") {
		const referencedSchema = zodExpressionRootIdentifier(expression);
		if (referencedSchema) {
			analysis.type = "reference";
			analysis.referencedSchema = referencedSchema;
		}
	}
	return analysis;
}

export function collectZodCalls(
	expression: ts.Expression,
	sourceFile: ts.SourceFile,
	analysis: PlanZodSchemaArtifact["fields"][number],
) {
	if (
		!ts.isCallExpression(expression) ||
		!ts.isPropertyAccessExpression(expression.expression)
	) {
		return;
	}
	const method = expression.expression.name.text;
	const target = expression.expression.expression;
	if (ts.isIdentifier(target) && target.text === "z") {
		applyZodBaseCall(method, expression, sourceFile, analysis);
		return;
	}
	collectZodCalls(target, sourceFile, analysis);
	applyZodRuleCall(method, expression, sourceFile, analysis);
}

export function zodExpressionRootIdentifier(
	expression: ts.Expression,
): string | null {
	if (ts.isIdentifier(expression)) {
		return expression.text === "z" ? null : expression.text;
	}
	if (ts.isCallExpression(expression)) {
		return zodExpressionRootIdentifier(expression.expression);
	}
	if (ts.isPropertyAccessExpression(expression)) {
		return zodExpressionRootIdentifier(expression.expression);
	}
	if (ts.isParenthesizedExpression(expression)) {
		return zodExpressionRootIdentifier(expression.expression);
	}
	return null;
}

export function applyZodBaseCall(
	method: string,
	expression: ts.CallExpression,
	sourceFile: ts.SourceFile,
	analysis: PlanZodSchemaArtifact["fields"][number],
) {
	if (
		method === "string" ||
		method === "number" ||
		method === "boolean" ||
		method === "array"
	) {
		analysis.type = method;
		return;
	}
	if (method === "enum") {
		analysis.type = "enum";
		const values = expression.arguments[0];
		if (values && ts.isArrayLiteralExpression(values)) {
			analysis.enumOptions = values.elements
				.map((element) => literalValue(element, sourceFile))
				.filter((value): value is string => typeof value === "string");
		}
	}
	if (method === "object") {
		analysis.type = "object";
		const objectLiteral = expression.arguments[0];
		if (objectLiteral && ts.isObjectLiteralExpression(objectLiteral)) {
			analysis.children = parseZodObjectFields(objectLiteral, sourceFile);
		}
	}
}

export function applyZodRuleCall(
	method: string,
	expression: ts.CallExpression,
	sourceFile: ts.SourceFile,
	analysis: PlanZodSchemaArtifact["fields"][number],
) {
	if (method === "optional" || method === "nullish") {
		analysis.required = false;
	}
	if (method === "default") {
		analysis.required = false;
		analysis.defaultValue =
			literalValue(expression.arguments[0], sourceFile) ?? null;
	}
	if (method === "describe") {
		const description = literalValue(expression.arguments[0], sourceFile);
		if (typeof description === "string") analysis.description = description;
	}
	const ruleNames = new Set([
		"min",
		"max",
		"length",
		"email",
		"url",
		"uuid",
		"regex",
		"int",
		"positive",
		"nonnegative",
		"optional",
		"nullable",
		"nullish",
		"default",
		"describe",
		"trim",
		"strict",
	]);
	if (!ruleNames.has(method)) return;
	analysis.rules.push({
		name: method,
		args: expression.arguments
			.map((argument) => literalValue(argument, sourceFile))
			.filter((value): value is string | number | boolean => value !== null),
		message: null,
	});
}

export function isZodMethodCall(node: ts.CallExpression, method: string) {
	return (
		ts.isPropertyAccessExpression(node.expression) &&
		node.expression.name.text === method &&
		ts.isIdentifier(node.expression.expression) &&
		node.expression.expression.text === "z"
	);
}

export function propertyNameText(name: ts.PropertyName) {
	if (
		ts.isIdentifier(name) ||
		ts.isStringLiteral(name) ||
		ts.isNumericLiteral(name)
	) {
		return name.text;
	}
	return null;
}

export function literalValue(
	node: ts.Node | undefined,
	sourceFile: ts.SourceFile,
) {
	if (!node) return null;
	if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
		return node.text;
	if (ts.isNumericLiteral(node)) return Number(node.text);
	if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
	if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
	return node.getText(sourceFile);
}
