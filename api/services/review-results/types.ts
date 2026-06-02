import type { OutcomeGateResult, RunOutcomeReason, RunOutcomeStatus } from '../run-control/types';

export type ReviewAction = 'complete' | 'cancel';

export type ReviewVerdict = 'approved' | 'changes_requested' | 'cancelled';

export type ReviewEvidenceRef =
  | { kind: 'run_event'; eventId: string; seq?: number; eventType?: string }
  | { kind: 'diff'; runId: string; bytes?: number; hasChanges?: boolean }
  | { kind: 'final_report'; runId: string }
  | { kind: 'verification'; eventId?: string; passed?: boolean; command?: string }
  | { kind: 'policy'; eventId?: string; code?: string; message?: string }
  | { kind: 'artifact'; artifactId: string; artifactKind?: string }
  | { kind: 'changed_file'; path: string; added?: number; deleted?: number };

export type ReviewFindingSeverity = 'info' | 'warning' | 'blocking';

export interface ReviewFinding {
  severity: ReviewFindingSeverity;
  title: string;
  body?: string;
  filePath?: string;
  line?: number;
  evidenceRefs?: ReviewEvidenceRef[];
}

export interface ReviewResult {
  version: 1;
  id: string;
  runId: string;
  taskId: string;
  reviewer: {
    type: 'human' | 'system' | 'agent';
    id?: string;
    label?: string;
  };
  action: ReviewAction;
  verdict: ReviewVerdict;
  note?: string;
  statusBefore: string;
  statusAfter: string;
  outcome: {
    status: RunOutcomeStatus;
    reason: RunOutcomeReason;
    summary: string;
  };
  evidenceRefs: ReviewEvidenceRef[];
  findings: ReviewFinding[];
  humanCallouts: ReviewFinding[];
  agentFollowUps: string[];
  suggestedNextTasks: string[];
  createdAt: string;
}

export type ReviewRunRequest = {
  action: ReviewAction;
  note?: string;
  evidenceRefs?: ReviewEvidenceRef[];
  findings?: ReviewFinding[];
  humanCallouts?: ReviewFinding[];
  agentFollowUps?: string[];
  suggestedNextTasks?: string[];
};

export type ReviewRunResponse = {
  ok: boolean;
  status: string;
  outcome: OutcomeGateResult;
  reviewResult: ReviewResult;
};
