import type { taskEvents, taskRuns } from "../../../db/schema";
import { canonicalizeTaskEvent } from "../../../services/run-events/canonicalize";
import type {
	ReplayResult,
	RunEventBase,
	RunEventJsonlLine,
	RunSummaryJsonlLine,
} from "../../../services/run-events/types";
import type { ReviewEvidenceRef } from "../results/types";
import type { ReviewEvidencePack } from "./types";

type RunRow = typeof taskRuns.$inferSelect;
type EventRow = typeof taskEvents.$inferSelect;

const SECRET_PATTERNS = [
	/sk-[A-Za-z0-9_-]{12,}/g,
	/\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*[^\s"']+/gi,
	/\b[A-Za-z0-9._%+-]+(?:api[_-]?key|secret|token|password)[A-Za-z0-9._%+-]*\s*[:=]\s*[^\s"']+/gi,
	/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
];

export function redactSecretLikeValues(input: string): string {
	return SECRET_PATTERNS.reduce(
		(text, pattern) => text.replace(pattern, "[REDACTED]"),
		input,
	);
}

function redactedString(value: unknown, maxLength = 500): string | undefined {
	if (typeof value !== "string") return undefined;
	const redacted = redactSecretLikeValues(value);
	return redacted.length > maxLength
		? `${redacted.slice(0, maxLength)}...`
		: redacted;
}

function redactUnknown(value: unknown): unknown {
	if (typeof value === "string") return redactSecretLikeValues(value);
	if (Array.isArray(value)) return value.map(redactUnknown);
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>).map(([key, item]) => [
			key,
			redactUnknown(item),
		]),
	);
}

function eventData(event: RunEventBase): Record<string, unknown> {
	return event.data && typeof event.data === "object" ? event.data : {};
}

function boolFrom(value: unknown): boolean | undefined {
	return typeof value === "boolean" ? value : undefined;
}

