import * as repo from '../../modules/nightworkers/nightworkers.repository';
import type { AgentRuntimeEvent, AgentRuntimeSink } from './types';

type EventMapping = {
  actor: 'system' | 'supervisor' | 'worker' | 'human';
  type: 'info' | 'warning' | 'error' | 'checkpoint' | 'state_change';
  eventType: string;
};

const EVENT_MAPPING: Record<AgentRuntimeEvent['type'], EventMapping> = {
  runtime_started: { actor: 'system', type: 'info', eventType: 'state_change' },
  turn_started: { actor: 'supervisor', type: 'checkpoint', eventType: 'supervisor_decision' },
  model_response_started: { actor: 'supervisor', type: 'info', eventType: 'info' },
  model_response_delta: { actor: 'supervisor', type: 'info', eventType: 'info' },
  supervisor_decision: {
    actor: 'supervisor',
    type: 'checkpoint',
    eventType: 'supervisor_decision',
  },
  tool_call_started: { actor: 'worker', type: 'info', eventType: 'tool_call' },
  tool_call_progress: { actor: 'worker', type: 'info', eventType: 'tool_call' },
  tool_call_finished: { actor: 'worker', type: 'info', eventType: 'tool_result' },
  verification_started: { actor: 'supervisor', type: 'checkpoint', eventType: 'state_change' },
  verification_finished: { actor: 'supervisor', type: 'checkpoint', eventType: 'state_change' },
  diff_collected: { actor: 'worker', type: 'checkpoint', eventType: 'tool_result' },
  runtime_finished: { actor: 'supervisor', type: 'checkpoint', eventType: 'final_report' },
  runtime_error: { actor: 'system', type: 'error', eventType: 'state_change' },
};

export function createLedgerSink(taskRunId: string): AgentRuntimeSink {
  return {
    async emit(event: AgentRuntimeEvent) {
      const mapped = EVENT_MAPPING[event.type];
      await repo.createTaskEvent({
        taskRunId,
        actor: mapped.actor,
        type: mapped.type,
        eventType: mapped.eventType,
        message: event.message.slice(0, 1000),
        payloadJson: event.payload ?? null,
      });
    },
  };
}
