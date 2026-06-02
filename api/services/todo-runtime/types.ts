import type { AgentRuntimeResult } from '../agent-runtime/types';

export type TodoRuntimeStatus =
  | 'pending'
  | 'running'
  | 'passed'
  | 'failed'
  | 'skipped'
  | 'needs_human';

export type TodoRuntimeTodo = {
  id: string;
  seq: number;
  title: string;
  description?: string | null;
  taskType: string;
  status: string;
  procedureId?: string | null;
  procedureSnapshot?: unknown;
  statusReason?: string | null;
  startedAt?: Date | string | null;
  completedAt?: Date | string | null;
};

export type TodoCompletionGateStatus = 'passed' | 'failed' | 'needs_human' | 'skipped';

export type TodoCompletionGateResult = {
  version: 1;
  todoId: string;
  todoSeq: number;
  procedureId?: string | null;
  status: TodoCompletionGateStatus;
  passed: boolean;
  reason: string;
  checks: Array<{
    id: string;
    passed: boolean;
    evidence?: string;
  }>;
  evidence: {
    terminalState: AgentRuntimeResult['terminalState'];
    stoppedBy: AgentRuntimeResult['stoppedBy'];
    riskLevel: AgentRuntimeResult['riskLevel'];
    summaryDigest: string;
    finalReportDigest: string;
    diffBytes: number;
    hasTests: boolean;
  };
};

export type TodoStatusPatch = {
  todoId: string;
  status: Exclude<TodoRuntimeStatus, 'pending' | 'running'>;
  statusReason: string;
  completionGateResult: TodoCompletionGateResult;
  completedAt: Date;
};
