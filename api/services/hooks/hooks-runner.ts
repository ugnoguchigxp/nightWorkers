import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { listEffectiveAgentHooks } from './hooks-effective-settings';
import { hookMatchesInput } from './hooks-matcher';
import { parseHookOutput } from './hooks-output';
import { updateAgentHookLastRun } from './hooks-settings';
import type {
  AgentHookConfig,
  AgentHookInput,
  AgentHookRunEvent,
  AgentHookRunResult,
  AgentHookRunSummary,
  NormalizedHookDecision,
} from './types';

const DEFAULT_TIMEOUT_SECONDS = 30;
const MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_CONTEXT_CHARS = 10_000;

export type RunAgentHooksOptions = {
  input: AgentHookInput;
  hooks?: AgentHookConfig[];
  repoRoot?: string;
  onEvent?: (event: AgentHookRunEvent) => Promise<void>;
};

export async function runAgentHooks(options: RunAgentHooksOptions): Promise<AgentHookRunResult> {
  const hooks = (options.hooks ?? listEffectiveAgentHooks(options.repoRoot)).filter((hook) =>
    hookMatchesInput(hook, options.input)
  );
  const summaries: AgentHookRunSummary[] = [];
  const contexts: string[] = [];
  let aggregate: NormalizedHookDecision = { decision: 'no_decision' };

  for (const hook of hooks) {
    await options.onEvent?.(buildHookEvent('hook.started', hook, options.input, 'info', 'started'));
    const started = performance.now();
    let ok = true;
    let message = 'Hook completed';
    let decision: NormalizedHookDecision = { decision: 'no_decision' };
    try {
      const rawResult =
        hook.handler.type === 'command'
          ? await runCommandHook(hook, options.input, options.repoRoot)
          : await runHttpHook(hook, options.input);
      decision = parseHookOutput(rawResult.stdout);
      if (rawResult.exitCode !== 0) {
        ok = false;
        message =
          rawResult.stderr || rawResult.stdout || `Hook exited with code ${rawResult.exitCode}`;
        if (isFailClosed(hook, options.input)) {
          decision = failClosedDecision(
            options.input.hook_event_name,
            sanitizeHookMessage(message)
          );
        }
      } else {
        message = rawResult.stderr || rawResult.stdout || 'Hook completed';
      }
    } catch (err) {
      ok = false;
      message = err instanceof Error ? err.message : String(err);
      if (isFailClosed(hook, options.input)) {
        decision = failClosedDecision(options.input.hook_event_name, sanitizeHookMessage(message));
      }
    }
    const durationMs = Math.max(0, Math.round(performance.now() - started));
    const lastRun = {
      ok,
      checkedAt: new Date().toISOString(),
      message: sanitizeHookMessage(message).slice(0, 500),
      durationMs,
    };
    if (shouldPersistHookLastRun(hook)) {
      updateAgentHookLastRun(hook.id, lastRun);
    }
    const summary = {
      hookId: hook.id,
      hookName: hook.name,
      event: hook.event,
      ok,
      durationMs,
      decision,
      message: lastRun.message,
    };
    summaries.push(summary);
    await options.onEvent?.(
      buildHookEvent(
        ok ? 'hook.finished' : 'hook.failed',
        hook,
        options.input,
        ok ? 'info' : 'error',
        sanitizeHookMessage(message),
        {
          durationMs,
          decision: decision.decision,
          reason: decision.reason,
        }
      )
    );
    if (decision.decision === 'deny' || decision.decision === 'block') {
      aggregate = decision;
      await options.onEvent?.(
        buildHookEvent('hook.blocked', hook, options.input, 'error', decision.reason || message, {
          durationMs,
          decision: decision.decision,
          reason: decision.reason || message,
        })
      );
    } else if (
      aggregate.decision !== 'deny' &&
      aggregate.decision !== 'block' &&
      decision.decision !== 'no_decision'
    ) {
      aggregate = decision;
    }
    if (decision.additionalContext) contexts.push(decision.additionalContext);
  }

  return {
    ...aggregate,
    additionalContext:
      contexts.join('\n\n').slice(0, MAX_CONTEXT_CHARS) || aggregate.additionalContext,
    runs: summaries,
  };
}

export async function runSingleAgentHookForTest(
  hook: AgentHookConfig,
  input: AgentHookInput,
  repoRoot = process.cwd()
): Promise<{ ok: boolean; message: string; durationMs: number }> {
  const started = performance.now();
  const result = await runAgentHooks({ input, hooks: [{ ...hook, enabled: true }], repoRoot });
  const durationMs = Math.max(0, Math.round(performance.now() - started));
  const failed = result.runs.find((run) => !run.ok);
  return {
    ok: !failed,
    message: failed?.message || result.reason || 'Hook test completed',
    durationMs,
  };
}

