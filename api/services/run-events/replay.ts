import type { ParsedRunJsonl, ReplayResult, RunEventBase } from "./types";

function stringFrom(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function outcomeFrom(event: RunEventBase): ReplayResult["terminal"] {
	const data = (event.data || {}) as Record<string, unknown>;
	const outcome =
		typeof data.outcome === "object" && data.outcome !== null
			? (data.outcome as Record<string, unknown>)
			: data;
	return {
		status: stringFrom(outcome.status),
		reason: stringFrom(outcome.reason),
		summary: stringFrom(outcome.summary) ?? event.message,
	};
}

export function replayRunJsonl(parsed: ParsedRunJsonl): ReplayResult {
	const events = [...parsed.events].sort((a, b) => a.seq - b.seq);
	const diagnostics = [...parsed.diagnostics];
	const reviewResults: unknown[] = [];
	const reviewResultKeys = new Set<string>();
	const policyEvents: RunEventBase[] = [];
	const verificationEvents: RunEventBase[] = [];
	let terminal: ReplayResult["terminal"] = {};

	const pushReviewResult = (value: unknown) => {
		const key = JSON.stringify(value);
		if (reviewResultKeys.has(key)) return;
		reviewResultKeys.add(key);
		reviewResults.push(value);
	};

	for (const line of events) {
		const event = line.event;
		if (line.reviewResult) pushReviewResult(line.reviewResult);
		if (event.data && "reviewResult" in event.data) {
			pushReviewResult((event.data as { reviewResult: unknown }).reviewResult);
		}
		if (
			(event.type === "human.review_submitted" ||
				event.type === "review.evaluation_finished") &&
			!line.reviewResult
		) {
			pushReviewResult(event.data ?? { message: event.message });
		}
		if (
			event.type === "tool.policy_blocked" ||
			event.type === "safety.policy_violation"
		) {
			policyEvents.push(event);
		}
		if (
			event.type === "verification.started" ||
			event.type === "verification.finished"
		) {
			verificationEvents.push(event);
		}
		if (event.type === "run.outcome_decided") {
			terminal = outcomeFrom(event);
		}
	}

	if (!terminal.status && parsed.summary) {
		terminal = {
			status: parsed.summary.status,
			summary: parsed.summary.summary ?? undefined,
		};
	} else if (
		terminal.status &&
		parsed.summary &&
		terminal.status !== parsed.summary.status
	) {
		diagnostics.push({
			level: "warning",
			line: 0,
			code: "invalid_schema",
			message: `run.outcome_decided status ${terminal.status} differs from run_summary status ${parsed.summary.status}; outcome event takes precedence`,
		});
	}

	return {
		sourceRunId: parsed.header?.runId ?? parsed.summary?.runId ?? "",
		eventCount: events.length,
		events: events.map((line) => line.event),
		todos: parsed.summary?.todos ?? [],
		terminal,
		evidence: {
			hasRuntimeStarted: events.some(
				(line) => line.event.type === "run.runtime_started",
			),
			hasRuntimeFinished: events.some(
				(line) => line.event.type === "run.runtime_finished",
			),
			hasOutcomeDecided: events.some(
				(line) => line.event.type === "run.outcome_decided",
			),
			hasDiff:
				events.some((line) => line.event.type === "git.diff_collected") ||
				(parsed.summary?.diffBytes ?? 0) > 0,
			hasVerification: verificationEvents.length > 0,
			hasPolicyBlock: policyEvents.length > 0,
			hasReviewResult: reviewResults.length > 0,
			hasTodos: (parsed.summary?.todos ?? []).length > 0,
		},
		reviewResults,
		policyEvents,
		verificationEvents,
		diagnostics,
	};
}
