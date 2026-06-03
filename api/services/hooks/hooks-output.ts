import type { NormalizedHookDecision } from './types';

type RawHookOutput = {
  decision?: unknown;
  reason?: unknown;
  additionalContext?: unknown;
  modifiedArgs?: unknown;
  hookSpecificOutput?: {
    permissionDecision?: unknown;
    permissionDecisionReason?: unknown;
    additionalContext?: unknown;
    modifiedArgs?: unknown;
  };
};

export function parseHookOutput(stdout: string): NormalizedHookDecision {
  const text = stdout.trim();
  if (!text) return { decision: 'no_decision' };
  try {
    return normalizeRawHookOutput(JSON.parse(text) as RawHookOutput);
  } catch {
    return { decision: 'no_decision' };
  }
}

export function normalizeRawHookOutput(raw: RawHookOutput): NormalizedHookDecision {
  const specific = raw.hookSpecificOutput;
  const permissionDecision = stringValue(specific?.permissionDecision);
  const topDecision = stringValue(raw.decision);
  let decision: NormalizedHookDecision['decision'] = 'no_decision';
  if (permissionDecision === 'deny') decision = 'deny';
  else if (permissionDecision === 'allow') decision = 'allow';
  else if (topDecision === 'deny') decision = 'deny';
  else if (topDecision === 'block') decision = 'block';
  else if (topDecision === 'allow') decision = 'allow';
  else if (topDecision === 'continue') decision = 'continue';

  return {
    decision,
    reason: stringValue(raw.reason) || stringValue(specific?.permissionDecisionReason) || undefined,
    additionalContext:
      stringValue(raw.additionalContext) || stringValue(specific?.additionalContext) || undefined,
    modifiedArgs: recordValue(raw.modifiedArgs) || recordValue(specific?.modifiedArgs) || undefined,
  };
}

function stringValue(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function recordValue(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