function failClosedDecision(
  event: AgentHookInput['hook_event_name'],
  reason: string
): NormalizedHookDecision {
  if (event === 'PreToolUse') return { decision: 'deny', reason };
  if (event === 'UserPromptSubmit' || event === 'Stop') return { decision: 'block', reason };
  return { decision: 'no_decision', reason };
}

function isFailClosed(hook: AgentHookConfig, input: AgentHookInput): boolean {
  if (typeof hook.handler.failClosed === 'boolean') return hook.handler.failClosed;
  return hook.handler.type === 'command' && input.hook_event_name === 'PreToolUse';
}

function shouldPersistHookLastRun(hook: AgentHookConfig): boolean {
  return (hook as { source?: string }).source !== 'codex_global';
}

function buildHookEvent(
  type: AgentHookRunEvent['type'],
  hook: AgentHookConfig,
  input: AgentHookInput,
  severity: AgentHookRunEvent['severity'],
  message: string,
  extra?: Record<string, unknown>
): AgentHookRunEvent {
  return {
    type,
    severity,
    message: `[Agent Hook] ${hook.name}: ${sanitizeHookMessage(message)}`,
    data: {
      hookId: hook.id,
      hookName: hook.name,
      hookEvent: hook.event,
      matcher: hook.matcher || '*',
      handlerType: hook.handler.type,
      ...(input.hook_event_name === 'PreToolUse' ||
      input.hook_event_name === 'PostToolUse' ||
      input.hook_event_name === 'PostToolUseFailure'
        ? { toolName: input.tool_name }
        : {}),
      ...sanitizeHookEventData(extra || {}),
    },
  };
}

function sanitizeHookEventData(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key,
      typeof value === 'string' ? sanitizeHookMessage(value) : value,
    ])
  );
}

async function runCommandHook(
  hook: AgentHookConfig,
  input: AgentHookInput,
  repoRoot?: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  if (hook.handler.type !== 'command') throw new Error('Hook handler is not command.');
  const timeoutSeconds = hook.handler.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
  const cwd = hook.handler.cwd || repoRoot || input.cwd || process.cwd();
  const env = { ...process.env, ...(hook.handler.env || {}) };
  const stdin = `${JSON.stringify(input)}\n`;
  const args = hook.handler.args || [];
  const child =
    args.length > 0
      ? spawn(hook.handler.command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
      : spawn(hook.handler.command, { cwd, env, shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
  return await collectChildProcess(child, stdin, timeoutSeconds);
}

async function runHttpHook(
  hook: AgentHookConfig,
  input: AgentHookInput
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  if (hook.handler.type !== 'http') throw new Error('Hook handler is not http.');
  const timeoutSeconds = hook.handler.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
  try {
    const res = await fetch(hook.handler.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...resolveAllowedEnvHeaders(hook.handler.headers || {}, hook.handler.allowedEnvVars || []),
      },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    const text = (await res.text()).slice(0, MAX_OUTPUT_BYTES);
    return {
      stdout: text,
      stderr: res.ok ? '' : `HTTP ${res.status}`,
      exitCode: res.ok ? 0 : 1,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function resolveAllowedEnvHeaders(
  headers: Record<string, string>,
  allowedEnvVars: string[]
): Record<string, string> {
  const allowed = new Set(allowedEnvVars);
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      value.replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (_match, name: string) =>
        allowed.has(name) ? (process.env[name] ?? '') : ''
      ),
    ])
  );
}

function sanitizeHookMessage(message: string): string {
  return message.replace(
    /(?:api[_-]?key|token|password|secret|authorization|bearer)\s*[:=]\s*['"]?[^\s'"]+/gi,
    '[redacted]'
  );
}

function collectChildProcess(
  child: ReturnType<typeof spawn>,
  stdin: string,
  timeoutSeconds: number
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Hook timed out after ${timeoutSeconds}s`));
    }, timeoutSeconds * 1000);
    child.stdout?.on('data', (chunk) => {
      stdout = boundedAppend(stdout, chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr = boundedAppend(stderr, chunk);
    });
    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve({ stdout, stderr, exitCode: code ?? 0 });
    });
    child.stdin?.write(stdin);
    child.stdin?.end();
  });
}

function boundedAppend(current: string, chunk: unknown): string {
  if (current.length >= MAX_OUTPUT_BYTES) return current;
  return `${current}${String(chunk)}`.slice(0, MAX_OUTPUT_BYTES);
}
