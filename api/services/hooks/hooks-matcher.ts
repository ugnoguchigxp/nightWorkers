import type { AgentHookConfig, AgentHookInput } from './types';

const toolEvents = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure']);

export function hookMatchesInput(hook: AgentHookConfig, input: AgentHookInput): boolean {
  if (!hook.enabled || hook.event !== input.hook_event_name) return false;
  if (!toolEvents.has(hook.event)) return true;
  if (!('tool_name' in input)) return false;
  return matcherMatchesTool(hook.matcher, input.tool_name);
}

export function matcherMatchesTool(matcher: string | undefined, toolName: string): boolean {
  const trimmed = matcher?.trim();
  if (!trimmed || trimmed === '*') return true;
  if (/^[A-Za-z0-9_|]+$/.test(trimmed)) {
    return trimmed.split('|').some((candidate) => candidate === toolName);
  }
  try {
    return new RegExp(trimmed).test(toolName);
  } catch {
    return false;
  }
}
