import type { RunEventBase, RunEventType } from "./types";

type LegacyMapping = {
	eventType: string;
	type: "info" | "warning" | "error" | "checkpoint";
};

const LEGACY_MAPPING: Record<RunEventType, LegacyMapping> = {
	"run.created": { eventType: "state_change", type: "info" },
	"run.prompt_prepared": { eventType: "state_change", type: "info" },
	"run.runtime_started": { eventType: "state_change", type: "info" },
	"run.runtime_finished": { eventType: "state_change", type: "checkpoint" },
	"run.stop_requested": { eventType: "state_change", type: "warning" },
	"run.finalizing_started": { eventType: "state_change", type: "info" },
	"run.final_judgment_created": { eventType: "final_report", type: "info" },
	"run.outcome_decided": { eventType: "run_outcome_decided", type: "info" },
	"run.recovered": { eventType: "state_change", type: "warning" },
	"agent_mode_session.opened": { eventType: "state_change", type: "info" },
	"agent_mode_session.reused": { eventType: "state_change", type: "info" },
	"agent_mode_session.closed": { eventType: "state_change", type: "info" },
	"turn.started": { eventType: "supervisor_decision", type: "info" },
	"turn.finished": { eventType: "supervisor_decision", type: "info" },
	"model.request_started": { eventType: "supervisor_decision", type: "info" },
	"model.provider_activity_detected": { eventType: "warning", type: "warning" },
	"model.provider_tool_call_detected": {
		eventType: "warning",
		type: "warning",
	},
	"model.provider_activity_rejected": { eventType: "error", type: "error" },
	"model.retry_scheduled": { eventType: "warning", type: "warning" },
	"model.retry_started": { eventType: "supervisor_decision", type: "info" },
	"model.route_fallback_scheduled": { eventType: "warning", type: "warning" },
	"model.route_fallback_started": {
		eventType: "supervisor_decision",
		type: "info",
	},
	"model.route_fallback_unavailable": { eventType: "warning", type: "warning" },
	"model.response_delta": { eventType: "info", type: "info" },
	"model.response_parse_failed": { eventType: "error", type: "error" },
	"model.response_repaired": { eventType: "system.warning", type: "warning" },
	"model.response_finished": { eventType: "supervisor_decision", type: "info" },
	"context.handoff_created": { eventType: "context", type: "info" },
	"context.handoff_failed": { eventType: "context", type: "error" },
	"context.working_context_created": { eventType: "context", type: "info" },
	"context.working_context_failed": { eventType: "context", type: "error" },
	"supervisor.decision": { eventType: "supervisor_decision", type: "info" },
	"tool.call_started": { eventType: "tool_call", type: "info" },
	"tool.call_progress": { eventType: "tool_call", type: "info" },
	"tool.call_finished": { eventType: "tool_result", type: "info" },
	"tool.policy_blocked": { eventType: "error", type: "error" },
	"hook.started": { eventType: "hook", type: "info" },
	"hook.finished": { eventType: "hook", type: "info" },
	"hook.blocked": { eventType: "hook", type: "error" },
	"hook.failed": { eventType: "hook", type: "error" },
	"verification.started": { eventType: "checkpoint", type: "checkpoint" },
	"verification.finished": { eventType: "checkpoint", type: "checkpoint" },
	"git.status_collected": { eventType: "tool_result", type: "info" },
	"git.diff_collected": { eventType: "final_report", type: "checkpoint" },
	"git.closeout_committed": {
		eventType: "git_closeout",
		type: "checkpoint",
	},
	"git.closeout_commit_failed": { eventType: "git_closeout", type: "warning" },
	"git.closeout_pushed": { eventType: "git_closeout", type: "checkpoint" },
	"git.closeout_push_failed": { eventType: "git_closeout", type: "warning" },
	"safety.budget_reached": { eventType: "error", type: "error" },
	"safety.policy_violation": { eventType: "error", type: "error" },
	"safety.repeated_failure": { eventType: "error", type: "error" },
	"human.review_submitted": { eventType: "state_change", type: "info" },
	"review.rubric_loaded": { eventType: "review_rubric_loaded", type: "info" },
	"review.evaluation_started": { eventType: "review_evaluation", type: "info" },
	"review.llm_started": { eventType: "review_evaluation", type: "info" },
	"review.llm_finished": { eventType: "review_evaluation", type: "info" },
	"review.evaluation_finished": {
		eventType: "review_evaluation",
		type: "checkpoint",
	},
	"review.recommendation_created": {
		eventType: "review_recommendation",
		type: "checkpoint",
	},
	"review.recommendation_failed": {
		eventType: "review_recommendation",
		type: "warning",
	},
	"review.session_auto_started": {
		eventType: "review_recommendation",
		type: "info",
	},
	"review.run_started": {
		eventType: "review_evaluation",
		type: "info",
	},
	"review.run_completed": {
		eventType: "review_evaluation",
		type: "checkpoint",
	},
	"review.correction_requested": {
		eventType: "review_evaluation",
		type: "info",
	},
	"review.required_section_auto_started": {
		eventType: "review_evaluation",
		type: "info",
	},
	"review.required_section_auto_failed": {
		eventType: "review_evaluation",
		type: "warning",
	},
	"system.info": { eventType: "info", type: "info" },
	"system.warning": { eventType: "warning", type: "warning" },
	"system.error": { eventType: "error", type: "error" },
};

export function normalizeRunEventToLegacy(input: {
	event: RunEventBase;
	legacyPayload?: unknown;
}): {
	actor: string;
	type: "info" | "warning" | "error" | "checkpoint";
	eventType: string;
	message: string;
	timestamp: Date;
	payloadJson: { runEvent: RunEventBase; legacyPayload?: unknown };
} {
	const mapping = LEGACY_MAPPING[input.event.type];
	const type = input.event.severity === "error" ? "error" : mapping.type;
	return {
		actor: input.event.actor,
		type,
		eventType: mapping.eventType,
		message: input.event.message,
		timestamp: new Date(input.event.timestamp),
		payloadJson: {
			runEvent: input.event,
			...(input.legacyPayload === undefined
				? {}
				: { legacyPayload: input.legacyPayload }),
		},
	};
}
