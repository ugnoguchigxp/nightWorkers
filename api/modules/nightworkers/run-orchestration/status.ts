import { AppError } from '../../../lib/errors';

export const runStatusTransitionTable = {
  ready: ['queued', 'running'],
  queued: ['running', 'ready', 'cancelled'],
  running: ['finalizing', 'needs_human', 'failed', 'cancelled'],
  finalizing: ['needs_review', 'completed', 'failed', 'needs_human', 'cancelled'],
  needs_review: ['completed', 'failed', 'needs_human'],
  completed: [],
  failed: [],
  needs_human: ['queued', 'running', 'failed', 'cancelled'],
  cancelled: ['queued', 'running'],
  timed_out: ['queued', 'running', 'failed'],
} as const satisfies Record<string, readonly string[]>;

export function assertRunStatusTransition(from: string, to: string) {
  if (from === to) return;
  const transitionTable: Record<string, readonly string[]> = runStatusTransitionTable;
  const allowed = transitionTable[from];
  if (!allowed?.includes(to)) {
    throw new AppError(
      409,
      'INVALID_RUN_STATUS_TRANSITION',
      `Invalid run status transition: ${from} -> ${to}`
    );
  }
}
