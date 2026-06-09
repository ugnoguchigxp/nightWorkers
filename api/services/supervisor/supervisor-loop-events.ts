import * as repo from '../../modules/nightworkers/nightworkers.repository';
import type { RunEventActor, RunEventSeverity, RunEventType } from '../run-events/types';
import type { SupervisorLlmDebugEvent } from './llm-provider';

export type AgentEventType =
  | 'run.started'
  | 'round1.prompt_built'
  | 'round1.parsed'
  | 'procedure.loaded'
  | 'round2.prompt_built'
  | 'round2.parsed'
  | 'round2.invalid'
  | 'tool.validation_failed'
  | 'tool.started'
  | 'tool.finished'
  | 'tool.failed'
  | 'job.switched'
  | 'finalize.received'
  | 'run.completed'
  | 'run.needs_human'
  | 'run.failed';

export function mapAgentEventToRunEventType(type: AgentEventType): RunEventType {
  if (type === 'tool.started') return 'tool.call_started';
  if (type === 'tool.finished' || type === 'tool.failed') return 'tool.call_finished';
  if (type === 'round1.parsed' || type === 'round2.parsed') return 'supervisor.decision';
  if (type === 'run.failed') return 'system.error';
  if (type === 'run.needs_human') return 'system.warning';
  return 'system.info';
}

export function eventActor(type: AgentEventType): RunEventActor {
  if (type.startsWith('tool.')) return 'worker';
  if (type.startsWith('round')) return 'supervisor';
  return 'runtime';
}

export function eventMessage(type: AgentEventType): string {
  return `[SchemaFirstAgent] ${type}`;
}

export async function createSupervisorRunEvent(input: {
  runId: string;
  taskId?: string;
  iteration?: number;
  type: RunEventType;
  severity: RunEventSeverity;
  actor: RunEventActor;
  message: string;
  data?: Record<string, unknown>;
  payloadJson?: Record<string, unknown>;
}) {
  const data =
    input.iteration === undefined
      ? input.data || {}
      : { iteration: input.iteration, ...(input.data || {}) };
  await repo.createRunEvent(
    {
      version: 1,
      runId: input.runId,
      taskId: input.taskId,
      timestamp: new Date().toISOString(),
      type: input.type,
      severity: input.severity,
      actor: input.actor,
      message: input.message,
      data,
    },
    { payloadJson: input.payloadJson || {} }
  );
}

export async function createSupervisorLlmRunEvent(input: {
  runId: string;
  taskId: string;
  iteration: number;
  event: SupervisorLlmDebugEvent;
}) {
  await createSupervisorRunEvent({
    runId: input.runId,
    taskId: input.taskId,
    iteration: input.iteration,
    type: input.event.type,
    severity: input.event.severity,
    actor: 'supervisor',
    message: input.event.message,
    data: input.event.data || {},
    payloadJson: {
      agentEventType: input.event.type,
      ...(input.event.data || {}),
    },
  });
}
