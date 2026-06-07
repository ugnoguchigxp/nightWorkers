import type { ThreadEvent, ThreadItem, Usage } from '@openai/codex-sdk';
import type { AgentRuntimeEvent } from './types';

const SECRET_KEY_PATTERN = /(authorization|cookie|token|secret|api[_-]?key|password)/i;

type MapperState = {
  agentTextById: Map<string, string>;
};

export function createCodexEventMapperState(): MapperState {
  return { agentTextById: new Map() };
}

export function mapCodexThreadEvent(
  event: ThreadEvent,
  state: MapperState = createCodexEventMapperState()
): AgentRuntimeEvent[] {
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
    const payload = {
      provider: 'codex',
      providerEventType: eventType,
      providerItemId: item.id,
      toolName: 'command_execution',
      command: item.command,
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
      toolName: `${item.server}.${item.tool}`,
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
          changedFiles: item.changes,
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
