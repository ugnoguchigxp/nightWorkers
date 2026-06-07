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
    { value: 'gpt-5.4', label: 'gpt-5.4' },
    { value: 'gpt-5.4-mini', label: 'gpt-5.4-mini' },
    { value: 'gpt-5.3-codex', label: 'gpt-5.3-codex' },
    { value: 'gpt-5.3-codex-spark', label: 'gpt-5.3-codex-spark' },
  ],
};
