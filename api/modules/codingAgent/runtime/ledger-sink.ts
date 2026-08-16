import { logEvent } from "../../../lib/logger";
import { requireCodingAgentHost } from "../ports/coding-agent-host.binding";
import type { RuntimeContractWarningSeverity } from "./shared";
import type { AgentRuntimeEvent, AgentRuntimeSink } from "./types";

type EventMapping = {
	actor: "runtime" | "supervisor" | "worker" | "system";
	severity: "debug" | "info" | "warning" | "error" | "checkpoint";
	canonicalType: import("../../../services/run-events/types").RunEventType;
};

const EVENT_MAPPING: Record<AgentRuntimeEvent["type"], EventMapping> = {
	runtime_started: {
		actor: "runtime",
		severity: "info",
		canonicalType: "run.runtime_started",
	},
	turn_started: {
		actor: "supervisor",
		severity: "info",
		canonicalType: "turn.started",
	},
	turn_finished: {
		actor: "supervisor",
		severity: "checkpoint",
		canonicalType: "turn.finished",
	},
	model_response_started: {
		actor: "supervisor",
		severity: "info",
		canonicalType: "model.request_started",
	},
	model_response_failed: {
		actor: "supervisor",
		severity: "error",
		canonicalType: "model.request_failed",
	},
	model_response_delta: {
		actor: "supervisor",
		severity: "debug",
		canonicalType: "model.response_delta",
	},
	model_response_finished: {
		actor: "supervisor",
		severity: "info",
		canonicalType: "model.response_finished",
	},
	model_response_parse_failed: {
		actor: "supervisor",
		severity: "error",
		canonicalType: "model.response_parse_failed",
	},
	model_response_repaired: {
		actor: "supervisor",
		severity: "warning",
		canonicalType: "model.response_repaired",
	},
	model_retry_scheduled: {
		actor: "supervisor",
		severity: "warning",
		canonicalType: "model.retry_scheduled",
	},
	model_retry_started: {
		actor: "supervisor",
		severity: "info",
		canonicalType: "model.retry_started",
	},
	supervisor_decision: {
		actor: "supervisor",
		severity: "info",
		canonicalType: "supervisor.decision",
	},
	tool_call_started: {
		actor: "worker",
		severity: "info",
		canonicalType: "tool.call_started",
	},
	tool_call_progress: {
		actor: "worker",
		severity: "info",
		canonicalType: "tool.call_progress",
	},
	tool_call_finished: {
		actor: "worker",
		severity: "info",
		canonicalType: "tool.call_finished",
	},
	verification_started: {
		actor: "supervisor",
		severity: "checkpoint",
		canonicalType: "verification.started",
	},
	verification_finished: {
		actor: "supervisor",
		severity: "checkpoint",
		canonicalType: "verification.finished",
	},
	diff_collected: {
		actor: "worker",
		severity: "checkpoint",
		canonicalType: "git.diff_collected",
	},
	runtime_finished: {
		actor: "runtime",
		severity: "checkpoint",
		canonicalType: "run.runtime_finished",
	},
	runtime_warning: {
		actor: "system",
		severity: "warning",
		canonicalType: "system.warning",
	},
	runtime_error: {
		actor: "system",
		severity: "error",
		canonicalType: "system.error",
	},
};

export function createLedgerSink(taskRunId: string): AgentRuntimeSink {
	return {
		async emit(event: AgentRuntimeEvent) {
			const mapped = EVENT_MAPPING[event.type];
			const canonicalType = resolveCanonicalEventType(event, mapped);
			try {
				await requireCodingAgentHost().runJournal.appendRunEvent({
					version: 1,
					runId: taskRunId,
					timestamp: new Date().toISOString(),
					type: canonicalType,
					severity: resolveEventSeverity(event, mapped),
					actor: mapped.actor,
					message: event.message.slice(0, 1000),
					data: (event.payload as Record<string, unknown>) || {},
				});
			} catch (error) {
				logEvent({
					channel: "agent-runtime",
					level: "error",
					message: "failed to persist runtime ledger event",
					meta: {
						runId: taskRunId,
						eventType: event.type,
						errorMessage:
							error instanceof Error ? error.message : String(error),
					},
				});
			}
		},
	};
}

function resolveCanonicalEventType(
	event: AgentRuntimeEvent,
	mapped: EventMapping,
): import("../../../services/run-events/types").RunEventType {
	const payload =
		event.payload && typeof event.payload === "object"
			? (event.payload as Record<string, unknown>)
			: {};
	if (
		event.type === "runtime_started" &&
		payload.provider === "codex" &&
		payload.action === "runtime.resume_state_reused"
	) {
		return "run.provider_thread_resumed";
	}
	if (
		event.type === "runtime_started" &&
		payload.action === "runtime.provider_thread_fallback_started"
	) {
		return "run.provider_thread_fallback_started";
	}
	if (
		event.type === "runtime_warning" &&
		payload.code === "codex_runtime_resume_failed"
	) {
		return "run.provider_thread_resume_failed";
	}
	return mapped.canonicalType;
}

function resolveEventSeverity(event: AgentRuntimeEvent, mapped: EventMapping) {
	if (event.type !== "runtime_warning") return mapped.severity;
	const severity =
		event.payload && typeof event.payload === "object"
			? (event.payload as Record<string, unknown>).severity
			: undefined;
	if (isContractWarningSeverity(severity)) return severity;
	return mapped.severity;
}

function isContractWarningSeverity(
	value: unknown,
): value is RuntimeContractWarningSeverity {
	return value === "info" || value === "warning" || value === "error";
}