function stringFrom(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function recordFrom(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function firstRecord(...values: unknown[]): Record<string, unknown> {
	for (const value of values) {
		const record = recordFrom(value);
		if (Object.keys(record).length > 0) return record;
	}
	return {};
}

function parseToolTextResult(result: Record<string, unknown>) {
	const content = result.content;
	if (!Array.isArray(content)) return {};
	for (const item of content) {
		const record = recordFrom(item);
		if (record.type !== "text" || typeof record.text !== "string") continue;
		try {
			return recordFrom(JSON.parse(record.text));
		} catch {
			return {};
		}
	}
	return {};
}

function normalizeToolName(toolName?: string) {
	return toolName?.startsWith("nightworkers.")
		? toolName.slice("nightworkers.".length)
		: toolName;
}

function readManagedCheckResult(event: RunEventBase) {
	if (event.type !== "tool.call_finished") return null;
	const data = eventData(event);
	const toolName = normalizeToolName(
		stringFrom(data.mcpTool) || stringFrom(data.toolName),
	);
	if (toolName !== "run_check" && toolName !== "completion_check") return null;
	const rawResult = firstRecord(data.result, data.toolResult);
	const parsedTextResult = parseToolTextResult(rawResult);
	const structuredContent = firstRecord(
		rawResult.structuredContent,
		rawResult.structured_content,
		recordFrom(rawResult.result).structuredContent,
		recordFrom(rawResult.result).structured_content,
	);
	const payload = firstRecord(
		parsedTextResult.payload,
		rawResult.payload,
		recordFrom(rawResult.result).payload,
		recordFrom(structuredContent.payload),
		rawResult.result,
		rawResult,
	);
	const argumentsPayload = recordFrom(data.arguments);
	const checkKind =
		toolName === "run_check"
			? stringFrom(payload.checkKind) ||
				stringFrom(argumentsPayload.checkKind) ||
				"run_check"
			: "completion_check";
	const passed = boolFrom(parsedTextResult.ok) ?? boolFrom(rawResult.ok);
	return {
		eventId: event.id,
		command: checkKind,
		passed:
			passed ??
			(data.status === "completed" ||
				stringFrom(payload.status) === "completed"),
		summary: redactedString(payload.llmSummary ?? event.message),
	};
}

function changedFilesFromDiff(diffPatch?: string | null): string[] {
	if (!diffPatch) return [];
	const files = new Set<string>();
	for (const line of diffPatch.split("\n")) {
		const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
		if (match?.[2]) files.add(match[2]);
	}
	return [...files].sort();
}

function diffBytesFromEvents(
	events: RunEventBase[],
	fallbackBytes = 0,
): number {
	for (const event of events) {
		if (event.type !== "git.diff_collected") continue;
		const data = eventData(event);
		const bytes = data.bytes ?? data.diffBytes;
		if (typeof bytes === "number" && Number.isFinite(bytes))
			return Math.max(0, bytes);
		const patch = redactedString(data.patch);
		if (patch) return Buffer.byteLength(patch, "utf8");
	}
	return fallbackBytes;
}

function selectedEventsFrom(
	events: RunEventBase[],
): ReviewEvidencePack["selectedEvents"] {
	return events
		.filter((event) =>
			[
				"run.runtime_finished",
				"run.outcome_decided",
				"run.final_judgment_created",
				"verification.finished",
				"tool.policy_blocked",
				"safety.policy_violation",
				"tool.call_finished",
				"system.error",
			].includes(event.type),
		)
		.slice(-50)
		.map((event) => ({
			id: event.id,
			seq: event.seq,
			type: event.type,
			severity: event.severity,
			message: redactSecretLikeValues(event.message),
		}));
}

function buildVerification(
	events: RunEventBase[],
): ReviewEvidencePack["verification"] {
	const canonicalVerification = events
		.filter((event) => event.type === "verification.finished")
		.map((event) => {
			const data = eventData(event);
			return {
				eventId: event.id,
				command: redactedString(data.command),
				passed: boolFrom(data.passed),
				summary: redactedString(data.summary ?? event.message),
			};
		});
	const managedVerification = events
		.map(readManagedCheckResult)
		.filter((item): item is NonNullable<typeof item> => Boolean(item));
	return [...canonicalVerification, ...managedVerification];
}

function buildPolicy(events: RunEventBase[]): ReviewEvidencePack["policy"] {
	return events
		.filter(
			(event) =>
				event.type === "tool.policy_blocked" ||
				event.type === "safety.policy_violation",
		)
		.map((event) => {
			const data = eventData(event);
			return {
				eventId: event.id,
				code: redactedString(data.code),
				message:
					redactedString(data.message ?? event.message) ?? "Policy violation",
			};
		});
}

function reviewResultsFromEvents(
	events: RunEventBase[],
	eventRows?: EventRow[],
): unknown[] {
	const results: unknown[] = [];
	const seen = new Set<string>();
	const push = (value: unknown) => {
		if (!value) return;
		const key = JSON.stringify(value);
		if (seen.has(key)) return;
		seen.add(key);
		results.push(redactUnknown(value));
	};

	for (const event of events) {
		const data = eventData(event);
		if ("reviewResult" in data) push(data.reviewResult);
		if (
			event.type === "human.review_submitted" ||
			event.type === "review.evaluation_finished"
		) {
			push(data.reviewResult ?? data);
		}
	}

	for (const row of eventRows ?? []) {
		const payload = row.payloadJson as { reviewResult?: unknown } | null;
		push(payload?.reviewResult);
	}

	return results;
}

function terminalFromEvents(
	events: RunEventBase[],
): ReviewEvidencePack["outcome"] | undefined {
	const outcome = [...events]
		.reverse()
		.find((event) => event.type === "run.outcome_decided");
	if (!outcome) return undefined;
	const data = eventData(outcome);
	const nested =
		data.outcome && typeof data.outcome === "object" ? data.outcome : data;
	const value = nested as Record<string, unknown>;
	const status = redactedString(value.status);
	if (!status) return undefined;
	return {
		status,
		reason: redactedString(value.reason),
		summary: redactedString(value.summary ?? outcome.message),
	};
}

function finalReportFromEvents(events: RunEventBase[]): string | undefined {
	for (const event of [...events].reverse()) {
		if (event.type !== "run.final_judgment_created") continue;
		const data = eventData(event);
		const finalReport = redactedString(data.finalReport, 4_000);
		if (finalReport) return finalReport;
		const finalJudgment =
			data.finalJudgment && typeof data.finalJudgment === "object"
				? (data.finalJudgment as Record<string, unknown>)
				: null;
		const conclusion = redactedString(finalJudgment?.conclusion, 4_000);
		if (conclusion) return conclusion;
	}
	return undefined;
}

export function buildReviewEvidencePackFromRun(
	run: RunRow,
	eventRows: EventRow[],
): ReviewEvidencePack {
	const events = eventRows.map((event) => canonicalizeTaskEvent(event, run));
	const contextSnapshot = recordFrom(run.contextSnapshot);
	const diffBytes =
		Buffer.byteLength(run.diffPatch || "", "utf8") ||
		diffBytesFromEvents(events);

	return {
		version: 1,
		runId: run.id,
		taskId: run.taskId,
		status: run.status,
		context: {
			executionMode: stringFrom(contextSnapshot.executionMode),
			inRunReview: run.status === "running",
		},
		outcome: terminalFromEvents(events),
		finalReport:
			redactedString(run.finalReport, 4_000) ?? finalReportFromEvents(events),
		diff: {
			hasChanges: diffBytes > 0,
			bytes: diffBytes,
			changedFiles: changedFilesFromDiff(run.diffPatch),
		},
		verification: buildVerification(events),
		policy: buildPolicy(events),
		reviewResults: reviewResultsFromEvents(events, eventRows),
		selectedEvents: selectedEventsFrom(events),
		eventTypes: events.map((event) => event.type),
		diagnostics: [],
	};
}

export function buildReviewEvidencePackFromReplay(
	replay: ReplayResult,
	events: RunEventJsonlLine[] = [],
	summary?: RunSummaryJsonlLine,
): ReviewEvidencePack {
	const runEvents = events.map((line) => line.event);
	const diffBytes = diffBytesFromEvents(
		runEvents,
		replay.evidence.hasDiff ? 1 : 0,
	);
	const taskId = events[0]?.event.taskId ?? "";
	return {
		version: 1,
		runId: replay.sourceRunId,
		taskId,
		status: replay.terminal.status ?? "unknown",
		outcome: replay.terminal.status
			? {
					status: replay.terminal.status,
					reason: replay.terminal.reason,
					summary: replay.terminal.summary,
				}
			: undefined,
		finalReport:
			redactedString(summary?.finalReport, 4_000) ??
			finalReportFromEvents(runEvents),
		diff: {
			hasChanges: replay.evidence.hasDiff,
			bytes: diffBytes,
			changedFiles: [],
		},
		verification: buildVerification(
			runEvents.length ? runEvents : replay.verificationEvents,
		),
		policy: buildPolicy(runEvents.length ? runEvents : replay.policyEvents),
		reviewResults: replay.reviewResults,
		selectedEvents: selectedEventsFrom(runEvents),
		eventTypes: runEvents.map((event) => event.type),
		diagnostics: replay.diagnostics.map(
			(item) => `${item.level}:${item.code}:${item.message}`,
		),
	};
}

export function buildEvidenceRefExistenceSet(
	pack: ReviewEvidencePack,
): Set<string> {
	const keys = new Set<string>();
	keys.add(refKey({ kind: "diff", runId: pack.runId }));
	if (pack.finalReport)
		keys.add(refKey({ kind: "final_report", runId: pack.runId }));
	for (const event of pack.selectedEvents) {
		if (event.id) keys.add(refKey({ kind: "run_event", eventId: event.id }));
	}
	for (const item of pack.verification) {
		keys.add(
			refKey({
				kind: "verification",
				eventId: item.eventId,
				command: item.command,
			}),
		);
	}
	for (const item of pack.policy) {
		keys.add(
			refKey({
				kind: "policy",
				eventId: item.eventId,
				code: item.code,
				message: item.message,
			}),
		);
	}
	for (const path of pack.diff.changedFiles) {
		keys.add(refKey({ kind: "changed_file", path }));
	}
	return keys;
}

export function refKey(ref: ReviewEvidenceRef): string {
	switch (ref.kind) {
		case "run_event":
			return `run_event:${ref.eventId}`;
		case "diff":
			return `diff:${ref.runId}`;
		case "final_report":
			return `final_report:${ref.runId}`;
		case "verification":
			return `verification:${ref.eventId ?? ref.command ?? "unknown"}`;
		case "policy":
			return `policy:${ref.eventId ?? ref.code ?? ref.message ?? "unknown"}`;
		case "artifact":
			return `artifact:${ref.artifactId}`;
		case "changed_file":
			return `changed_file:${ref.path}`;
	}
}
