import type { ThreadEvent, ThreadItem, Usage } from '@openai/codex-sdk';
import type { AgentRuntimeEvent } from '../types';

const SECRET_KEY_PATTERN = /(authorization|cookie|token|secret|api[_-]?key|password)/i;

export type CodexCommandClass =
  | 'verification'
  | 'broad_verification'
  | 'git_clone_or_import'
  | 'install'
  | 'inspection'
  | 'other';

type MapperState = {
  agentTextById: Map<string, string>;
};

export function createCodexEventMapperState(): MapperState {
  return { agentTextById: new Map() };
}

export function mapCodexThreadEvent(
  eventValue: unknown,
  state: MapperState = createCodexEventMapperState()
): AgentRuntimeEvent[] {
  const event = eventValue as ThreadEvent;
  if (event.type === 'thread.started') {
    return [
      {
        type: 'runtime_started',
        message: '[System] Codex Agent Runtime thread started.',
        payload: {
          provider: 'codex',
          providerEventType: event.type,
          providerThreadId: event.thread_id,
        },
      },
    ];
  }
  if (event.type === 'turn.started') {
    return [
      {
        type: 'turn_started',
        message: '[System] Codex Agent Runtime turn started.',
        payload: { provider: 'codex', providerEventType: event.type },
      },
    ];
  }
  if (event.type === 'turn.completed') {
    return [
      {
        type: 'model_response_finished',
        message: '[Codex] Turn usage received.',
        payload: {
          provider: 'codex',
          providerEventType: event.type,
          usage: normalizeUsage(event.usage),
          rawUsage: event.usage,
        },
      },
    ];
  }
  if (event.type === 'turn.failed') {
    return [
      {
        type: 'runtime_error',
        message: `[Codex] Turn failed: ${event.error.message}`,
        payload: {
          provider: 'codex',
          providerEventType: event.type,
          error: event.error.message,
          providerEvent: redactProviderEvent(event),
        },
      },
    ];
  }
  if (event.type === 'error') {
    return [
      {
        type: 'runtime_error',
        message: `[Codex] Runtime stream error: ${event.message}`,
        payload: {
          provider: 'codex',
          providerEventType: event.type,
          error: event.message,
          providerEvent: redactProviderEvent(event),
        },
      },
    ];
  }

  return mapCodexItemEvent(event.type, event.item, state, event);
}

export function redactProviderEvent(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redactProviderEvent(item));
  if (!value || typeof value !== 'object') return value;
  const redacted: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    redacted[key] = SECRET_KEY_PATTERN.test(key) ? '[REDACTED]' : redactProviderEvent(child);
  }
  return redacted;
}

function mapCodexItemEvent(
  eventType: 'item.started' | 'item.updated' | 'item.completed',
  item: ThreadItem,
  state: MapperState,
  rawEvent: ThreadEvent
): AgentRuntimeEvent[] {
  if (item.type === 'agent_message') {
    const previous = state.agentTextById.get(item.id) || '';
    state.agentTextById.set(item.id, item.text || '');
    const payload = {
      provider: 'codex',
      providerEventType: eventType,
      providerItemId: item.id,
      providerEvent: redactProviderEvent(rawEvent),
    };
    if (eventType === 'item.completed') {
      return [
        {
          type: 'model_response_finished',
          message: '[Codex] Assistant message completed.',
          payload: { ...payload, text: item.text },
        },
      ];
    }
    if (item.text.startsWith(previous) && item.text.length > previous.length) {
      return [
        {
          type: 'model_response_delta',
          message: item.text.slice(previous.length),
          payload: { ...payload, delta: item.text.slice(previous.length) },
        },
      ];
    }
    return [];
  }

  if (item.type === 'command_execution') {
    const commandClass = classifyCodexCommand(item.command);
    const payload = {
      provider: 'codex',
      providerEventType: eventType,
      providerItemId: item.id,
      toolName: 'command_execution',
      command: item.command,
      commandClass,
      aggregatedOutput: item.aggregated_output,
      exitCode: item.exit_code,
      status: item.status,
      providerEvent: redactProviderEvent(rawEvent),
    };
    return [
      {
        type: mapToolLifecycleEventType(eventType),
        message: `[Codex] Command ${mapToolLifecycleLabel(eventType)}: ${item.command}`,
        payload,
      },
    ];
  }

  if (item.type === 'mcp_tool_call') {
    const payload = {
      provider: 'codex',
      providerEventType: eventType,
      providerItemId: item.id,
      mcpServer: item.server,
      mcpTool: item.tool,
      toolName: `${item.server}.${item.tool}`,
      arguments: redactProviderEvent(item.arguments),
      result: redactProviderEvent(item.result),
      status: item.status,
      error: item.error?.message,
      providerEvent: redactProviderEvent(rawEvent),
    };
    return [
      {
        type: mapToolLifecycleEventType(eventType),
        message: `[Codex] MCP tool ${mapToolLifecycleLabel(eventType)}: ${item.server}.${item.tool}`,
        payload,
      },
    ];
  }

  if (item.type === 'file_change') {
    return [
      {
        type: 'diff_collected',
        message: `[Codex] File change ${item.status}: ${item.changes.length} file(s).`,
        payload: {
          provider: 'codex',
          providerEventType: eventType,
          providerItemId: item.id,
          changedFiles: normalizeChangedFiles(item.changes),
          changes: item.changes,
          status: item.status,
          providerEvent: redactProviderEvent(rawEvent),
        },
      },
    ];
  }

  if (item.type === 'error') {
    return [
      {
        type: 'runtime_error',
        message: `[Codex] Item error: ${item.message}`,
        payload: {
          provider: 'codex',
          providerEventType: eventType,
          providerItemId: item.id,
          error: item.message,
          providerEvent: redactProviderEvent(rawEvent),
        },
      },
    ];
  }

  return [
    {
      type: 'tool_call_progress',
      message: `[Codex] Activity: ${item.type}`,
      payload: {
        provider: 'codex',
        providerEventType: eventType,
        providerItemId: item.id,
        providerEvent: redactProviderEvent(rawEvent),
      },
    },
  ];
}

