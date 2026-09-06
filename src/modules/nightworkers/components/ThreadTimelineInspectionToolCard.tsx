import { asNumber, asString } from "./ThreadTimelineDiffModel";
import {
	asRecord,
	getToolActivityModel,
	type ToolActivityLifecycle,
} from "./ThreadTimelineEventModel";
import { NightWorkersCodeBlock } from "./ThreadTimelineMarkdown";

export type InspectionToolName =
	| "read_file"
	| "list_dir"
	| "find_file"
	| "search_files"
	| "inspect_structure"
	| "git_status"
	| "git_diff"
	| "read_current_specification";

type ToolLifecycle = "started" | "result" | "other";
type ToolStatus = "started" | "ok" | "failed";

export type InspectionToolCardModel = {
	lifecycle: ToolLifecycle;
	status: ToolStatus;
	toolName: InspectionToolName;
	title: string;
	target?: string;
	query?: string;
	options: Array<{ label: string; value: string }>;
	metrics: Array<{ label: string; value: string }>;
	badges: string[];
	errorCode?: string;
	errorMessage?: string;
	preview?: string;
};

type InspectionToolCardEvent = {
	kind?: string;
	eventType?: string | null;
	payloadJson?: unknown;
	seq?: number;
	source?: string;
	status?: string | null;
};

const INSPECTION_TOOL_NAMES = new Set<InspectionToolName>([
	"read_file",
	"list_dir",
	"find_file",
	"search_files",
	"inspect_structure",
	"git_status",
	"git_diff",
	"read_current_specification",
]);

export function hasInspectionToolCard(event: InspectionToolCardEvent): boolean {
	return getInspectionToolCardModel(event) !== null;
}

export function getInspectionToolCardModel(
	event: InspectionToolCardEvent,
): InspectionToolCardModel | null {
	const activity = getToolActivityModel(event);
	const toolName = getInspectionToolName(activity?.toolName ?? null);
	if (!toolName) return null;

	const lifecycle = getToolLifecycle(activity?.lifecycle);
	if (lifecycle === "other") return null;

	const args = activity?.arguments ?? {};
	const result = activity?.rawResult ?? {};
	const resultPayload = activity?.resultPayload ?? {};
	const error = activity?.error ?? {};
	const status = getStatus(lifecycle, activity?.status, event);
	const base = {
		lifecycle,
		status,
		toolName,
		title: toolTitle(toolName),
		options: [] as Array<{ label: string; value: string }>,
		metrics: [] as Array<{ label: string; value: string }>,
		badges: [] as string[],
		errorCode: asString(error.code) || undefined,
		errorMessage: asString(error.message) || undefined,
	};

	const card = buildToolCard(base, toolName, args, result, resultPayload);
	if (!card.target && !card.query && card.metrics.length === 0 && !card.preview)
		return null;
	return card;
}

export function InspectionToolCard({
	event,
}: {
	event: InspectionToolCardEvent;
}) {
	const card = getInspectionToolCardModel(event);
	if (!card) return null;

	return (
		<details className="nightworkers-chat-card rounded border" open>
			<summary className="nightworkers-chat-card-header cursor-pointer list-none px-3 py-2 text-xs">
				<span className="nightworkers-chat-card-badge mr-2 rounded border px-1.5 py-0.5">
					{card.title}
				</span>
				<span className="nightworkers-chat-card-meta">{card.toolName}</span>
				<span className="nightworkers-chat-card-meta ml-2">
					{statusLabel(card)}
				</span>
				{typeof event.seq === "number" ? (
					<span className="nightworkers-chat-card-subtle ml-2">
						#{event.seq}
					</span>
				) : null}
			</summary>
			<InspectionToolCardBody card={card} debug />
		</details>
	);
}

export function NormalInspectionToolCard({
	event,
}: {
	event: InspectionToolCardEvent;
}) {
	const card = getInspectionToolCardModel(event);
	if (!card) return null;

	return (
		<details className="nightworkers-chat-card overflow-hidden rounded-[var(--radius-md)] border text-sm">
			<summary className="nightworkers-chat-card-header cursor-pointer list-none px-4 py-3">
				<div className="flex items-baseline justify-between gap-4">
					<span className="nightworkers-chat-card-title min-w-0 truncate">
						{card.target || card.query || card.title}
					</span>
					<span className="nightworkers-chat-card-meta shrink-0 whitespace-nowrap text-right">
						{card.toolName}
					</span>
				</div>
				<div className="nightworkers-chat-card-meta mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
					<span>{statusLabel(card)}</span>
					{card.metrics.map((metric) => (
						<span key={`${metric.label}:${metric.value}`}>
							{metric.label}: {metric.value}
						</span>
					))}
					{card.badges.map((badge) => (
						<span key={badge}>{badge}</span>
					))}
				</div>
			</summary>
			<InspectionToolCardBody card={card} />
		</details>
	);
}

