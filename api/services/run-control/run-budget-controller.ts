import type { BudgetDecision, RunBudgetConfig } from './types';

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableJson(v)).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`).join(',')}}`;
}

export class RunBudgetController {
  private readonly config: RunBudgetConfig;
  private readonly deadlineMs: number;
  private iteration = 0;
  private toolCalls = 0;
  private consecutiveMissingToolCalls = 0;
  private consecutiveToolFailures = 0;
  private consecutiveSchemaFallbacks = 0;
  private lastSignature = '';
  private repeatedActionCount = 0;

  constructor(config: RunBudgetConfig) {
    this.config = config;
    this.deadlineMs = Date.now() + config.timeoutSeconds * 1000;
  }

  onIterationStart(): BudgetDecision {
    this.iteration += 1;
    if (Date.now() > this.deadlineMs) {
      return {
        allowed: false,
        reason: 'deadline',
        detail: { iteration: this.iteration, deadlineAt: new Date(this.deadlineMs).toISOString() },
      };
    }
    if (this.iteration > this.config.maxIterations) {
      return {
        allowed: false,
        reason: 'iteration_limit',
        detail: { iteration: this.iteration, maxIterations: this.config.maxIterations },
      };
    }
    return { allowed: true };
  }

  onToolCall(name: string, args: unknown): BudgetDecision {
    this.toolCalls += 1;
    this.consecutiveMissingToolCalls = 0;

    if (this.toolCalls > this.config.maxToolCalls) {
      return {
        allowed: false,
        reason: 'tool_limit',
        detail: { toolCalls: this.toolCalls, maxToolCalls: this.config.maxToolCalls },
      };
    }

    const signature = `${name}:${stableJson(args)}`;
    if (signature === this.lastSignature) {
      this.repeatedActionCount += 1;
    } else {
      this.lastSignature = signature;
      this.repeatedActionCount = 1;
    }

    if (this.repeatedActionCount >= this.config.maxRepeatedAction) {
      return {
        allowed: false,
        reason: 'repeat_action',
        detail: {
          signature,
          repeatedCount: this.repeatedActionCount,
          maxRepeatedAction: this.config.maxRepeatedAction,
        },
      };
    }

    return { allowed: true };
  }

  onMissingToolCall(): BudgetDecision {
    this.consecutiveMissingToolCalls += 1;
    if (this.consecutiveMissingToolCalls >= this.config.maxMissingToolCalls) {
      return {
        allowed: false,
        reason: 'missing_tool_call',
        detail: {
          repeatedCount: this.consecutiveMissingToolCalls,
          maxMissingToolCalls: this.config.maxMissingToolCalls,
        },
      };
    }
    return { allowed: true };
  }

  onToolResult(ok: boolean): BudgetDecision {
    if (ok) {
      this.consecutiveToolFailures = 0;
      return { allowed: true };
    }

    this.consecutiveToolFailures += 1;
    if (this.consecutiveToolFailures >= 3) {
      return {
        allowed: false,
        reason: 'tool_failure',
        detail: { consecutiveToolFailures: this.consecutiveToolFailures },
      };
    }

    return { allowed: true };
  }

  onSchemaFallback(kind: string): BudgetDecision {
    this.consecutiveSchemaFallbacks += 1;
    if (this.consecutiveSchemaFallbacks >= this.config.maxSchemaFallbacks) {
      return {
        allowed: false,
        reason: 'schema_fallback',
        detail: {
          kind,
          repeatedCount: this.consecutiveSchemaFallbacks,
          maxSchemaFallbacks: this.config.maxSchemaFallbacks,
        },
      };
    }

    return { allowed: true };
  }

  onSchemaDecisionAccepted(): BudgetDecision {
    this.consecutiveSchemaFallbacks = 0;
    return { allowed: true };
  }
}
