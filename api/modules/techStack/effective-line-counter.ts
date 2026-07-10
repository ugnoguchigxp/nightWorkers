import fs from "node:fs/promises";
import path from "node:path";

const SUPPORTED_EXTENSIONS = new Set([
	".ts",
	".tsx",
	".js",
	".jsx",
	".mjs",
	".cjs",
	".mts",
	".cts",
	".py",
	".rs",
	".go",
	".java",
	".kt",
	".kts",
	".swift",
	".php",
	".rb",
	".cs",
	".c",
	".cc",
	".cpp",
	".h",
	".hh",
	".hpp",
	".css",
	".scss",
	".sass",
	".less",
	".html",
	".htm",
	".vue",
	".svelte",
	".astro",
	".sql",
	".prisma",
	".graphql",
	".gql",
	".proto",
	".tf",
	".hcl",
	".sh",
	".bash",
	".zsh",
	".fish",
	".ps1",
]);

const SUPPORTED_BASENAMES = new Set([
	"Dockerfile",
	"Makefile",
	"Rakefile",
	"Procfile",
]);

type CommentSyntax = {
	line: string[];
	blocks: Array<[string, string]>;
};

function syntaxFor(filePath: string): CommentSyntax {
	if (SUPPORTED_BASENAMES.has(path.basename(filePath))) {
		return { line: ["#"], blocks: [] };
	}
	const extension = path.extname(filePath).toLowerCase();
	if (
		[".py", ".rb", ".sh", ".bash", ".zsh", ".fish", ".ps1"].includes(extension)
	) {
		return {
			line: ["#"],
			blocks: extension === ".ps1" ? [["<#", "#>"]] : [],
		};
	}
	if ([".tf", ".hcl"].includes(extension)) {
		return { line: ["#", "//"], blocks: [["/*", "*/"]] };
	}
	if (extension === ".sql") {
		return { line: ["--"], blocks: [["/*", "*/"]] };
	}
	if ([".html", ".htm"].includes(extension)) {
		return { line: [], blocks: [["<!--", "-->"]] };
	}
	if ([".vue", ".svelte", ".astro"].includes(extension)) {
		return {
			line: ["//"],
			blocks: [
				["<!--", "-->"],
				["/*", "*/"],
			],
		};
	}
	if ([".css", ".scss", ".sass", ".less"].includes(extension)) {
		return {
			line: extension === ".css" ? [] : ["//"],
			blocks: [["/*", "*/"]],
		};
	}
	return { line: ["//"], blocks: [["/*", "*/"]] };
}

export function isSupportedSourcePath(filePath: string) {
	return (
		SUPPORTED_BASENAMES.has(path.basename(filePath)) ||
		SUPPORTED_EXTENSIONS.has(path.extname(filePath).toLowerCase())
	);
}

function lineHasCode(
	line: string,
	syntax: CommentSyntax,
	state: {
		blockEnd: string | null;
		quote: "'" | '"' | "`" | null;
		quoteEscaped: boolean;
	},
) {
	let index = 0;
	let hasCode = false;

	while (index < line.length) {
		if (state.blockEnd) {
			const endIndex = line.indexOf(state.blockEnd, index);
			if (endIndex < 0) return hasCode;
			index = endIndex + state.blockEnd.length;
			state.blockEnd = null;
			continue;
		}

		const char = line[index];
		if (state.quote) {
			hasCode = true;
			if (state.quoteEscaped) state.quoteEscaped = false;
			else if (char === "\\") state.quoteEscaped = true;
			else if (char === state.quote) state.quote = null;
			index += 1;
			continue;
		}

		if (char === "'" || char === '"' || char === "`") {
			state.quote = char;
			hasCode = true;
			index += 1;
			continue;
		}

		const lineComment = syntax.line.find((marker) =>
			line.startsWith(marker, index),
		);
		if (lineComment) return hasCode;

		const block = syntax.blocks.find(([start]) =>
			line.startsWith(start, index),
		);
		if (block) {
			state.blockEnd = block[1];
			index += block[0].length;
			continue;
		}

		if (!/\s/.test(char)) hasCode = true;
		index += 1;
	}
	if (state.quote !== "`" && !state.quoteEscaped) state.quote = null;
	state.quoteEscaped = false;
	return hasCode;
}

export function countEffectiveLinesInText(filePath: string, input: string) {
	const text = input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
	if (text.length === 0) return 0;
	const syntax = syntaxFor(filePath);
	const state = {
		blockEnd: null as string | null,
		quote: null as "'" | '"' | "`" | null,
		quoteEscaped: false,
	};
	let count = 0;
	for (const line of text.split("\n")) {
		if (lineHasCode(line, syntax, state)) count += 1;
	}
	return count;
}

export async function countEffectiveLines(
	fullPath: string,
	relativePath: string,
) {
	return countEffectiveLinesInText(
		relativePath,
		await fs.readFile(fullPath, "utf8"),
	);
}
