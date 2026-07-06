import type { taskEvents, taskRuns } from "../../db/schema";
import type { RunEventBase, RunEventType } from "./types";

type RunRow = typeof taskRuns.$inferSelect;
type EventRow = typeof taskEvents.$inferSelect;

const LEGACY_TO_CANONICAL: Record<string, RunEventType> = {
	supervisor_decision: "supervisor.decision",
	tool_call: "tool.call_progress",
	tool_result: "tool.call_finished",
	final_report: "run.runtime_finished",
	run_outcome_decided: "run.outcome_decided",
	warning: "system.warning",
	error: "system.error",
	checkpoint: "verification.finished",
	state_change: "run.recovered",
	info: "model.response_delta",
};

export function canonicalizeTaskEvent(
	event: EventRow,
	run: RunRow,
): RunEventBase {
	const payload =
		(event.payloadJson as { runEvent?: RunEventBase } | null) || {};
	if (payload.runEvent) {
		return {
			...payload.runEvent,
			id: payload.runEvent.id ?? event.id,
			seq: payload.runEvent.seq ?? event.seq,
			runId: payload.runEvent.runId || run.id,
			taskId: payload.runEvent.taskId || run.taskId,
		};
	}

	const type =
		(event.eventType && LEGACY_TO_CANONICAL[event.eventType]) ||
		LEGACY_TO_CANONICAL[event.type] ||
		"system.warning";

	return {
		version: 1,
		id: event.id,
		runId: run.id,
		taskId: run.taskId,
		seq: event.seq,
		timestamp: event.timestamp.toISOString(),
		type,
		severity:
			event.type === "error"
				? "error"
				: event.type === "warning"
					? "warning"
					: "info",
		actor: (event.actor as RunEventBase["actor"]) || "system",
		message: event.message,
		data: {},
	};
}
