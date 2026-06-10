import { describe, expect, it } from 'vitest';
import {
  assertRunStatusTransition,
  runStatusTransitionTable,
} from '../api/modules/nightworkers/nightworkers.run-orchestration.service';

describe('run orchestration status transitions', () => {
  it('documents the active and terminal run transition table', () => {
    expect(runStatusTransitionTable).toMatchObject({
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
    });
  });

  it('allows self transitions and declared forward transitions', () => {
    expect(() => assertRunStatusTransition('running', 'running')).not.toThrow();
    expect(() => assertRunStatusTransition('running', 'finalizing')).not.toThrow();
    expect(() => assertRunStatusTransition('finalizing', 'needs_review')).not.toThrow();
    expect(() => assertRunStatusTransition('needs_review', 'completed')).not.toThrow();
  });

  it('rejects undeclared transitions before repository updates can persist them', () => {
    expect(() => assertRunStatusTransition('completed', 'running')).toThrow(
      /Invalid run status transition: completed -> running/
    );
    expect(() => assertRunStatusTransition('failed', 'completed')).toThrow(
      /Invalid run status transition: failed -> completed/
    );
    expect(() => assertRunStatusTransition('ready', 'completed')).toThrow(
      /Invalid run status transition: ready -> completed/
    );
  });
});
