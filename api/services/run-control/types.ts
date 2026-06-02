export type RunOutcomeStatus =
  | 'needs_review'
  | 'completed'
  | 'needs_human'
  | 'failed'
  | 'blocked'
  | 'timed_out'
  | 'cancelled';

export type RunOutcomeReason =
  | 'supervisor_completed'
  | 'supervisor_needs_human'
  | 'budget_exceeded'
  | 'tool_failure_limit'
  | 'policy_violation'
  | 'verification_failed'
  | 'runner_crashed'
  | 'human_review';

export type RunBudgetConfig = {
  maxIterations: number;
  maxToolCalls: number;
  maxRepeatedAction: number;
  maxMissingToolCalls: number;
  timeoutSeconds: number;
};

export type BudgetDecisionReason =
  | 'iteration_limit'
  | 'tool_limit'
  | 'deadline'
  | 'repeat_action'
  | 'missing_tool_call'
  | 'tool_failure';

export type BudgetDecision = {
  allowed: boolean;
  reason?: BudgetDecisionReason;
  detail?: Record<string, unknown>;
};

export type SupervisorLoopResult = {
  finalReport: string;
  terminalState: 'completed' | 'needs_review' | 'needs_human' | 'failed' | 'timed_out' | 'blocked';
  summary: string;
  stoppedBy: 'decision' | 'budget' | 'tool_failure' | 'llm_error' | 'missing_tool_call' | 'policy';
  riskLevel: 'low' | 'medium' | 'high';
};

export type OutcomeGateInput = {
  supervisor: SupervisorLoopResult;
  hasDiff?: boolean;
  verificationPassed?: boolean;
  safetyViolation?: boolean;
  budgetStopped?: boolean;
  humanAction?: 'complete' | 'request_follow_up' | 'cancel' | 'accept_risk';
};

export type OutcomeGateResult = {
  status: RunOutcomeStatus;
  reason: RunOutcomeReason;
  summary: string;
};