function InspectionToolCardBody({
	card,
	debug = false,
}: {
	card: InspectionToolCardModel;
	debug?: boolean;
}) {
	const detailLines = [
		card.target ? `target: ${card.target}` : "",
		card.query ? `query: ${card.query}` : "",
		...card.options.map((option) => `${option.label}: ${option.value}`),
		...card.metrics.map((metric) => `${metric.label}: ${metric.value}`),
		card.badges.length > 0 ? `flags: ${card.badges.join(", ")}` : "",
		card.errorCode
			? `error: ${card.errorCode}${card.errorMessage ? `: ${card.errorMessage}` : ""}`
			: "",
	].filter(Boolean);
	const code = [detailLines.join("\n"), card.preview]
		.filter(Boolean)
		.join("\n\n");
	if (!code) return null;
	return (
		<div className="nightworkers-chat-card-body border-t">
			<NightWorkersCodeBlock
				code={code}
				filename={`${card.toolName}.txt`}
				language="text"
				maxHeight={debug ? 280 : 180}
				syntaxHighlighting={false}
			/>
		</div>
	);
}

function buildToolCard(
	base: Omit<InspectionToolCardModel, "target" | "query" | "preview">,
	toolName: InspectionToolName,
	args: Record<string, unknown>,
	result: Record<string, unknown>,
	resultPayload: Record<string, unknown>,
): InspectionToolCardModel {
	switch (toolName) {
		case "read_file":
			return buildReadFileCard(base, args, resultPayload);
		case "list_dir":
			return buildListDirCard(base, args, resultPayload);
		case "find_file":
			return buildFindFileCard(base, args, resultPayload);
		case "search_files":
			return buildSearchFilesCard(base, args, resultPayload);
		case "inspect_structure":
			return buildInspectStructureCard(base, args, resultPayload);
		case "git_status":
			return buildGitStatusCard(base, resultPayload);
		case "git_diff":
			return buildGitDiffCard(base, resultPayload);
		case "read_current_specification":
			return buildReadCurrentSpecificationCard(base, args, resultPayload);
		default:
			return {
				...base,
				preview: asString(result.summary),
			};
	}
}

function buildReadFileCard(
	base: Omit<InspectionToolCardModel, "target" | "query" | "preview">,
	args: Record<string, unknown>,
	resultPayload: Record<string, unknown>,
): InspectionToolCardModel {
	const startLine = asNumber(resultPayload.startLine);
	const endLine = asNumber(resultPayload.endLine);
	const totalLines = asNumber(resultPayload.totalLines);
	const linesReturned = asNumber(resultPayload.linesReturned);
	const compression = asRecord(resultPayload.compression);
	const badges = [...base.badges];
	if (asBoolean(args.fresh)) badges.push("fresh");
	if (asBoolean(resultPayload.cached)) badges.push("cached");
	if (asBoolean(resultPayload.truncated)) badges.push("truncated");
	const compressionStrategy = asString(compression.strategy);
	if (compressionStrategy) badges.push(compressionStrategy);

	return {
		...base,
		target: asString(args.filePath),
		options: compactOptions([
			["requested", formatRequestedRange(args)],
			["compression", asString(args.compressionMode)],
		]),
		metrics: compactOptions([
			["lines", formatActualRange(startLine, endLine, totalLines)],
			["returned", linesReturned === undefined ? "" : String(linesReturned)],
		]),
		badges,
	};
}

function buildListDirCard(
	base: Omit<InspectionToolCardModel, "target" | "query" | "preview">,
	args: Record<string, unknown>,
	resultPayload: Record<string, unknown>,
): InspectionToolCardModel {
	const dirs = asArray(resultPayload.dirs);
	const files = asArray(resultPayload.files);
	const badges = [...base.badges];
	if (asBoolean(resultPayload.truncated)) badges.push("truncated");
	return {
		...base,
		target: asString(args.relativePath) || ".",
		options: compactOptions([
			["recursive", formatBoolean(args.recursive)],
			["skipIgnored", formatBoolean(args.skipIgnored)],
			["maxEntries", formatNumber(args.maxEntries)],
		]),
		metrics: compactOptions([
			[
				"dirs",
				dirs.length
					? String(dirs.length)
					: metricFromPayload(resultPayload, "dirs"),
			],
			[
				"files",
				files.length
					? String(files.length)
					: metricFromPayload(resultPayload, "files"),
			],
		]),
		badges,
		preview: previewLines([...dirs, ...files], 8),
	};
}

