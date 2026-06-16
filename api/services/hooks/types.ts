import type { WorkerToolName } from '../tool-policy/types';

export const AGENT_HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'Stop',
  'SessionEnd',
] as const;

export type AgentHookEvent = (typeof AGENT_HOOK_EVENTS)[number];
export type AgentHookHandlerType = 'command' | 'http';

export type AgentHookLastRun = {
  ok: boolean;
  checkedAt: string;
  message: string;
  durationMs?: number;
};

export type AgentHookCommandHandler = {
  type: 'command';
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutSeconds?: number;
  failClosed?: boolean;
};

export type AgentHookHttpHandler = {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
  allowedEnvVars?: string[];
  timeoutSeconds?: number;
  failClosed?: boolean;
};

export type AgentHookHandler = AgentHookCommandHandler | AgentHookHttpHandler;

export type AgentHookConfig = {
  id: string;
  name: string;
  enabled: boolean;
  event: AgentHookEvent;
  matcher?: string;
  handler: AgentHookHandler;
  createdAt: string;
  updatedAt: string;
  lastRun?: AgentHookLastRun;
};

export type AgentHookInputBase = {
  hook_event_name: AgentHookEvent;
  session_id: string;
  run_id: string;
  task_id: string;
  repository_id?: string;
  cwd: string;
  timestamp: string;
  transcript_path?: string;
};

export type AgentHookInput =
  | (AgentHookInputBase & {
      hook_event_name: 'SessionStart' | 'SessionEnd';
      source: 'run_start' | 'run_end';
      payload?: Record<string, unknown>;
    })
  | (AgentHookInputBase & {
      hook_event_name: 'UserPromptSubmit';
      prompt: string;
    })
  | (AgentHookInputBase & {
      hook_event_name: 'PreToolUse' | 'PostToolUse' | 'PostToolUseFailure';
      tool_name: WorkerToolName;
      tool_input: Record<string, unknown>;
      tool_use_id: string;
      tool_result?: unknown;
      error?: string;
    })
  | (AgentHookInputBase & {
      hook_event_name: 'Stop';
      stop_reason: 'end_turn' | 'completed' | 'needs_review' | 'needs_human' | 'failed' | 'blocked';
      last_assistant_message?: string;
    });

export type NormalizedHookDecision = {
  decision: 'allow' | 'deny' | 'block' | 'continue' | 'no_decision';
  reason?: string;
  additionalContext?: string;
  modifiedArgs?: Record<string, unknown>;
};

export type AgentHookRunEvent = {
  type: 'hook.started' | 'hook.finished' | 'hook.blocked' | 'hook.failed';
  severity: 'info' | 'warning' | 'error';
  message: string;
  data: Record<string, unknown>;
};

export type AgentHookRunSummary = {
  hookId: string;
  hookName: string;
  event: AgentHookEvent;
  ok: boolean;
  durationMs: number;
  decision: NormalizedHookDecision;
  message: string;
};

export type AgentHookRunResult = {
  decision: 'allow' | 'deny' | 'block' | 'continue' | 'no_decision';
  reason?: string;
  additionalContext?: string;
  modifiedArgs?: Record<string, unknown>;
  runs: AgentHookRunSummary[];
};
