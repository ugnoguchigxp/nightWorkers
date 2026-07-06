import type { ProjectSafetyPolicy } from './core';
import type { LlmProvider, ModelOption, ThinkingDepthOption } from './provider-settings';

export type CreateProjectInput = {
  name: string;
  localPath: string;
  branch?: string;
  safetyPolicy?: ProjectSafetyPolicy;
};

export type UpdateProjectInput = {
  queueEnabled?: boolean;
  maxConcurrentSessions?: number;
  safetyPolicy?: ProjectSafetyPolicy;
};

export type CreateSessionInput = {
  repositoryId: string;
  title: string;
  description: string;
  objective: string;
  acceptanceCriteria: string;
};

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

export type ReviewFinding = {
  severity: 'info' | 'warning' | 'blocking';
  title: string;
  body?: string;
  filePath?: string;
  line?: number;
  evidenceRefs?: ReviewEvidenceRef[];
};

export type ReviewOutcome = {
  status:
    | 'needs_review'
    | 'completed'
    | 'needs_human'
    | 'failed'
    | 'blocked'
    | 'timed_out'
    | 'cancelled';
  reason:
    | 'supervisor_completed'
    | 'supervisor_needs_human'
    | 'budget_exceeded'
    | 'tool_failure_limit'
    | 'policy_violation'
    | 'hook_blocked'
    | 'verification_failed'
    | 'runner_crashed'
    | 'human_review';
  summary: string;
};

export type ReviewResult = {
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
  outcome: ReviewOutcome;
  evidenceRefs: ReviewEvidenceRef[];
  findings: ReviewFinding[];
  humanCallouts: ReviewFinding[];
  agentFollowUps: string[];
  suggestedNextTasks: string[];
  createdAt: string;
};

export type ReviewRecommendationLevel = 'none' | 'optional' | 'recommended' | 'required';

export type ReviewRecommendationReason = {
  code:
    | 'minor_no_review_needed'
    | 'large_diff'
    | 'many_changed_files'
    | 'verification_missing'
    | 'verification_failed'
    | 'acceptance_evidence_missing'
    | 'todo_unresolved'
    | 'self_review_unresolved'
    | 'queue_recovery_present'
    | 'queue_run_status_mismatch'
    | 'security_sensitive_change'
    | 'security_plugin_missing'
    | 'schema_or_migration_change'
    | 'public_contract_change'
    | 'final_report_evidence_mismatch';
  severity: 'info' | 'warning' | 'blocking';
  label: string;
  evidenceRefs: ReviewEvidenceRef[];
};

export type ReviewRecommendation = {
  version: 1;
  id: string;
  runId: string;
  taskId: string;
  repositoryId: string;
  level: ReviewRecommendationLevel;
  defaultAction: 'skip' | 'offer_review' | 'require_review';
  reasons: ReviewRecommendationReason[];
  createdAt: string;
  updatedAt: string;
};

export type ReviewSectionKind =
  | 'acceptance_evidence'
  | 'verification_evidence'
  | 'self_review_followups'
  | 'queue_recovery'
  | 'security_review'
  | 'findings'
  | 'prompt_suggestions'
  | 'knowledge_candidates';

export type ReviewSectionRequirement = 'required' | 'recommended' | 'optional' | 'omitted';
export type ReviewSectionProgress = 'not_started' | 'running' | 'done' | 'blocked' | 'needs_human';

export type ReviewStatusArtifact = {
  version: 1;
  reviewSessionId: string;
  runId: string;
  taskId: string;
  recommendation: ReviewRecommendation;
  sections: Array<{
    kind: ReviewSectionKind;
    requirement: ReviewSectionRequirement;
    progress: ReviewSectionProgress;
    reason: string;
    artifactId: string | null;
    findingCounts: {
      blocking: number;
      warning: number;
      info: number;
    };
  }>;
  finalActionGate: {
    canApprove: boolean;
    blockingReason: string | null;
    unresolvedBlockingFindingIds: string[];
    requiredSectionKindsRemaining: ReviewSectionKind[];
  };
  promptSuggestionCount: number;
  knowledgeCandidateCount: number;
  securityHandoffCount?: number;
};

