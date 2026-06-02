import type { AgentRuntimeResult } from '../agent-runtime/types';
import { digestText } from '../memory-feedback/hash';
import type { TodoCompletionGateResult, TodoRuntimeTodo } from './types';

export function evaluateTodoCompletionGate(input: {
  todo: TodoRuntimeTodo;
  runtimeResult: AgentRuntimeResult;
  outcomeStatus: string;
}): TodoCompletionGateResult {
  const { todo, runtimeResult, outcomeStatus } = input;
  const diffBytes = Buffer.byteLength(runtimeResult.diffPatch || '', 'utf8');
  const hasTests = runtimeResult.testResults !== undefined && runtimeResult.testResults !== null;
  const terminalOk = ['completed', 'needs_review'].includes(runtimeResult.terminalState);
  const outcomeOk = ['completed', 'needs_review'].includes(outcomeStatus);
  const policyStopped = runtimeResult.stoppedBy === 'policy';
  const budgetStopped = runtimeResult.stoppedBy === 'budget';
  const passed = terminalOk && outcomeOk && !policyStopped && !budgetStopped;

  let status: TodoCompletionGateResult['status'] = passed ? 'passed' : 'failed';
  if (
    policyStopped ||
    outcomeStatus === 'needs_human' ||
    runtimeResult.terminalState === 'needs_human'
  ) {
    status = 'needs_human';
  }

  const reason = passed
    ? 'Runtime completed this planned todo without a terminal gate failure.'
    : `Runtime stopped with terminalState=${runtimeResult.terminalState}, stoppedBy=${runtimeResult.stoppedBy}, outcome=${outcomeStatus}.`;

  return {
    version: 1,
    todoId: todo.id,
    todoSeq: todo.seq,
    procedureId: todo.procedureId,
    status,
    passed,
    reason,
    checks: [
      {
        id: 'terminal_state',
        passed: terminalOk,
        evidence: `terminalState=${runtimeResult.terminalState}`,
      },
      {
        id: 'run_outcome',
        passed: outcomeOk,
        evidence: `outcome=${outcomeStatus}`,
      },
      {
        id: 'stop_reason',
        passed: !policyStopped && !budgetStopped,
        evidence: `stoppedBy=${runtimeResult.stoppedBy}`,
      },
    ],
    evidence: {
      terminalState: runtimeResult.terminalState,
      stoppedBy: runtimeResult.stoppedBy,
      riskLevel: runtimeResult.riskLevel,
      summaryDigest: digestText(runtimeResult.summary || ''),
      finalReportDigest: digestText(runtimeResult.finalReport || ''),
      diffBytes,
      hasTests,
    },
  };
}

export function buildSkippedTodoGate(input: {
  todo: TodoRuntimeTodo;
  reason: string;
  runtimeResult: AgentRuntimeResult;
}): TodoCompletionGateResult {
  const { todo, reason, runtimeResult } = input;
  return {
    version: 1,
    todoId: todo.id,
    todoSeq: todo.seq,
    procedureId: todo.procedureId,
    status: 'skipped',
    passed: false,
    reason,
    checks: [{ id: 'dependency_or_previous_failure', passed: false, evidence: reason }],
    evidence: {
      terminalState: runtimeResult.terminalState,
      stoppedBy: runtimeResult.stoppedBy,
      riskLevel: runtimeResult.riskLevel,
      summaryDigest: digestText(runtimeResult.summary || ''),
      finalReportDigest: digestText(runtimeResult.finalReport || ''),
      diffBytes: Buffer.byteLength(runtimeResult.diffPatch || '', 'utf8'),
      hasTests: runtimeResult.testResults !== undefined && runtimeResult.testResults !== null,
    },
  };
}
