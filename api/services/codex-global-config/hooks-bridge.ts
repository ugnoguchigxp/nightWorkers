import { agentHookConfigSchema } from '../hooks/hooks-config-schema';
import type { AgentHookConfig, AgentHookEvent } from '../hooks/types';
import type { McpServerSettingsDiagnostic } from '../mcp/mcp-config-schema';
import { loadCodexGlobalConfig, sanitizeDiagnosticMessage } from './config-loader';
import { deterministicUuid } from './mcp-bridge';

export type EffectiveAgentHookSource = 'nightworkers_settings' | 'codex_global';

export type EffectiveAgentHook = AgentHookConfig & {
  source: EffectiveAgentHookSource;
};

export type CodexGlobalHooksResult = {
  hooks: EffectiveAgentHook[];
  diagnostics: McpServerSettingsDiagnostic[];
};

const supportedEvents = new Set<AgentHookEvent>([
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'Stop',
  'SessionEnd',
]);

export function listCodexGlobalAgentHooks(projectRoot = process.cwd()): CodexGlobalHooksResult {
  const loaded = loadCodexGlobalConfig(projectRoot);
  const diagnostics = [...loaded.diagnostics];
  const hooks: EffectiveAgentHook[] = [];

  for (const [name, rawHook] of Object.entries(readHooksObject(loaded.config))) {
    const hook = parseCodexGlobalHook(name, rawHook, diagnostics);
    if (hook) hooks.push(hook);
  }

  const notifyHook = parseNotifyHook(loaded.config.notify, diagnostics);
  if (notifyHook) hooks.push(notifyHook);

  return { hooks, diagnostics };
}

function readHooksObject(config: Record<string, unknown>): Record<string, unknown> {
  const rawHooks = config.agent_hooks ?? config.hooks;
  if (!rawHooks) return {};
  if (Array.isArray(rawHooks)) {
    return Object.fromEntries(rawHooks.map((hook, index) => [`hook_${index + 1}`, hook]));
  }
  if (typeof rawHooks === 'object') return rawHooks as Record<string, unknown>;
  return {};
}

function parseCodexGlobalHook(
  name: string,
  rawHook: unknown,
  diagnostics: McpServerSettingsDiagnostic[]
): EffectiveAgentHook | null {
  if (!rawHook || typeof rawHook !== 'object' || Array.isArray(rawHook)) {
    diagnostics.push({
      level: 'warning',
      path: `hooks.${name}`,
      message: `Skipped Codex global hook ${name}: hook must be an object.`,
    });
    return null;
  }
  const raw = rawHook as Record<string, unknown>;
  const rawEvent = String(raw.event || raw.hook_event_name || '');
  if (!supportedEvents.has(rawEvent as AgentHookEvent)) {
    diagnostics.push({
      level: 'warning',
      path: `hooks.${name}.event`,
      message: `Skipped Codex global hook ${name}: unsupported event ${rawEvent || '<missing>'}.`,
    });
    return null;
  }

  try {
    const now = new Date(0).toISOString();
    const parsed = agentHookConfigSchema.parse({
      id: deterministicUuid(`codex_global:hook:${name}`),
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : name,
      enabled: typeof raw.enabled === 'boolean' ? raw.enabled : true,
      event: rawEvent,
      matcher: typeof raw.matcher === 'string' ? raw.matcher : undefined,
      handler: parseHookHandler(name, raw),
      createdAt: now,
      updatedAt: now,
    });
    return { ...parsed, source: 'codex_global' };
  } catch (err) {
    diagnostics.push({
      level: 'warning',
      path: `hooks.${name}`,
      message: `Skipped Codex global hook ${name}: ${sanitizeDiagnosticMessage(
        err instanceof Error ? err.message : String(err)
      )}`,
    });
    return null;
  }
}

function parseHookHandler(name: string, raw: Record<string, unknown>) {
  const handler =
    raw.handler && typeof raw.handler === 'object' && !Array.isArray(raw.handler)
      ? (raw.handler as Record<string, unknown>)
      : raw;
  const type = String(handler.type || (handler.url ? 'http' : 'command'));
  if (type === 'http') {
    return {
      type,
      url: String(handler.url || ''),
      headers: objectOfStrings(handler.headers),
      allowedEnvVars: arrayOfStrings(handler.allowedEnvVars),
      timeoutSeconds: numberOrUndefined(handler.timeoutSeconds),
      failClosed: booleanOrUndefined(handler.failClosed),
    };
  }
  if (type !== 'command') throw new Error(`unsupported handler type for ${name}: ${type}`);
  return {
    type,
    command: String(handler.command || ''),
    args: arrayOfStrings(handler.args),
    cwd: typeof handler.cwd === 'string' ? handler.cwd : undefined,
    env: objectOfStrings(handler.env),
    timeoutSeconds: numberOrUndefined(handler.timeoutSeconds),
    failClosed: booleanOrUndefined(handler.failClosed),
  };
}

function parseNotifyHook(
  rawNotify: unknown,
  diagnostics: McpServerSettingsDiagnostic[]
): EffectiveAgentHook | null {
  if (!rawNotify) return null;
  const notify = arrayOfStrings(rawNotify);
  if (notify.length === 0) {
    diagnostics.push({
      level: 'warning',
      path: 'notify',
      message: 'Skipped Codex notify hook: notify must be a non-empty string array.',
    });
    return null;
  }
  try {
    const now = new Date(0).toISOString();
    const parsed = agentHookConfigSchema.parse({
      id: deterministicUuid(`codex_global:notify:${notify.join('\0')}`),
      name: 'Codex notify',
      enabled: true,
      event: 'SessionEnd',
      handler: {
        type: 'command',
        command: notify[0],
        args: notify.slice(1),
        failClosed: false,
      },
      createdAt: now,
      updatedAt: now,
    });
    return { ...parsed, source: 'codex_global' };
  } catch (err) {
    diagnostics.push({
      level: 'warning',
      path: 'notify',
      message: `Skipped Codex notify hook: ${sanitizeDiagnosticMessage(
        err instanceof Error ? err.message : String(err)
      )}`,
    });
    return null;
  }
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function objectOfStrings(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, String(item)])
  );
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}