function buildFindFileCard(
	base: Omit<InspectionToolCardModel, "target" | "query" | "preview">,
	args: Record<string, unknown>,
	resultPayload: Record<string, unknown>,
): InspectionToolCardModel {
	const files = asArray(resultPayload.files);
	return {
		...base,
		target: asString(args.relativePath) || ".",
		query: asString(args.fileMask),
		options: compactOptions([
			["recursive", formatBoolean(args.recursive)],
			["maxResults", formatNumber(args.maxResults)],
		]),
		metrics: compactOptions([
			["matches", formatNumber(resultPayload.count) || String(files.length)],
		]),
		preview: previewLines(files, 8),
	};
}

function buildSearchFilesCard(
	base: Omit<InspectionToolCardModel, "target" | "query" | "preview">,
	args: Record<string, unknown>,
	resultPayload: Record<string, unknown>,
): InspectionToolCardModel {
	const matches = asArray(resultPayload.matches);
	return {
		...base,
		query: asString(args.query),
		options: compactOptions([
			["glob", asString(args.glob)],
			["maxResults", formatNumber(args.maxResults)],
			["caseSensitive", formatBoolean(args.caseSensitive)],
			["engine", asString(resultPayload.engine)],
		]),
		metrics: compactOptions([
			["matches", formatNumber(resultPayload.count) || String(matches.length)],
		]),
		preview: previewSearchMatches(matches, 6),
	};
}

function buildInspectStructureCard(
	base: Omit<InspectionToolCardModel, "target" | "query" | "preview">,
	args: Record<string, unknown>,
	resultPayload: Record<string, unknown>,
): InspectionToolCardModel {
	const kind = asString(resultPayload.kind);
	const symbols = asArray(resultPayload.symbols);
	const paths = asArray(resultPayload.paths);
	const badges = [...base.badges];
	if (asBoolean(resultPayload.truncated)) badges.push("truncated");
	return {
		...base,
		target: asString(args.filePath) || asString(resultPayload.filePath),
		options: compactOptions([
			["kind", kind],
			["includeImports", formatBoolean(args.includeImports)],
			["previewPrimitives", formatBoolean(args.previewPrimitives)],
			["maxPaths", formatNumber(args.maxPaths)],
		]),
		metrics: compactOptions([
			["symbols", symbols.length ? String(symbols.length) : ""],
			["paths", paths.length ? String(paths.length) : ""],
		]),
		badges,
		preview: previewStructure(resultPayload),
	};
}

function buildGitStatusCard(
	base: Omit<InspectionToolCardModel, "target" | "query" | "preview">,
	resultPayload: Record<string, unknown>,
): InspectionToolCardModel {
	return {
		...base,
		target: asString(resultPayload.branch) || "repository",
		metrics: compactOptions([
			["modified", formatNumber(resultPayload.modifiedCount)],
			["untracked", formatNumber(resultPayload.untrackedCount)],
		]),
		badges: asBoolean(resultPayload.isDirty)
			? [...base.badges, "dirty"]
			: [...base.badges, "clean"],
		preview: asString(resultPayload.shortStatus),
	};
}

function buildGitDiffCard(
	base: Omit<InspectionToolCardModel, "target" | "query" | "preview">,
	resultPayload: Record<string, unknown>,
): InspectionToolCardModel {
	return {
		...base,
		target: "repository",
		badges: asBoolean(resultPayload.hasChanges)
			? [...base.badges, "has changes"]
			: [...base.badges, "clean"],
		preview: asString(resultPayload.diffStat),
	};
}

function buildReadCurrentSpecificationCard(
	base: Omit<InspectionToolCardModel, "target" | "query" | "preview">,
	args: Record<string, unknown>,
	resultPayload: Record<string, unknown>,
): InspectionToolCardModel {
	const found = asBoolean(resultPayload.found);
	const digest = asString(resultPayload.digest);
	return {
		...base,
		target: asString(resultPayload.taskId) || asString(args.taskId),
		metrics: compactOptions([
			["found", found ? "yes" : resultPayload.found === false ? "no" : ""],
			["title", asString(resultPayload.title)],
			["digest", digest ? digest.slice(0, 19) : ""],
		]),
	};
}

