import type { ReplayResult, RunEventBase } from '../run-events/types';

export type MemoryCandidateKind = 'rule' | 'procedure' | 'warning' | 'verification';
export type MemoryCandidateConfidence = 'low' | 'medium' | 'high';
export type MemoryCandidateStatus = 'draft' | 'approved' | 'rejected' | 'registered' | 'failed';

export type IncludedMemoryRef = {
  kind: 'candidate' | 'memory' | 'procedure' | 'unknown';
  sourceRunId?: string;
  candidateId?: string;
  externalId?: string;
  title?: string;
  confidence?: 'low' | 'medium' | 'high';
};

export type LearningCandidate = {
  id: string;
  version: 1;
  sourceRunId: string;
  sourceTaskId: string;
  sourceEventIds: string[];
  kind: MemoryCandidateKind;
  title: string;
  body: string;
  appliesTo: {
    repositoryId?: string;
    repoPath?: string;
    domains?: string[];
    technologies?: string[];
    changeTypes?: string[];
  };
  confidence: MemoryCandidateConfidence;
  status: MemoryCandidateStatus;
  createdAt: string;
  approvedAt?: string;
  registeredAt?: string;
  externalRef?: {
    target: 'context-still';
    id?: string;
  };
};

export type ContextCompileSnapshot = {
  compiledPrompt: string;
  source: 'context-still' | 'fallback';
  degraded: boolean;
  degradedReason?: string;
  blueprintPlanning?: unknown;
  request: {
    repositoryPath: string;
    taskTitle: string;
    taskDescriptionDigest: string;
  };
  result: {
    digest: string;
    charCount: number;
    sourceMetadata?: unknown;
    includedMemoryRefs: IncludedMemoryRef[];
  };
};

export type MemoryFeedbackEvaluation = {
  baselineRunId: string;
  followupRunId: string;
  candidateIds: string[];
  verdict: 'effective' | 'ineffective' | 'inconclusive' | 'not_injected';
  reasons: string[];
  evidenceEventIds: string[];
};

export type RunLedgerView = {
  runId: string;
  events: RunEventBase[];
  terminal?: ReplayResult['terminal'];
};

export type EvaluateMemoryFeedbackInput = {
  baselineRun: ReplayResult | RunLedgerView;
  followupRun: ReplayResult | RunLedgerView;
  candidateIds: string[];
};
