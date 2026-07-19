import { contentDigest } from "../../../agentsShare";
import type { NativeApiHistoryItem } from "./native-api-tool-history";

const MAX_COMPACT_SUMMARY_CHARS = 3_000;
const MAX_COMPACT_ENTRY_CONTENT_CHARS = 600;
const MAX_STRUCTURED_TEXT_CHARS = 160;
const MAX_STRUCTURED_ARRAY_ITEMS = 6;
const MAX_STRUCTURED_OBJECT_KEYS = 16;
const MAX_STRUCTURED_DEPTH = 6;

export type NativeApiBaselineCompactionResult = {
	history: NativeApiHistoryItem[];
	retainedHistoryItems: number;
	previousHistoryItems: number;
	reason: string;
};

export function compactNativeApiHistoryToBaseline(input: {
	baselineHistory: readonly NativeApiHistoryItem[];
	previousHistory: readonly NativeApiHistoryItem[];
	reason: string;
	todoSnapshotItem?: Extract<NativeApiHistoryItem, { type: "user" }> | null;
	currentTodoItem?: Extract<NativeApiHistoryItem, { type: "user" }> | null;
	postImportHistoryItem?: Extract<
		NativeApiHistoryItem,
		{ type: "user" }
	> | null;
}): NativeApiBaselineCompactionResult {
	const history = [...input.baselineHistory];
	appendIfPresent(history, buildConversationSummary(input.previousHistory));
	appendIfPresent(history, input.todoSnapshotItem);
	appendIfPresent(history, input.currentTodoItem);
	appendIfPresent(history, input.postImportHistoryItem);
	return {
		history,
		retainedHistoryItems: history.length,
		previousHistoryItems: input.previousHistory.length,
		reason: input.reason,
	};
}

function buildConversationSummary(
	history: readonly NativeApiHistoryItem[],
): Extract<NativeApiHistoryItem, { type: "user" }> | null {
	const entries = history
		.filter((item) => item.type !== "system")
		.slice(-24)
		.map((item) => {
			if (item.type === "user") {
				return {
					type: "user",
					source: item.source,
					content: compactEntryContent(item.content),
				};
			}
			if (item.type === "assistant") {
				return {
					type: "assistant",
					content: compactEntryContent(item.content),
					toolCalls: item.toolCalls?.map((call) => ({
						id: call.id,
						name: call.name,
					})),
				};
			}
			return {
				type: "tool_result",
				toolCallId: item.toolCallId,
				toolName: item.toolName,
				ok: item.result.ok,
				content: compactEntryContent(item.result.content),
			};
		});
	if (!entries.length) return null;
	const retained: typeof entries = [];
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const candidate = [entries[index], ...retained];
		const candidateLength = JSON.stringify({ entries: candidate }).length;
		if (candidateLength > MAX_COMPACT_SUMMARY_CHARS && retained.length > 0) {
			break;
		}
		retained.unshift(entries[index]);
	}
	const body = {
		historyDigest: contentDigest(JSON.stringify(entries)),
		itemCount: entries.length,
		omittedCount: entries.length - retained.length,
		entries: retained,
	};
	return {
		type: "user",
		source: "runtime",
		content: [
			"[Conversation Summary Before Compaction]",
			JSON.stringify(body),
		].join("\n"),
	};
}

function compactEntryContent(value: string) {
	if (value.length <= MAX_COMPACT_ENTRY_CONTENT_CHARS) return value;
	const structuredRecovery = compactStructuredRecoveryContent(value);
	if (structuredRecovery) return structuredRecovery;
	return {
		digest: contentDigest(value),
		charCount: value.length,
		excerptStart: value.slice(0, MAX_COMPACT_ENTRY_CONTENT_CHARS / 2),
		excerptEnd: value.slice(-MAX_COMPACT_ENTRY_CONTENT_CHARS / 2),
	};
}

function compactStructuredRecoveryContent(value: string) {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		return null;
	}
	const body = record(parsed);
	const currentSnapshot = record(body?.currentSnapshot);
	const readiness = record(currentSnapshot?.readiness);
	if (!body || !record(body.error) || !readiness) return null;
	const verification = record(readiness.verification);
	const verificationResult = record(verification?.result);
	const recoveryContext = record(body.currentRecoveryContext);
	return compactStructuredValue({
		error: body.error,
		currentSnapshotDigest: body.currentSnapshotDigest,
		currentSnapshotRef: body.currentSnapshotRef,
		finalCandidate: body.finalCandidate,
		readiness: {
			authority: readiness.authority,
			workspace: readiness.workspace,
			verification: {
				applicability: verification?.applicability,
				result: verificationResult
					? {
							ok: verificationResult.ok,
							summary: verificationResult.summary,
							reason: verificationResult.reason,
						}
					: null,
			},
			discrepancies: readiness.discrepancies,
			satisfactionConditions: readiness.satisfactionConditions,
		},
		recovery: recoveryContext
			? {
					authoritativeContext: recoveryContext.authoritativeContext,
					recoveryRefs: recoveryContext.recoveryRefs,
				}
			: null,
	});
}

function compactStructuredValue(value: unknown, depth = 0): unknown {
	if (typeof value === "string") {
		if (value.length <= MAX_STRUCTURED_TEXT_CHARS) return value;
		return {
			digest: contentDigest(value),
			charCount: value.length,
			excerptStart: value.slice(0, MAX_STRUCTURED_TEXT_CHARS / 2),
			excerptEnd: value.slice(-MAX_STRUCTURED_TEXT_CHARS / 2),
		};
	}
	if (value === null || typeof value !== "object") return value;
	if (depth >= MAX_STRUCTURED_DEPTH) {
		const serialized = JSON.stringify(value);
		return {
			digest: contentDigest(serialized),
			charCount: serialized.length,
		};
	}
	if (Array.isArray(value)) {
		const items = value
			.slice(0, MAX_STRUCTURED_ARRAY_ITEMS)
			.map((item) => compactStructuredValue(item, depth + 1));
		if (items.length === value.length) return items;
		return {
			items,
			itemCount: value.length,
			omittedCount: value.length - items.length,
			digest: contentDigest(JSON.stringify(value)),
		};
	}
	const entries = Object.entries(value);
	const selected = entries.slice(0, MAX_STRUCTURED_OBJECT_KEYS);
	const compacted = Object.fromEntries(
		selected.map(([key, item]) => [
			key,
			compactStructuredValue(item, depth + 1),
		]),
	);
	if (selected.length === entries.length) return compacted;
	return {
		...compacted,
		_object: {
			keyCount: entries.length,
			omittedCount: entries.length - selected.length,
			digest: contentDigest(JSON.stringify(value)),
		},
	};
}

function record(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function appendIfPresent(
	history: NativeApiHistoryItem[],
	item: Extract<NativeApiHistoryItem, { type: "user" }> | null | undefined,
) {
	if (!item) return;
	if (
		history.some(
			(existing) =>
				existing.type === "user" && existing.content === item.content,
		)
	) {
		return;
	}
	history.push(item);
}
