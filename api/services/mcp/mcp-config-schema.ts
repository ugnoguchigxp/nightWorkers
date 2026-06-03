import { z } from '@hono/zod-openapi';

export const mcpServerTransportSchema = z.enum(['stdio', 'sse', 'streamable_http']);

const secretLikePattern = /(token|api[_-]?key|secret|password|auth|bearer)/i;

export const mcpServerStatusSchema = z.object({
  ok: z.boolean(),
  checkedAt: z.string(),
  message: z.string(),
  toolCount: z.number().int().nonnegative().optional(),
});

export const mcpServerConfigSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
    enabled: z.boolean().default(false),
    transport: mcpServerTransportSchema,
    command: z.string().trim().optional(),
    args: z.array(z.string()).default([]),
    url: z.string().trim().optional(),
    cwd: z.string().trim().optional(),
    env: z.record(z.string(), z.string()).default({}),
    toolPrefix: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[a-z][a-z0-9_]*$/),
    createdAt: z.string(),
    updatedAt: z.string(),
    lastStatus: mcpServerStatusSchema.optional(),
  })
  .superRefine((config, ctx) => {
    if (config.transport === 'stdio' && !config.command) {
      ctx.addIssue({
        code: 'custom',
        path: ['command'],
        message: 'stdio MCP servers require a command.',
      });
    }

    if ((config.transport === 'sse' || config.transport === 'streamable_http') && !config.url) {
      ctx.addIssue({
        code: 'custom',
        path: ['url'],
        message: `${config.transport} MCP servers require a URL.`,
      });
    }

    if (config.url) {
      try {
        const parsed = new URL(config.url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          ctx.addIssue({
            code: 'custom',
            path: ['url'],
            message: 'MCP server URL must use http or https.',
          });
        }
        if (parsed.username || parsed.password) {
          ctx.addIssue({
            code: 'custom',
            path: ['url'],
            message: 'MCP server URL credentials are not supported yet.',
          });
        }
        const isLoopback =
          parsed.hostname === 'localhost' ||
          parsed.hostname === '127.0.0.1' ||
          parsed.hostname === '[::1]' ||
          parsed.hostname === '::1';
        if (parsed.protocol === 'http:' && !isLoopback) {
          ctx.addIssue({
            code: 'custom',
            path: ['url'],
            message:
              'Non-auth remote MCP servers must use https. Plain http is limited to localhost.',
          });
        }
      } catch {
        ctx.addIssue({
          code: 'custom',
          path: ['url'],
          message: 'MCP server URL must be valid.',
        });
      }
    }

    for (const [key, value] of Object.entries(config.env)) {
      if (secretLikePattern.test(key) || secretLikePattern.test(value)) {
        ctx.addIssue({
          code: 'custom',
          path: ['env', key],
          message: 'Authenticated or secret-like MCP env values are not supported yet.',
        });
      }
    }
  });

export const mcpServerInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    enabled: z.boolean().default(false),
    transport: mcpServerTransportSchema,
    command: z.string().trim().optional(),
    args: z.array(z.string()).default([]),
    url: z.string().trim().optional(),
    cwd: z.string().trim().optional(),
    env: z.record(z.string(), z.string()).default({}),
    toolPrefix: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[a-z][a-z0-9_]*$/),
  })
  .superRefine((input, ctx) => {
    const now = new Date().toISOString();
    const full = mcpServerConfigSchema.safeParse({
      ...input,
      id: '00000000-0000-4000-8000-000000000000',
      createdAt: now,
      updatedAt: now,
    });
    if (full.success) return;
    for (const issue of full.error.issues) {
      ctx.addIssue({
        code: 'custom',
        message: issue.message,
        path: issue.path,
      });
    }
  });

export const mcpServerUpdateInputSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  enabled: z.boolean().optional(),
  transport: mcpServerTransportSchema.optional(),
  command: z.string().trim().optional(),
  args: z.array(z.string()).optional(),
  url: z.string().trim().optional(),
  cwd: z.string().trim().optional(),
  env: z.record(z.string(), z.string()).optional(),
  toolPrefix: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/)
    .optional(),
});

export const mcpServersResponseSchema = z.object({
  servers: z.array(mcpServerConfigSchema),
});

export const mcpServerTestResponseSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  toolCount: z.number().int().nonnegative().optional(),
});

export const mcpServerImportRequestSchema = z.object({
  text: z.string().min(1),
  testAfterImport: z.boolean().default(true),
});

export const mcpServerImportResponseSchema = z.object({
  servers: z.array(mcpServerConfigSchema),
  results: z.array(
    z.object({
      serverId: z.string().uuid(),
      ok: z.boolean(),
      message: z.string(),
      toolCount: z.number().int().nonnegative().optional(),
    })
  ),
});

export type McpServerTransport = z.infer<typeof mcpServerTransportSchema>;
export type McpServerConfig = z.infer<typeof mcpServerConfigSchema>;
export type McpServerInput = z.infer<typeof mcpServerInputSchema>;
export type McpServerUpdateInput = z.infer<typeof mcpServerUpdateInputSchema>;
export type McpServerImportRequest = z.infer<typeof mcpServerImportRequestSchema>;
