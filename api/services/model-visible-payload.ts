import crypto from "node:crypto";

export const DEFAULT_MODEL_VISIBLE_TEXT_LIMIT_CHARS = 20_000;
export const DEFAULT_MODEL_VISIBLE_PROVIDER_EVENT_LIMIT_CHARS = 40_000;

export type ModelVisibleCompressionStrategy =
	| "none"
	| "text_head_tail"
	| "json_summary"
	| "command_output"
	| "provider_event_redacted_summary";

export type ModelVisiblePayloadSummary = {
	truncated: boolean;
	strategy: ModelVisibleCompressionStrategy;
	originalChars: number;
	returnedChars: number;
	omittedReason?: string;
	contentHash?: string;
	artifactRef?: string;
	providerEventRef?: string;
};

export type ModelVisibleTextResult = {
	content: string;
	summary: ModelVisiblePayloadSummary;
};

const IMPORTANT_LINE_RE =
	/(error|fatal|exception|failed|failure|panic|traceback|assertion|assertionerror|expected|received|diff|timeout|timed out|cannot|not found|must)/i;

function hashContent(content: string): string {
	return `sha256:${crypto.createHash("sha256").update(content).digest("hex")}`;
}

function uniqueLines(lines: string[]): string[] {
	const seen = new Set<string>();
	return lines.filter((line) => {
		const key = line.trim();
		if (!key || seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function selectWindow(
	lines: string[],
	index: number,
	radius: number,
): string[] {
	const start = Math.max(0, index - radius);
	const end = Math.min(lines.length, index + radius + 1);
	return lines.slice(start, end);
}

function buildSection(title: string, lines: string[]): string {
	if (lines.length === 0) return "";
	return [`## ${title}`, ...lines].join("\n");
}

function excerptLongLineAroundMatch(line: string): string {
	if (line.length <= 600) return line;
	const match = IMPORTANT_LINE_RE.exec(line);
	if (!match) {
		return `${line.slice(0, 280)} ... ${line.slice(-280)}`;
	}
	const start = Math.max(0, match.index - 280);
	const end = Math.min(line.length, match.index + 320);
	return `${start > 0 ? "... " : ""}${line.slice(start, end)}${end < line.length ? " ..." : ""}`;
}

function buildCompactText(input: {
	content: string;
	limitChars: number;
	strategy: Exclude<ModelVisibleCompressionStrategy, "none">;
	omittedReason: string;
	artifactRef?: string;
	providerEventRef?: string;
	contentHash: string;
}): string {
	const lines = input.content.split(/\r?\n/);
	const important: string[] = [];
	for (let index = 0; index < lines.length; index += 1) {
		if (IMPORTANT_LINE_RE.test(lines[index])) {
			important.push(
				...selectWindow(lines, index, 2).map(excerptLongLineAroundMatch),
			);
		}
	}

	const marker = [
		"[model-visible-payload-compressed]",
		`strategy: ${input.strategy}`,
		`omittedReason: ${input.omittedReason}`,
		`originalChars: ${input.content.length}`,
		`contentHash: ${input.contentHash}`,
		input.artifactRef ? `artifactRef: ${input.artifactRef}` : "",
		input.providerEventRef ? `providerEventRef: ${input.providerEventRef}` : "",
	]
		.filter(Boolean)
		.join("\n");
	const sections = [
		buildSection("important lines", uniqueLines(important).slice(0, 120)),
		buildSection("head", lines.slice(0, 40)),
		buildSection("tail", lines.slice(-80)),
	]
		.filter(Boolean)
		.join("\n\n");

	return `${marker}\n\n${sections}`.slice(0, input.limitChars);
}

export function compactModelVisibleText(input: {
	content: string;
	limitChars?: number;
	strategy?: Exclude<ModelVisibleCompressionStrategy, "none">;
	omittedReason: string;
	artifactRef?: string;
	providerEventRef?: string;
}): ModelVisibleTextResult {
	const limitChars = input.limitChars ?? DEFAULT_MODEL_VISIBLE_TEXT_LIMIT_CHARS;
	const contentHash = hashContent(input.content);
	if (input.content.length <= limitChars) {
		return {
			content: input.content,
			summary: {
				truncated: false,
				strategy: "none",
				originalChars: input.content.length,
				returnedChars: input.content.length,
				omittedReason: input.omittedReason,
				contentHash,
				artifactRef: input.artifactRef,
				providerEventRef: input.providerEventRef,
			},
		};
	}

	const strategy = input.strategy ?? "text_head_tail";
	const content = buildCompactText({
		content: input.content,
		limitChars,
		strategy,
		omittedReason: input.omittedReason,
		artifactRef: input.artifactRef,
		providerEventRef: input.providerEventRef,
		contentHash,
	});

	return {
		content,
		summary: {
			truncated: true,
			strategy,
			originalChars: input.content.length,
			returnedChars: content.length,
			omittedReason: input.omittedReason,
			contentHash,
			artifactRef: input.artifactRef,
			providerEventRef: input.providerEventRef,
		},
	};
}

export function summarizeModelVisibleJson(input: {
	value: unknown;
	limitChars?: number;
	omittedReason: string;
	providerEventRef?: string;
}): ModelVisibleTextResult {
	const serialized = JSON.stringify(input.value, null, 2);
	return compactModelVisibleText({
		content: serialized,
		limitChars:
			input.limitChars ?? DEFAULT_MODEL_VISIBLE_PROVIDER_EVENT_LIMIT_CHARS,
		strategy: "json_summary",
		omittedReason: input.omittedReason,
		providerEventRef: input.providerEventRef,
	});
}
