export type FinalJudgmentSource =
  | 'supervisor_final_response'
  | 'llm_repair_finalizer'
  | 'deterministic_fallback';

export type FinalJudgment = {
  version: 1;
  runId: string;
  taskId: string;
  status:
    | 'completed'
    | 'needs_review'
    | 'needs_human'
    | 'failed'
    | 'blocked'
    | 'timed_out'
    | 'cancelled';
  title: string;
  conclusion: string;
  evidenceSummary: string[];
  actionsTaken: string[];
  issues: string[];
  residualRisk: string[];
  debugReason?: string | null;
  source: FinalJudgmentSource;
  createdAt: string;
};

export type SupervisorResultLike = {
  finalReport?: string;
  summary?: string;
  terminalState?: string;
  stoppedBy?:
    | 'decision'
    | 'budget'
    | 'tool_failure'
    | 'llm_error'
    | 'missing_tool_call'
    | 'policy'
    | 'hook'
    | 'cancelled';
  riskLevel?: 'low' | 'medium' | 'high';
};

export type FinalJudgmentInput = {
  runId: string;
  taskId: string;
  outcomeStatus:
    | 'completed'
    | 'needs_review'
    | 'needs_human'
    | 'failed'
    | 'blocked'
    | 'timed_out'
    | 'cancelled';
  outcomeSummary?: string;
  supervisor: SupervisorResultLike;
  decisionTrace?: string;
};