function getInspectionToolName(
	value: string | null,
): InspectionToolName | null {
	return value && INSPECTION_TOOL_NAMES.has(value as InspectionToolName)
		? (value as InspectionToolName)
		: null;
}

function getToolLifecycle(
	lifecycle: ToolActivityLifecycle | undefined,
): ToolLifecycle {
	if (lifecycle === "result" || lifecycle === "failed") return "result";
	if (lifecycle === "started") return "started";
	return "other";
}

function getStatus(
	lifecycle: ToolLifecycle,
	activityStatus: "started" | "running" | "ok" | "failed" | undefined,
	event: InspectionToolCardEvent,
): ToolStatus {
	if (lifecycle === "started") return "started";
	if (
		activityStatus === "failed" ||
		event.status === "failed" ||
		event.eventType === "tool_failed"
	) {
		return "failed";
	}
	return "ok";
}

function statusLabel(card: InspectionToolCardModel): string {
	if (card.status === "started") return "Started";
	if (card.status === "failed") return "Failed";
	if (card.toolName === "read_file") {
		if (card.badges.includes("cached")) return "Cached";
		if (card.badges.some((badge) => badge.includes("summary")))
			return "Compressed";
		return "Read";
	}
	return "Completed";
}

function toolTitle(toolName: InspectionToolName): string {
	switch (toolName) {
		case "read_file":
			return "Read file";
		case "list_dir":
			return "List directory";
		case "find_file":
			return "Find file";
		case "search_files":
			return "Search files";
		case "inspect_structure":
			return "Inspect structure";
		case "git_status":
			return "Git status";
		case "git_diff":
			return "Git diff";
		case "read_current_specification":
			return "Read specification";
	}
}

function compactOptions(
	items: Array<[string, string]>,
): Array<{ label: string; value: string }> {
	return items
		.filter(([, value]) => value.trim().length > 0)
		.map(([label, value]) => ({ label, value }));
}

function formatRequestedRange(args: Record<string, unknown>): string {
	const startLine = asNumber(args.startLine);
	const endLine = asNumber(args.endLine);
	if (startLine === undefined && endLine === undefined) return "";
	return `${startLine ?? "?"}-${endLine ?? "?"}`;
}

function formatActualRange(
	startLine: number | undefined,
	endLine: number | undefined,
	totalLines: number | undefined,
): string {
	if (
		startLine === undefined &&
		endLine === undefined &&
		totalLines === undefined
	)
		return "";
	const range =
		startLine === undefined && endLine === undefined
			? ""
			: `${startLine ?? "?"}-${endLine ?? "?"}`;
	return [range, totalLines === undefined ? "" : `total ${totalLines}`]
		.filter(Boolean)
		.join(" / ");
}

function formatBoolean(value: unknown): string {
	return typeof value === "boolean" ? String(value) : "";
}

function formatNumber(value: unknown): string {
	const number = asNumber(value);
	return number === undefined ? "" : String(number);
}

function metricFromPayload(
	resultPayload: Record<string, unknown>,
	key: string,
): string {
	const value = resultPayload[key];
	return Array.isArray(value) ? String(value.length) : "";
}

function asBoolean(value: unknown): boolean {
	return value === true;
}

function asArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function previewLines(values: unknown[], limit: number): string {
	return values
		.slice(0, limit)
		.map((value) => String(value))
		.join("\n");
}

function previewSearchMatches(values: unknown[], limit: number): string {
	return values
		.slice(0, limit)
		.map((value) => {
			const match = asRecord(value);
			const filePath = asString(match.filePath);
			const lineNumber = asNumber(match.lineNumber);
			const excerpt = asString(match.excerpt);
			return [
				filePath,
				lineNumber === undefined ? "" : String(lineNumber),
				excerpt,
			]
				.filter(Boolean)
				.join(":");
		})
		.filter(Boolean)
		.join("\n");
}

function previewStructure(resultPayload: Record<string, unknown>): string {
	const symbols = asArray(resultPayload.symbols)
		.slice(0, 6)
		.map((value) => {
			const symbol = asRecord(value);
			return [asString(symbol.kind), asString(symbol.name)]
				.filter(Boolean)
				.join(" ");
		})
		.filter(Boolean);
	if (symbols.length > 0) return symbols.join("\n");

	const paths = asArray(resultPayload.paths)
		.slice(0, 6)
		.map((value) => {
			const entry = asRecord(value);
			return [asString(entry.path), asString(entry.type)]
				.filter(Boolean)
				.join(": ");
		})
		.filter(Boolean);
	return paths.join("\n");
}
