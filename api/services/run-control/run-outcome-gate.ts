import type { OutcomeGateInput, OutcomeGateResult } from './types';

export function decideRunOutcome(input: OutcomeGateInput): OutcomeGateResult {
  const { supervisor, humanAction, safetyViolation, verificationPassed, budgetStopped } = input;

  if (humanAction) {
    if (humanAction === 'cancel') {
      return {
        status: 'cancelled',
        reason: 'human_review',
        summary: 'Human review cancelled run.',
      };
    }
    return {
      status: 'completed',
      reason: 'human_review',
      summary: 'Human review marked run complete.',
    };
  }

  if (safetyViolation) {
    return {
      status: 'needs_human',
      reason: 'policy_violation',
      summary: 'Stopped by policy violation.',
    };
  }

  if (supervisor.stoppedBy === 'policy') {
    return {
      status: 'needs_human',
      reason: 'policy_violation',
      summary: supervisor.summary || 'Stopped by policy.',
    };
  }

  if (supervisor.stoppedBy === 'hook') {
    return {
      status: supervisor.terminalState === 'needs_human' ? 'needs_human' : 'blocked',
      reason: 'hook_blocked',
      summary: supervisor.summary || 'Stopped by agent hook.',
    };
  }

  if (budgetStopped) {
    if (supervisor.terminalState === 'timed_out') {
      return { status: 'timed_out', reason: 'budget_exceeded', summary: supervisor.summary };
    }
    return { status: 'blocked', reason: 'budget_exceeded', summary: supervisor.summary };
  }

  if (supervisor.stoppedBy === 'tool_failure') {
    return { status: 'needs_human', reason: 'tool_failure_limit', summary: supervisor.summary };
  }

  if (supervisor.terminalState === 'needs_human') {
    return { status: 'needs_human', reason: 'supervisor_needs_human', summary: supervisor.summary };
  }

  if (supervisor.terminalState === 'failed') {
    return { status: 'failed', reason: 'runner_crashed', summary: supervisor.summary };
  }

  if (supervisor.terminalState === 'timed_out') {
    return { status: 'timed_out', reason: 'budget_exceeded', summary: supervisor.summary };
  }

  if (verificationPassed === false) {
    return {
      status: 'needs_human',
      reason: 'verification_failed',
      summary: 'Verification failed.',
    };
  }

  if (supervisor.terminalState === 'completed') {
    return {
      status: 'needs_review',
      reason: 'supervisor_completed',
      summary: supervisor.summary || 'Run completed and is waiting for review.',
    };
  }

  return { status: 'needs_review', reason: 'supervisor_completed', summary: supervisor.summary };
}
