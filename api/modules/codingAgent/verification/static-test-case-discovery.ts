import type { TestFileClassification } from "./test-file-discovery";

export function extractStaticTestNames(input: {
	source: string;
	classification: TestFileClassification;
}): string[] {
	const source = maskComments(input.source, input.classification.technology);
	const names =
		input.classification.technology === "javascript-typescript"
			? extractJavaScriptTestNames(source)
			: input.classification.technology === "python"
				? collectActiveMatches(
						source,
						/^\s*(?:async\s+)?def\s+(test_[\w]+)/gm,
						/@(?:pytest\.mark\.(?:skip|skipif)|unittest\.skip|skip)\b/,
					)
				: input.classification.technology === "rust"
					? collectActiveMatches(
							source,
							/#\s*\[\s*(?:tokio::)?test[^\]]*\]\s*(?:async\s+)?fn\s+([\w]+)/gm,
							/#\s*\[\s*ignore\b/,
						)
					: input.classification.technology === "go"
						? collectMatches(source, /^\s*func\s+(Test[\w]+)\s*\(/gm)
						: input.classification.technology === "jvm"
							? collectActiveMatches(
									source,
									/@(?:Test|ParameterizedTest|RepeatedTest|TestFactory|TestTemplate)\b[\s\S]{0,500}?\b(?:fun|void)\s+([\w` -]+)\s*\(/g,
									/@(?:Disabled|Ignore)\b/,
								)
							: input.classification.technology === "dotnet"
								? collectActiveMatches(
										source,
										/\[(?:Fact|Theory|Test|TestMethod)\b[^\]]*\][\s\S]{0,500}?\b(?:async\s+)?(?:ValueTask|Task|void)(?:<[^>]+>)?\s+([\w]+)\s*\(/g,
										/(?:\bSkip\s*=|\[(?:Ignore|Explicit)\b)/i,
									)
								: input.classification.technology === "ruby"
									? collectQuotedMatches(
											source,
											/\bit\s*(?:\(\s*)?(["'])(.*?)\1/g,
										)
									: input.classification.technology === "php"
										? collectMatches(source, /\bfunction\s+(test[\w]+)\s*\(/gi)
										: [];
	return names
		.map((name) => name.trim())
		.filter(Boolean)
		.sort();
}

function extractJavaScriptTestNames(source: string): string[] {
	const names: string[] = [];
	for (let index = 0; index < source.length; index += 1) {
		const current = source[index] ?? "";
		if (current === "'" || current === '"' || current === "`") {
			index = skipQuotedValue(source, index, current);
			continue;
		}
		const previous = source[index - 1] ?? "";
		if (previous === "." || isIdentifierPart(previous)) continue;
		const call = source
			.slice(index)
			.match(/^(?:it|test)(?:\.(?:skip|only|todo|concurrent|fails))*\s*\(\s*/);
		if (!call) continue;
		if (/\.(?:skip|todo)\b/.test(call[0])) continue;
		const argumentStart = index + call[0].length;
		const quote = source[argumentStart];
		if (quote !== "'" && quote !== '"' && quote !== "`") continue;
		const argumentEnd = skipQuotedValue(source, argumentStart, quote);
		names.push(
			unescapeStaticString(source.slice(argumentStart + 1, argumentEnd)),
		);
		index = argumentEnd;
	}
	return names;
}

function collectMatches(source: string, pattern: RegExp): string[] {
	return Array.from(source.matchAll(pattern), (match) => match[1] ?? "");
}

function collectActiveMatches(
	source: string,
	pattern: RegExp,
	excludedMarker: RegExp,
) {
	return Array.from(source.matchAll(pattern))
		.filter((match) => {
			const matchIndex = match.index ?? 0;
			const declarationBlock = `${adjacentMetadataPrefix(
				source,
				matchIndex,
			)}${match[0]}`;
			return !excludedMarker.test(declarationBlock);
		})
		.map((match) => match[1] ?? "");
}

function adjacentMetadataPrefix(source: string, declarationIndex: number) {
	const lines = source.slice(0, declarationIndex).split("\n");
	const metadata: string[] = [];
	let skippedTrailingEmptyLine = false;
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		const line = lines[index]?.trim() ?? "";
		if (!line && !skippedTrailingEmptyLine) {
			skippedTrailingEmptyLine = true;
			continue;
		}
		if (!line || !/^(?:@|#\s*\[|\[)/.test(line)) break;
		metadata.unshift(line);
	}
	return metadata.length ? `${metadata.join("\n")}\n` : "";
}

function collectQuotedMatches(source: string, pattern: RegExp): string[] {
	return Array.from(source.matchAll(pattern), (match) => match[2] ?? "");
}

function unescapeStaticString(value: string) {
	return value
		.replaceAll("\\`", "`")
		.replaceAll('\\"', '"')
		.replaceAll("\\'", "'")
		.replaceAll("\\n", " ")
		.replace(/\$\{[^}]*\}/g, "$" + "{…}");
}

function skipQuotedValue(
	source: string,
	start: number,
	quote: "'" | '"' | "`",
) {
	let escaped = false;
	for (let index = start + 1; index < source.length; index += 1) {
		const current = source[index] ?? "";
		if (escaped) {
			escaped = false;
		} else if (current === "\\") {
			escaped = true;
		} else if (current === quote) {
			return index;
		}
	}
	return source.length - 1;
}

function isIdentifierPart(value: string) {
	return /[\p{L}\p{N}_$]/u.test(value);
}

function maskComments(
	source: string,
	technology: TestFileClassification["technology"],
) {
	const input =
		technology === "python" ? maskPythonTripleQuotedStrings(source) : source;
	const hashComments =
		technology === "python" || technology === "ruby" || technology === "php";
	const slashComments = technology !== "python" && technology !== "ruby";
	let result = "";
	let quote: "'" | '"' | "`" | null = null;
	let escaped = false;
	let lineComment = false;
	let blockComment = false;

	for (let index = 0; index < input.length; index += 1) {
		const current = input[index] ?? "";
		const next = input[index + 1] ?? "";
		if (lineComment) {
			if (current === "\n") {
				lineComment = false;
				result += current;
			} else {
				result += " ";
			}
			continue;
		}
		if (blockComment) {
			if (current === "*" && next === "/") {
				result += "  ";
				index += 1;
				blockComment = false;
			} else {
				result += current === "\n" ? "\n" : " ";
			}
			continue;
		}
		if (quote) {
			result += current;
			if (escaped) {
				escaped = false;
			} else if (current === "\\") {
				escaped = true;
			} else if (current === quote) {
				quote = null;
			}
			continue;
		}
		if (current === "'" || current === '"' || current === "`") {
			quote = current;
			result += current;
			continue;
		}
		if (slashComments && current === "/" && next === "/") {
			result += "  ";
			index += 1;
			lineComment = true;
			continue;
		}
		if (slashComments && current === "/" && next === "*") {
			result += "  ";
			index += 1;
			blockComment = true;
			continue;
		}
		if (hashComments && current === "#") {
			result += " ";
			lineComment = true;
			continue;
		}
		result += current;
	}
	if (technology === "javascript-typescript" || technology === "ruby")
		return result;
	return maskQuotedStrings(
		result,
		technology === "go" || technology === "rust",
	);
}

function maskPythonTripleQuotedStrings(source: string) {
	let result = "";
	let delimiter: "'''" | '"""' | null = null;
	for (let index = 0; index < source.length; index += 1) {
		const triple = source.slice(index, index + 3);
		if (!delimiter && (triple === "'''" || triple === '"""')) {
			delimiter = triple;
			result += "   ";
			index += 2;
			continue;
		}
		if (delimiter && triple === delimiter) {
			delimiter = null;
			result += "   ";
			index += 2;
			continue;
		}
		const current = source[index] ?? "";
		result += delimiter && current !== "\n" ? " " : current;
	}
	return result;
}

function maskQuotedStrings(source: string, includeBackticks: boolean) {
	let result = "";
	for (let index = 0; index < source.length; index += 1) {
		const current = source[index] ?? "";
		const isQuote =
			current === "'" ||
			current === '"' ||
			(includeBackticks && current === "`");
		if (!isQuote) {
			result += current;
			continue;
		}
		const end = skipQuotedValue(source, index, current as "'" | '"' | "`");
		const value = source.slice(index, end + 1);
		result += value.replace(/[^\n]/g, " ");
		index = end;
	}
	return result;
}
