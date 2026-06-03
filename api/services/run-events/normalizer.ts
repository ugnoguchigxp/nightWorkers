import type { RunEventBase, RunEventType } from './types';

type LegacyMapping = { eventType: string; type: 'info' | 'warning' | 'error' | 'checkpoint' };

const LEGACY_MAPPING: Record<RunEventType, LegacyMapping> = {
  'run.created': { eventType: 'state_change', type: 'info' },
  'run.context_compiled': { eventType: 'state_change', type: 'info' },
  'run.runtime_started': { eventType: 'state_change', type: 'info' },
  'run.runtime_finished': { eventType: 'state_change', type: 'checkpoint' },
  'run.finalizing_started': { eventType: 'state_change', type: 'info' },
  'run.final_judgment_created': { eventType: 'final_report', type: 'info' },
  'run.outcome_decided': { eventType: 'run_outcome_decided', type: 'info' },
  'run.recovered': { eventType: 'state_change', type: 'warning' },
  'turn.started': { eventType: 'supervisor_decision', type: 'info' },
  'turn.finished': { eventType: 'supervisor_decision', type: 'info' },
  'model.request_started': { eventType: 'supervisor_decision', type: 'info' },
  'model.retry_scheduled': { eventType: 'warning', type: 'warning' },
  'model.retry_started': { eventType: 'supervisor_decision', type: 'info' },
  'model.response_delta': { eventType: 'info', type: 'info' },
  'model.response_parse_failed': { eventType: 'error', type: 'error' },
  'model.response_repaired': { eventType: 'system.warning', type: 'warning' },
  'model.response_finished': { eventType: 'supervisor_decision', type: 'info' },
  'supervisor.decision': { eventType: 'supervisor_decision', type: 'info' },
  'tool.call_started': { eventType: 'tool_call', type: 'info' },
  'tool.call_progress': { eventType: 'tool_call', type: 'info' },
  'tool.call_finished': { eventType: 'tool_result', type: 'info' },
  'tool.policy_blocked': { eventType: 'error', type: 'error' },
  'hook.started': { eventType: 'hook', type: 'info' },
  'hook.finished': { eventType: 'hook', type: 'info' },
  'hook.blocked': { eventType: 'hook', type: 'error' },
  'hook.failed': { eventType: 'hook', type: 'error' },
  'verification.started': { eventType: 'checkpoint', type: 'checkpoint' },
  'verification.finished': { eventType: 'checkpoint', type: 'checkpoint' },
  'git.status_collected': { eventType: 'tool_result', type: 'info' },
  'git.diff_collected': { eventType: 'final_report', type: 'checkpoint' },
  'safety.budget_reached': { eventType: 'error', type: 'error' },
  'safety.policy_violation': { eventType: 'error', type: 'error' },
  'safety.repeated_failure': { eventType: 'error', type: 'error' },
  'human.review_submitted': { eventType: 'state_change', type: 'info' },
  'review.rubric_loaded': { eventType: 'review_rubric_loaded', type: 'info' },
  'review.evaluation_started': { eventType: 'review_evaluation', type: 'info' },
  'review.llm_started': { eventType: 'review_evaluation', type: 'info' },
  'review.llm_finished': { eventType: 'review_evaluation', type: 'info' },
  'review.evaluation_finished': { eventType: 'review_evaluation', type: 'checkpoint' },
  'memory.candidate_generated': { eventType: 'memory.candidate_generated', type: 'info' },
  'memory.candidate_approved': { eventType: 'memory.candidate_approved', type: 'info' },
  'memory.register_started': { eventType: 'memory.register_started', type: 'info' },
  'memory.register_finished': { eventType: 'memory.register_finished', type: 'info' },
  'memory.context_injected': { eventType: 'memory.context_injected', type: 'info' },
  'memory.feedback_evaluated': { eventType: 'memory.feedback_evaluated', type: 'checkpoint' },
  'system.warning': { eventType: 'warning', type: 'warning' },
  'system.error': { eventType: 'error', type: 'error' },
};

export function normalizeRunEventToLegacy(input: {
  event: RunEventBase;
  legacyPayload?: unknown;
}): {
  actor: string;
  type: 'info' | 'warning' | 'error' | 'checkpoint';
  eventType: string;
  message: string;
  timestamp: Date;
  payloadJson: { runEvent: RunEventBase; legacyPayload?: unknown };
} {
  const mapping = LEGACY_MAPPING[input.event.type];
  const type = input.event.severity === 'error' ? 'error' : mapping.type;
  return {
    actor: input.event.actor,
    type,
    eventType: mapping.eventType,
    message: input.event.message,
    timestamp: new Date(input.event.timestamp),
    payloadJson: {
      runEvent: input.event,
      ...(input.legacyPayload === undefined ? {} : { legacyPayload: input.legacyPayload }),
    },
  };
}