export type ReviewSession = {
  id: string;
  runId: string;
  taskId: string;
  repositoryId: string;
  status:
    | 'not_started'
    | 'in_progress'
    | 'approved'
    | 'changes_requested'
    | 'needs_human'
    | 'cancelled';
  recommendationId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  finalAction: string | null;
  finalNote: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ReviewModeFinding = {
  id: string;
  reviewSessionId: string;
  runId: string;
  taskId: string;
  severity: 'info' | 'warning' | 'blocking';
  title: string;
  body: string | null;
  disposition:
    | 'human_callout'
    | 'agent_followup'
    | 'prompt_suggestion'
    | 'security_plugin_handoff'
    | 'knowledge_candidate'
    | 'accepted_risk'
    | 'ignored'
    | null;
  dispositionStatus: 'unresolved' | 'accepted' | 'converted' | 'dismissed';
  dispositionNote: string | null;
  evidenceRefs: ReviewEvidenceRef[];
  createdGoalId: string | null;
  createdTaskProposalId: string | null;
  contextStillCandidateId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ReviewArtifact = {
  id: string;
  reviewSessionId: string;
  runId: string;
  taskId: string;
  kind: 'review_status' | ReviewSectionKind | 'security_handoff';
  status: ReviewSectionProgress;
  artifact: unknown;
  sourceEvidenceRefs: ReviewEvidenceRef[];
  createdAt: string;
  updatedAt: string;
};

export type ReviewKnowledgeCandidate = {
  id: string;
  reviewSessionId: string;
  findingId: string;
  candidateType: 'rule' | 'procedure' | 'failure_pattern';
  title: string;
  body: string;
  avoid: string | null;
  prefer: string | null;
  status: 'draft' | 'sent' | 'discarded' | 'send_failed';
  contextStillCandidateId: string | null;
  sendError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ReviewPromptSuggestion = {
  id: string;
  reviewSessionId: string;
  findingId: string;
  runId: string;
  taskId: string;
  repositoryId: string;
  title: string;
  prompt: string;
  expectedOutcome: string;
  acceptanceCriteria: string;
  verificationHint: string;
  evidenceRefs: ReviewEvidenceRef[];
  status: 'draft' | 'used' | 'dismissed';
  useCount: number;
  lastUsedAt: string | null;
  dismissedAt: string | null;
  createdMessageId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ReviewSecurityHandoff = {
  id: string;
  reviewSessionId: string;
  findingId: string;
  runId: string;
  taskId: string;
  repositoryId: string;
  title: string;
  summary: string;
  requestedIntegration: string | null;
  status: 'needs_configuration' | 'requested' | 'deferred';
  changedPaths: string[];
  evidenceRefs: ReviewEvidenceRef[];
  handoffArtifact: unknown | null;
  createdAt: string;
  updatedAt: string;
};

export type ReviewSessionDetail = {
  session: ReviewSession;
  recommendation: ReviewRecommendation;
  statusArtifact: ReviewStatusArtifact;
  artifacts: ReviewArtifact[];
  findings: ReviewModeFinding[];
  knowledgeCandidates: ReviewKnowledgeCandidate[];
  promptSuggestions: ReviewPromptSuggestion[];
  securityHandoffs: ReviewSecurityHandoff[];
};

export const THINKING_DEPTH_OPTIONS: ThinkingDepthOption[] = [
  { value: 'low', label: '低い' },
  { value: 'medium', label: '標準' },
  { value: 'high', label: '高い' },
  { value: 'very_high', label: '非常に高い' },
];

export const DEFAULT_MODEL_OPTIONS: ModelOption[] = [
  { value: 'gpt-5.5', label: 'gpt-5.5' },
  { value: 'gpt-5.4-mini', label: 'gpt-5.4-mini' },
  { value: 'gpt-5-mini', label: 'gpt-5-mini' },
];

export const PROVIDER_MODEL_OPTIONS: Record<LlmProvider, ModelOption[]> = {
  azure: [
    { value: 'gpt-5.5', label: 'gpt-5.5' },
    { value: 'gpt-5.4-mini', label: 'gpt-5.4-mini' },
    { value: 'gpt-5-mini', label: 'gpt-5-mini' },
  ],
  openai: [
    { value: 'gpt-5.5', label: 'gpt-5.5' },
    { value: 'gpt-5.4-mini', label: 'gpt-5.4-mini' },
    { value: 'gpt-5-mini', label: 'gpt-5-mini' },
    { value: 'gpt-4.1-mini', label: 'gpt-4.1-mini' },
  ],
  bedrock: [
    {
      value: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
      label: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
    },
  ],
  codex: [
    { value: 'gpt-5.5', label: 'gpt-5.5' },
    { value: 'gpt-5.4-mini', label: 'gpt-5.4-mini' },
    { value: 'gpt-5-mini', label: 'gpt-5-mini' },
  ],
};
