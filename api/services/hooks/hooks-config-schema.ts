import { z } from '@hono/zod-openapi';
import { AGENT_HOOK_EVENTS, type AgentHookConfig, type AgentHookInput } from './types';

const secretLikePattern = /(token|api[_-]?key|secret|password|auth|bearer|cookie)/i;
const toolEvents = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure']);

export const agentHookEventSchema = z.enum(AGENT_HOOK_EVENTS);

export const agentHookLastRunSchema = z.object({
  ok: z.boolean(),
  checkedAt: z.string(),
  message: z.string(),
  durationMs: z.number().int().nonnegative().optional(),
});

const baseHandlerSchema = z.object({
  timeoutSeconds: z.number().int().positive().max(120).optional(),
  failClosed: z.boolean().optional(),
});

export const agentHookCommandHandlerSchema = baseHandlerSchema.extend({
  type: z.literal('command'),
  command: z.string().trim().min(1).max(500),
  args: z.array(z.string()).default([]).optional(),
  cwd: z.string().trim().optional(),
  env: z.record(z.string(), z.string()).default({}).optional(),
});

export const agentHookHttpHandlerSchema = baseHandlerSchema.extend({
  type: z.literal('http'),
  url: z.string().trim().min(1).max(1000),
  headers: z.record(z.string(), z.string()).default({}).optional(),
  allowedEnvVars: z.array(z.string()).default([]).optional(),
});

export const agentHookHandlerSchema = z.discriminatedUnion('type', [
  agentHookCommandHandlerSchema,
  agentHookHttpHandlerSchema,
]);

function validateCommonHookFields(
  value: { event: string; matcher?: string; handler: unknown },
  ctx: z.RefinementCtx
) {
  if (!toolEvents.has(value.event) && value.matcher?.trim()) {
    ctx.addIssue({
      code: 'custom',
      path: ['matcher'],
      message: 'Matcher is supported only for tool hook events.',
    });
  }
  if (value.matcher?.trim() && hasInvalidRegexMatcher(value.matcher)) {
    ctx.addIssue({
      code: 'custom',
      path: ['matcher'],
      message: 'Matcher regex is invalid.',
    });
  }
  const handler = value.handler as
    | {
        type?: string;
        env?: Record<string, string>;
        headers?: Record<string, string>;
        url?: string;
      }
    | undefined;
  if (!handler) return;
  if (handler.type === 'command') {
    for (const [key, val] of Object.entries(handler.env || {})) {
      if (secretLikePattern.test(key) || secretLikePattern.test(val)) {
        ctx.addIssue({
          code: 'custom',
          path: ['handler', 'env', key],
          message: 'Secret-like hook env values are not supported in this slice.',
        });
      }
    }
  }
  if (handler.type === 'http') {
    if (handler.url) {
      try {
        const parsed = new URL(handler.url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          ctx.addIssue({
            code: 'custom',
            path: ['handler', 'url'],
            message: 'Hook URL must use http or https.',
          });
        }
      } catch {
        ctx.addIssue({
          code: 'custom',
          path: ['handler', 'url'],
          message: 'Hook URL must be valid.',
        });
      }
    }
    for (const [key, val] of Object.entries(handler.headers || {})) {
      if (secretLikePattern.test(key) || secretLikePattern.test(val)) {
        ctx.addIssue({
          code: 'custom',
          path: ['handler', 'headers', key],
          message: 'Secret-like hook headers are not supported in this slice.',
        });
      }
    }
  }
}

function hasInvalidRegexMatcher(matcher: string): boolean {
  const trimmed = matcher.trim();
  if (!trimmed || trimmed === '*' || /^[A-Za-z0-9_|]+$/.test(trimmed)) return false;
  try {
    new RegExp(trimmed);
    return false;
  } catch {
    return true;
  }
}

export const agentHookConfigSchema: z.ZodType<AgentHookConfig> = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
    enabled: z.boolean().default(true),
    event: agentHookEventSchema,
    matcher: z.string().trim().max(200).optional(),
    handler: agentHookHandlerSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
    lastRun: agentHookLastRunSchema.optional(),
  })
  .superRefine(validateCommonHookFields);

export const agentHookInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    enabled: z.boolean().default(true),
    event: agentHookEventSchema,
    matcher: z.string().trim().max(200).optional(),
    handler: agentHookHandlerSchema,
  })
  .superRefine(validateCommonHookFields);

export const agentHookUpdateInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    enabled: z.boolean().optional(),
    event: agentHookEventSchema.optional(),
    matcher: z.string().trim().max(200).optional(),
    handler: agentHookHandlerSchema.optional(),
  })
  .partial();

export const agentHooksResponseSchema = z.object({
  hooks: z.array(agentHookConfigSchema),
});

export const agentHookTestResponseSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  durationMs: z.number().int().nonnegative().optional(),
});

export type AgentHookInputConfig = z.infer<typeof agentHookInputSchema>;
export type AgentHookUpdateInput = z.infer<typeof agentHookUpdateInputSchema>;

export function buildSampleHookInput(event: AgentHookConfig['event']): AgentHookInput {
  const base = {
    hook_event_name: event,
    session_id: 'sample-session',
    run_id: '00000000-0000-4000-8000-000000000000',
    task_id: '00000000-0000-4000-8000-000000000001',
    repository_id: '00000000-0000-4000-8000-000000000002',
    cwd: process.cwd(),
    timestamp: new Date().toISOString(),
  } as const;
  if (event === 'UserPromptSubmit') return { ...base, hook_event_name: event, prompt: 'Sample' };
  if (event === 'PreToolUse' || event === 'PostToolUse' || event === 'PostToolUseFailure') {
    return {
      ...base,
      hook_event_name: event,
      tool_name: 'run_command',
      tool_input: { command: 'echo sample' },
      tool_use_id: 'sample-tool-use',
      ...(event === 'PostToolUse'
        ? { tool_result: { ok: true, payload: { stdout: 'sample' } } }
        : {}),
      ...(event === 'PostToolUseFailure' ? { error: 'sample error' } : {}),
    };
  }
  if (event === 'Stop') {
    return {
      ...base,
      hook_event_name: event,
      stop_reason: 'completed',
      last_assistant_message: 'Sample final message',
    };
  }
  return {
    ...base,
    hook_event_name: event,
    source: event === 'SessionStart' ? 'run_start' : 'run_end',
  };
}