function normalizeUsage(usage: Usage) {
  return {
    inputTokens: usage.input_tokens,
    cachedInputTokens: usage.cached_input_tokens,
    outputTokens: usage.output_tokens,
    reasoningOutputTokens: usage.reasoning_output_tokens,
  };
}

function normalizeChangedFiles(changes: unknown): string[] {
  if (!Array.isArray(changes)) return [];
  return changes
    .map((change) => {
      if (typeof change === 'string') return change;
      if (!change || typeof change !== 'object') return null;
      const record = change as Record<string, unknown>;
      const path =
        typeof record.path === 'string'
          ? record.path
          : typeof record.filePath === 'string'
            ? record.filePath
            : typeof record.relativePath === 'string'
              ? record.relativePath
              : null;
      return path;
    })
    .filter((path): path is string => Boolean(path));
}

export function classifyCodexCommand(command: string): CodexCommandClass {
  const normalized = normalizeCodexCommand(command);
  if (!normalized) return 'other';
  if (isBroadVerificationCommand(normalized)) return 'broad_verification';
  if (isGitCloneOrImportCommand(normalized)) return 'git_clone_or_import';
  if (isInstallCommand(normalized)) return 'install';
  if (isVerificationCommand(normalized)) return 'verification';
  if (isInspectionCommand(normalized)) return 'inspection';
  return 'other';
}

export function normalizeCodexCommand(command: string): string {
  const unwrapped = unwrapShellCommand(command.trim());
  return unwrapped.replace(/\s+/g, ' ').trim();
}

function unwrapShellCommand(command: string): string {
  const match = /^(?:\/bin\/)?(?:zsh|bash|sh)\s+-lc\s+([\s\S]+)$/.exec(command);
  if (!match) return command;
  const inner = unquoteShellArgument(match[1].trim());
  return inner || command;
}

function unquoteShellArgument(value: string): string {
  if (value.length < 2) return value;
  const quote = value[0];
  if ((quote !== "'" && quote !== '"') || value.at(-1) !== quote) return value;
  const inner = value.slice(1, -1);
  if (quote === "'") return inner.replace(/'\\''/g, "'");
  return inner.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

function isBroadVerificationCommand(command: string) {
  return (
    /\bbun\s+(?:run\s+)?(?:scripts\/verify\.(?:ts|js|mjs)|verify(?::[\w-]+)?)\b/.test(command) ||
    /\bnpm\s+run\s+verify(?::[\w-]+)?\b/.test(command) ||
    /\b(?:pnpm|yarn)\s+(?:run\s+)?verify(?::[\w-]+)?\b/.test(command)
  );
}

function isVerificationCommand(command: string) {
  return (
    /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|typecheck|lint|build)(?::[\w-]+)?\b/.test(
      command
    ) || /\b(?:vitest|jest|playwright|tsc|eslint)\b/.test(command)
  );
}

function isGitCloneOrImportCommand(command: string) {
  return (
    /\bgit\s+clone\b/.test(command) ||
    /\b(?:npx|pnpm\s+dlx|bunx)\s+(?:degit|create-[\w-]+)\b/.test(command) ||
    /\b(?:npm|pnpm|yarn|bun)\s+create\b/.test(command)
  );
}

function isInstallCommand(command: string) {
  return /\b(?:npm\s+(?:install|i|ci)|pnpm\s+(?:install|i)|yarn\s+(?:install|add)|bun\s+(?:install|add))\b/.test(
    command
  );
}

function isInspectionCommand(command: string) {
  return (
    /^(?:pwd|ls|find|tree|wc)\b/.test(command) ||
    /^(?:rg|grep|cat|sed|awk|head|tail|nl)\b/.test(command) ||
    /^git\s+(?:status|diff|log|show|branch|rev-parse)\b/.test(command)
  );
}

function mapToolLifecycleEventType(
  eventType: 'item.started' | 'item.updated' | 'item.completed'
): Extract<
  AgentRuntimeEvent['type'],
  'tool_call_started' | 'tool_call_progress' | 'tool_call_finished'
> {
  if (eventType === 'item.completed') return 'tool_call_finished';
  if (eventType === 'item.updated') return 'tool_call_progress';
  return 'tool_call_started';
}

function mapToolLifecycleLabel(eventType: 'item.started' | 'item.updated' | 'item.completed') {
  if (eventType === 'item.completed') return 'finished';
  if (eventType === 'item.updated') return 'progress';
  return 'started';
}
