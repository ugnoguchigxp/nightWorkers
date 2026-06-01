import { describe, expect, it } from 'vitest';
import { RunBudgetController } from '../api/services/run-control/run-budget-controller';
import { decideRunOutcome } from '../api/services/run-control/run-outcome-gate';

describe('RunControl', () => {
  describe('RunOutcomeGate', () => {
    it('keeps needs_human and never upgrades to completed automatically', () => {
      const outcome = decideRunOutcome({
        supervisor: {
          finalReport: 'Need help',
          terminalState: 'needs_human',
          summary: 'manual step required',
          stoppedBy: 'decision',
          riskLevel: 'high',
        },
      });
      expect(outcome.status).toBe('needs_human');
    });

    it('maps completed supervisor result to needs_review by default', () => {
      const outcome = decideRunOutcome({
        supervisor: {
          finalReport: 'Done',
          terminalState: 'completed',
          summary: 'completed',
          stoppedBy: 'decision',
          riskLevel: 'low',
        },
      });
      expect(outcome.status).toBe('needs_review');
    });

    it('accepts explicit human complete action', () => {
      const outcome = decideRunOutcome({
        supervisor: {
          finalReport: 'Done',
          terminalState: 'needs_review',
          summary: 'waiting for review',
          stoppedBy: 'decision',
          riskLevel: 'low',
        },
        humanAction: 'complete',
      });
      expect(outcome.status).toBe('completed');
    });
  });

  describe('RunBudgetController', () => {
    it('stops after repeated same tool action', () => {
      const c = new RunBudgetController({
        maxIterations: 10,
        maxToolCalls: 10,
        maxRepeatedAction: 3,
        maxMissingToolCalls: 3,
        timeoutSeconds: 60,
      });
      expect(c.onIterationStart().allowed).toBe(true);
      expect(c.onToolCall('find_file', { fileMask: '*.ts' }).allowed).toBe(true);
      expect(c.onToolCall('find_file', { fileMask: '*.ts' }).allowed).toBe(true);
      const stop = c.onToolCall('find_file', { fileMask: '*.ts' });
      expect(stop.allowed).toBe(false);
      expect(stop.reason).toBe('repeat_action');
    });

    it('stops after repeated missing toolCall', () => {
      const c = new RunBudgetController({
        maxIterations: 10,
        maxToolCalls: 10,
        maxRepeatedAction: 3,
        maxMissingToolCalls: 3,
        timeoutSeconds: 60,
      });
      expect(c.onMissingToolCall().allowed).toBe(true);
      expect(c.onMissingToolCall().allowed).toBe(true);
      const stop = c.onMissingToolCall();
      expect(stop.allowed).toBe(false);
      expect(stop.reason).toBe('missing_tool_call');
    });
  });
});
