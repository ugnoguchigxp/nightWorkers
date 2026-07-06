import path from "node:path";
import * as ts from "typescript";
import type {
	InspectStructureOutput,
	SourceImportSummary,
	SourceSymbolSummary,
} from "./types";

export function inspectSourceSymbols(input: {
	filePath: string;
	content: string;
	includeImports: boolean;
}): InspectStructureOutput {
	const language = /\.tsx?$/.test(input.filePath) ? "typescript" : "javascript";
	const sourceFile = ts.createSourceFile(
		input.filePath,
		input.content,
		ts.ScriptTarget.Latest,
		true,
		getScriptKind(input.filePath),
	);

	const symbols: SourceSymbolSummary[] = [];
	const imports: SourceImportSummary[] = [];

	sourceFile.statements.forEach((statement) => {
		if (ts.isImportDeclaration(statement)) {
			imports.push(readImport(sourceFile, statement));
			return;
		}
		collectTopLevelSymbol(sourceFile, statement, symbols);
	});

	return {
		kind: "source",
		filePath: input.filePath,
		language,
		imports: input.includeImports ? imports : undefined,
		symbols,
	};
}

function collectTopLevelSymbol(
	sourceFile: ts.SourceFile,
	statement: ts.Statement,
	symbols: SourceSymbolSummary[],
): void {
	if (ts.isFunctionDeclaration(statement) && statement.name) {
		symbols.push(
			readSymbol(sourceFile, statement, statement.name.text, "function"),
		);
		return;
	}
	if (ts.isFunctionDeclaration(statement)) {
		symbols.push(readSymbol(sourceFile, statement, "default", "function"));
		return;
	}
	if (ts.isClassDeclaration(statement) && statement.name) {
		symbols.push(
			readSymbol(sourceFile, statement, statement.name.text, "class"),
		);
		statement.members.forEach((member) => {
			if (ts.isMethodDeclaration(member) && member.name) {
				symbols.push(
					readSymbol(
						sourceFile,
						member,
						member.name.getText(sourceFile),
						"method",
					),
				);
			}
		});
		return;
	}
	if (ts.isClassDeclaration(statement)) {
		symbols.push(readSymbol(sourceFile, statement, "default", "class"));
		return;
	}
	if (ts.isInterfaceDeclaration(statement)) {
		symbols.push(
			readSymbol(sourceFile, statement, statement.name.text, "interface"),
		);
		return;
	}
	if (ts.isTypeAliasDeclaration(statement)) {
		symbols.push(
			readSymbol(sourceFile, statement, statement.name.text, "type"),
		);
		return;
	}
	if (ts.isEnumDeclaration(statement)) {
		symbols.push(
			readSymbol(sourceFile, statement, statement.name.text, "enum"),
		);
		return;
	}
	if (ts.isVariableStatement(statement)) {
		statement.declarationList.declarations.forEach((declaration) => {
			const kind =
				declaration.initializer &&
				isFunctionLikeInitializer(declaration.initializer)
					? "function"
					: "variable";
			symbols.push(
				readSymbol(
					sourceFile,
					statement,
					declaration.name.getText(sourceFile),
					kind,
				),
			);
		});
	}
}

function isFunctionLikeInitializer(node: ts.Expression): boolean {
	return ts.isArrowFunction(node) || ts.isFunctionExpression(node);
}

function readImport(
	sourceFile: ts.SourceFile,
	node: ts.ImportDeclaration,
): SourceImportSummary {
	const module = node.moduleSpecifier
		.getText(sourceFile)
		.replace(/^['"]|['"]$/g, "");
	const names: string[] = [];
	const clause = node.importClause;
	if (clause?.name) names.push(clause.name.text);
	if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
		names.push(
			...clause.namedBindings.elements.map((element) => element.name.text),
		);
	}
	if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
		names.push(`* as ${clause.namedBindings.name.text}`);
	}
	return {
		module,
		line: lineOf(sourceFile, node.getStart(sourceFile)),
		names,
	};
}

function readSymbol(
	sourceFile: ts.SourceFile,
	node: ts.Node,
	name: string,
	kind: string,
): SourceSymbolSummary {
	const startLine = lineOf(sourceFile, node.getStart(sourceFile));
	const endLine = lineOf(sourceFile, node.getEnd());
	return {
		name,
		kind,
		exported: hasExportModifier(node),
		startLine,
		endLine,
		signature: signatureFor(sourceFile, node),
	};
}

function signatureFor(sourceFile: ts.SourceFile, node: ts.Node): string {
	const text = node.getText(sourceFile);
	const bodyIndex = text.indexOf("{");
	const firstLine = text.split(/\r?\n/, 1)[0].trim();
	if (bodyIndex > -1)
		return text.slice(0, bodyIndex).replace(/\s+/g, " ").trim();
	return firstLine.replace(/\s+/g, " ");
}

function hasExportModifier(node: ts.Node): boolean {
	return Boolean(
		ts.canHaveModifiers(node) &&
			ts
				.getModifiers(node)
				?.some(
					(modifier) =>
						modifier.kind === ts.SyntaxKind.ExportKeyword ||
						modifier.kind === ts.SyntaxKind.DefaultKeyword,
				),
	);
}

function lineOf(sourceFile: ts.SourceFile, position: number): number {
	return sourceFile.getLineAndCharacterOfPosition(position).line + 1;
}

function getScriptKind(filePath: string): ts.ScriptKind {
	const ext = path.extname(filePath);
	if (ext === ".tsx") return ts.ScriptKind.TSX;
	if (ext === ".jsx") return ts.ScriptKind.JSX;
	if (ext === ".js") return ts.ScriptKind.JS;
	return ts.ScriptKind.TS;
}
