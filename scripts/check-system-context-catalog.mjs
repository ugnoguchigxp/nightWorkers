import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import ts from "@typescript/typescript6";

const repoRoot = process.cwd();
const errors = [];
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const catalogModulePath = "api/systemContexts/catalog.ts";

function walk(directory) {
	if (!fs.existsSync(directory)) return [];
	return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const target = path.join(directory, entry.name);
		if (entry.isDirectory()) return walk(target);
		return [target];
	});
}

function containsCatalogCall(node) {
	if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
		if (node.expression.text === "p") return true;
	}
	return node.getChildren().some(containsCatalogCall);
}

function isDirectTextAssembly(node) {
	return (
		ts.isArrayLiteralExpression(node) ||
		ts.isStringLiteral(node) ||
		ts.isNoSubstitutionTemplateLiteral(node) ||
		ts.isTemplateExpression(node)
	);
}

function containsNonEmptyDirectText(node) {
	if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
		return node.text.length > 0;
	}
	if (ts.isTemplateExpression(node)) {
		return (
			node.head.text.length > 0 ||
			node.templateSpans.some((span) => span.literal.text.length > 0)
		);
	}
	if (
		ts.isArrayLiteralExpression(node) ||
		ts.isConditionalExpression(node) ||
		ts.isBinaryExpression(node) ||
		ts.isParenthesizedExpression(node)
	) {
		return node.getChildren().some(containsNonEmptyDirectText);
	}
	return false;
}

for (const absolutePath of ["api", "tests"].flatMap((directory) =>
	walk(path.join(repoRoot, directory)),
)) {
	if (!sourceExtensions.has(path.extname(absolutePath))) continue;
	const relativePath = path.relative(repoRoot, absolutePath).replaceAll(path.sep, "/");
	if (relativePath.startsWith("api/systemContexts/generated/")) continue;
	const source = fs.readFileSync(absolutePath, "utf8");
	const sourceFile = ts.createSourceFile(
		relativePath,
		source,
		ts.ScriptTarget.Latest,
		true,
		absolutePath.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
	);

	function visit(node) {
		if (
			relativePath !== catalogModulePath &&
			ts.isCallExpression(node) &&
			ts.isPropertyAccessExpression(node.expression) &&
			(isExplicitLocaleBindingCall(node, sourceFile) ||
				node.expression.name.text === "createTextRenderer")
		) {
			errors.push(
				`${relativePath}:${sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1}: S11t locale binding is owned by ${catalogModulePath}`,
			);
		}
		if (relativePath.startsWith("api/") && ts.isPropertyAssignment(node)) {
			const name = node.name.getText(sourceFile).replaceAll(/["']/g, "");
			if (["systemPrompt", "developerInstructions"].includes(name) && isDirectTextAssembly(node.initializer)) {
				errors.push(`${relativePath}:${sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${name} must come from p(key, values)`);
			}
		}
		if (
			relativePath.startsWith("api/") &&
			ts.isVariableDeclaration(node) &&
			ts.isIdentifier(node.name)
		) {
			const isFixedSystemContextName =
				/SYSTEM_(?:CONTEXT|PROMPT)(?:_JA)?$/.test(node.name.text) ||
				/(?:systemContext|systemPrompt|developerInstructions)$/.test(
					node.name.text,
				);
			if (
				isFixedSystemContextName &&
				node.initializer &&
				containsNonEmptyDirectText(node.initializer) &&
				!containsCatalogCall(node.initializer)
			) {
				errors.push(`${relativePath}:${sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${node.name.text} must come from the central catalog`);
			}
		}
		ts.forEachChild(node, visit);
	}
	visit(sourceFile);

	if (
		relativePath.startsWith("api/") &&
		/modules\/(?:codingAgent|missionPilot)\/s11t\//.test(source)
	) {
		errors.push(`${relativePath}: role-local S11t catalog import is forbidden`);
	}
}

for (const absolutePath of walk(repoRoot)) {
	const relativePath = path.relative(repoRoot, absolutePath).replaceAll(path.sep, "/");
	if (!absolutePath.endsWith(".context.toml")) continue;
	if (!relativePath.startsWith("api/systemContexts/contexts/")) {
		errors.push(`${relativePath}: SystemContext source must live in api/systemContexts/contexts`);
	}
}

function isExplicitLocaleBindingCall(node, sourceFile) {
	if (!["bind", "bindText"].includes(node.expression.name.text)) return false;
	return node.arguments.some(
		(argument) =>
			ts.isObjectLiteralExpression(argument) &&
			argument.properties.some((property) => {
				if (!ts.isPropertyAssignment(property)) return false;
				const name = property.name.getText(sourceFile).replaceAll(/["']/g, "");
				return ["instructionLocale", "fallbackLocales"].includes(name);
			}),
	);
}

if (errors.length > 0) {
	console.error("[architecture] SystemContext catalog check failed");
	for (const error of errors) console.error(`- ${error}`);
	process.exit(1);
}

console.log("[architecture] all SystemContext sources resolve through api/systemContexts");
