import fs from 'node:fs';
import path from 'node:path';
import { createRoute, z } from '@hono/zod-openapi';
import { createOpenApiRouter } from '../lib/openapi';
import {
  agentHookConfigSchema,
  agentHookInputSchema,
  agentHooksResponseSchema,
  agentHookTestResponseSchema,
  agentHookUpdateInputSchema,
  buildSampleHookInput,
} from '../services/hooks/hooks-config-schema';
import { runSingleAgentHookForTest } from '../services/hooks/hooks-runner';
import {
  createAgentHook,
  deleteAgentHook,
  getAgentHook,
  listAgentHooks,
  updateAgentHook,
} from '../services/hooks/hooks-settings';
import { mcpClientManager } from '../services/mcp/mcp-client-manager';
import {
  mcpServerConfigSchema,
  mcpServerImportRequestSchema,
  mcpServerImportResponseSchema,
  mcpServerInputSchema,
  mcpServersResponseSchema,
  mcpServerTestResponseSchema,
  mcpServerUpdateInputSchema,
} from '../services/mcp/mcp-config-schema';
import {
  createMcpServer,
  deleteMcpServer,
  getMcpServer,
  importMcpServersFromText,
  listMcpServers,
  updateMcpServer,
} from '../services/mcp/mcp-settings';
import { callSupervisorLLM } from '../services/supervisor/llm-provider';

const RUNTIME_SETTINGS_DIR = path.resolve(process.cwd(), 'api/.runtime');
const RUNTIME_SETTINGS_PATH = path.join(RUNTIME_SETTINGS_DIR, 'llm-settings.json');

export const llmSettingsSchema = z.object({
  ACTIVE_LLM_PROVIDER: z.string().default('azure').openapi({ example: 'azure' }),
  OPENAI_ENABLED: z.boolean().default(true).openapi({ example: true }),
  AZURE_OPENAI_API_KEY: z.string().default('').openapi({ example: 'your-azure-key' }),
  AZURE_OPENAI_ENABLED: z.boolean().default(false).openapi({ example: false }),
  AZURE_OPENAI_ENDPOINT: z
    .string()
    .default('')
    .openapi({ example: 'https://xxx.openai.azure.com/' }),
  AZURE_OPENAI_DEPLOYMENT_NAME: z.string().default('').openapi({ example: 'gpt-5-mini' }),
  AZURE_OPENAI_API_VERSION: z.string().default('').openapi({ example: '2024-05-01-preview' }),
  AWS_BEDROCK_ENABLED: z.boolean().default(false).openapi({ example: false }),
  AWS_ACCESS_KEY_ID: z.string().default('').openapi({ example: 'your-aws-access-key' }),
  AWS_SECRET_ACCESS_KEY: z.string().default('').openapi({ example: 'your-aws-secret-key' }),
  AWS_REGION: z.string().default('').openapi({ example: 'us-east-1' }),
  AWS_BEDROCK_MODEL: z
    .string()
    .default('')
    .openapi({ example: 'anthropic.claude-3-5-sonnet-20241022-v2:0' }),
  OPENAI_API_KEY: z.string().default('').openapi({ example: 'sk-your-openai-key' }),
  OPENAI_BASE_URL: z.string().default('').openapi({ example: 'https://api.openai.com/v1' }),
  OPENAI_MODEL: z.string().default('').openapi({ example: 'gpt-4o' }),
  CODEX_ENABLED: z.boolean().default(false).openapi({ example: false }),
  CODEX_ACCESS_TOKEN: z.string().default('').openapi({ example: 'your-codex-token' }),
  CODEX_MODEL: z.string().default('').openapi({ example: 'gpt-5.3-codex' }),
  SESSION_QUEUE_MAX_CONCURRENCY: z.number().int().positive().default(2).openapi({ example: 2 }),
});

const llmModelsSchema = z.object({
  activeProvider: z.enum(['azure', 'openai', 'bedrock', 'codex']),
  options: z.array(z.object({ value: z.string(), label: z.string() })),
});

const getLlmSettingsRoute = createRoute({
  method: 'get',
  path: '/llm',
  responses: {
    200: {
      content: {
        'application/json': {
          schema: llmSettingsSchema,
        },
      },
      description: 'Get LLM Settings',
    },
  },
});

const saveLlmSettingsRoute = createRoute({
  method: 'post',
  path: '/llm',
  request: {
    body: {
      content: {
        'application/json': {
          schema: llmSettingsSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean().openapi({ example: true }),
          }),
        },
      },
      description: 'Save LLM Settings',
    },
  },
});

const getLlmModelsRoute = createRoute({
  method: 'get',
  path: '/llm/models',
  responses: {
    200: {
      content: {
        'application/json': {
          schema: llmModelsSchema,
        },
      },
      description: 'Get model options for active provider',
    },
  },
});

const smokeLlmRoute = createRoute({
  method: 'post',
  path: '/llm/smoke',
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({
            ok: z.boolean(),
            provider: z.string(),
            message: z.string(),
          }),
        },
      },
      description: 'Run LLM smoke test with active provider',
    },
  },
});

const getMcpServersRoute = createRoute({
  method: 'get',
  path: '/mcp/servers',
  responses: {
    200: {
      content: {
        'application/json': {
          schema: mcpServersResponseSchema,
        },
      },
      description: 'List configured MCP servers',
    },
  },
});

const createMcpServerRoute = createRoute({
  method: 'post',
  path: '/mcp/servers',
  request: {
    body: {
      content: {
        'application/json': {
          schema: mcpServerInputSchema,
        },
      },
    },
  },
  responses: {
    201: {
      content: {
        'application/json': {
          schema: mcpServerConfigSchema,
        },
      },
      description: 'Create MCP server',
    },
  },
});

const importMcpServersRoute = createRoute({
  method: 'post',
  path: '/mcp/servers/import',
  request: {
    body: {
      content: {
        'application/json': {
          schema: mcpServerImportRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      content: {
        'application/json': {
          schema: mcpServerImportResponseSchema,
        },
      },
      description: 'Import MCP servers from pasted JSON config',
    },
  },
});

const updateMcpServerRoute = createRoute({
  method: 'put',
  path: '/mcp/servers/{id}',
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: {
      content: {
        'application/json': {
          schema: mcpServerUpdateInputSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: mcpServerConfigSchema,
        },
      },
      description: 'Update MCP server',
    },
    404: {
      description: 'MCP server not found',
    },
  },
});

const deleteMcpServerRoute = createRoute({
  method: 'delete',
  path: '/mcp/servers/{id}',
  request: {
    params: z.object({ id: z.string().uuid() }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: mcpServerConfigSchema,
        },
      },
      description: 'Delete MCP server',
    },
    404: {
      description: 'MCP server not found',
    },
  },
});

const testMcpServerRoute = createRoute({
  method: 'post',
  path: '/mcp/servers/{id}/test',
  request: {
    params: z.object({ id: z.string().uuid() }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: mcpServerTestResponseSchema,
        },
      },
      description: 'Test MCP server connection',
    },
    404: {
      description: 'MCP server not found',
    },
  },
});

const getAgentHooksRoute = createRoute({
  method: 'get',
  path: '/hooks',
  responses: {
    200: {
      content: {
        'application/json': {
          schema: agentHooksResponseSchema,
        },
      },
      description: 'List configured agent hooks',
    },
  },
});

const createAgentHookRoute = createRoute({
  method: 'post',
  path: '/hooks',
  request: {
    body: {
      content: {
        'application/json': {
          schema: agentHookInputSchema,
        },
      },
    },
  },
  responses: {
    201: {
      content: {
        'application/json': {
          schema: agentHookConfigSchema,
        },
      },
      description: 'Create agent hook',
    },
  },
});

const updateAgentHookRoute = createRoute({
  method: 'put',
  path: '/hooks/{id}',
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: {
      content: {
        'application/json': {
          schema: agentHookUpdateInputSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: agentHookConfigSchema,
        },
      },
      description: 'Update agent hook',
    },
    404: {
      description: 'Agent hook not found',
    },
  },
});

const deleteAgentHookRoute = createRoute({
  method: 'delete',
  path: '/hooks/{id}',
  request: {
    params: z.object({ id: z.string().uuid() }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: agentHookConfigSchema,
        },
      },
      description: 'Delete agent hook',
    },
    404: {
      description: 'Agent hook not found',
    },
  },
});

const testAgentHookRoute = createRoute({
  method: 'post',
  path: '/hooks/{id}/test',
  request: {
    params: z.object({ id: z.string().uuid() }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: agentHookTestResponseSchema,
        },
      },
      description: 'Test agent hook',
    },
    404: {
      description: 'Agent hook not found',
    },
  },
});

const providerModelOptions = {
  azure: ['gpt-5.5', 'gpt-5.4-mini', 'gpt-5-mini'],
  openai: ['gpt-5.5', 'gpt-5.4-mini', 'gpt-5-mini', 'gpt-4.1-mini'],
  bedrock: ['anthropic.claude-3-5-sonnet-20241022-v2:0'],
  codex: ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.3-codex-spark'],
} as const;

const getBoolEnv = (key: string, fallback: boolean) => {
  const value = process.env[key];
  if (!value) return fallback;
  return value.toLowerCase() === 'true';
};

const readRuntimeSettings = (): Partial<z.infer<typeof llmSettingsSchema>> => {
  try {
    if (!fs.existsSync(RUNTIME_SETTINGS_PATH)) return {};
    const text = fs.readFileSync(RUNTIME_SETTINGS_PATH, 'utf-8');
    return JSON.parse(text) as Partial<z.infer<typeof llmSettingsSchema>>;
  } catch {
    return {};
  }
};

const writeRuntimeSettings = (settings: z.infer<typeof llmSettingsSchema>) => {
  fs.mkdirSync(RUNTIME_SETTINGS_DIR, { recursive: true });
  fs.writeFileSync(RUNTIME_SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`, 'utf-8');
};

const getCurrentSettings = (): z.infer<typeof llmSettingsSchema> => {
  const persisted = readRuntimeSettings();
  return {
    ACTIVE_LLM_PROVIDER: (persisted.ACTIVE_LLM_PROVIDER ||
      process.env.ACTIVE_LLM_PROVIDER ||
      'azure') as 'azure' | 'openai' | 'bedrock' | 'codex',
    OPENAI_ENABLED:
      typeof persisted.OPENAI_ENABLED === 'boolean'
        ? persisted.OPENAI_ENABLED
        : getBoolEnv('OPENAI_ENABLED', true),
    AZURE_OPENAI_ENABLED:
      typeof persisted.AZURE_OPENAI_ENABLED === 'boolean'
        ? persisted.AZURE_OPENAI_ENABLED
        : getBoolEnv('AZURE_OPENAI_ENABLED', false),
    AZURE_OPENAI_API_KEY: persisted.AZURE_OPENAI_API_KEY ?? process.env.AZURE_OPENAI_API_KEY ?? '',
    AZURE_OPENAI_ENDPOINT:
      persisted.AZURE_OPENAI_ENDPOINT ?? process.env.AZURE_OPENAI_ENDPOINT ?? '',
    AZURE_OPENAI_DEPLOYMENT_NAME:
      persisted.AZURE_OPENAI_DEPLOYMENT_NAME ?? process.env.AZURE_OPENAI_DEPLOYMENT_NAME ?? '',
    AZURE_OPENAI_API_VERSION:
      persisted.AZURE_OPENAI_API_VERSION ?? process.env.AZURE_OPENAI_API_VERSION ?? '',
    AWS_BEDROCK_ENABLED:
      typeof persisted.AWS_BEDROCK_ENABLED === 'boolean'
        ? persisted.AWS_BEDROCK_ENABLED
        : getBoolEnv('AWS_BEDROCK_ENABLED', false),
    AWS_ACCESS_KEY_ID: persisted.AWS_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID ?? '',
    AWS_SECRET_ACCESS_KEY:
      persisted.AWS_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY ?? '',
    AWS_REGION: persisted.AWS_REGION ?? process.env.AWS_REGION ?? '',
    AWS_BEDROCK_MODEL: persisted.AWS_BEDROCK_MODEL ?? process.env.AWS_BEDROCK_MODEL ?? '',
    OPENAI_API_KEY: persisted.OPENAI_API_KEY ?? process.env.OPENAI_API_KEY ?? '',
    OPENAI_BASE_URL: persisted.OPENAI_BASE_URL ?? process.env.OPENAI_BASE_URL ?? '',
    OPENAI_MODEL: persisted.OPENAI_MODEL ?? process.env.OPENAI_MODEL ?? '',
    CODEX_ENABLED:
      typeof persisted.CODEX_ENABLED === 'boolean'
        ? persisted.CODEX_ENABLED
        : getBoolEnv('CODEX_ENABLED', false),
    CODEX_ACCESS_TOKEN: persisted.CODEX_ACCESS_TOKEN ?? process.env.CODEX_ACCESS_TOKEN ?? '',
    CODEX_MODEL: persisted.CODEX_MODEL ?? process.env.CODEX_MODEL ?? '',
    SESSION_QUEUE_MAX_CONCURRENCY:
      typeof persisted.SESSION_QUEUE_MAX_CONCURRENCY === 'number'
        ? persisted.SESSION_QUEUE_MAX_CONCURRENCY
        : Number(process.env.SESSION_QUEUE_MAX_CONCURRENCY || 2),
  };
};

const applySettingsToProcessEnv = (settings: z.infer<typeof llmSettingsSchema>) => {
  for (const [key, val] of Object.entries(settings)) {
    process.env[key] = String(val);
  }
};

applySettingsToProcessEnv(getCurrentSettings());

export const settingsRouter = createOpenApiRouter()
  .openapi(getLlmSettingsRoute, (c) => {
    return c.json(getCurrentSettings());
  })
  .openapi(saveLlmSettingsRoute, async (c) => {
    const settings = c.req.valid('json');
    writeRuntimeSettings(settings);

    // Update in-memory environment variables instantly!
    applySettingsToProcessEnv(settings);

    return c.json({ success: true }, 200);
  })
  .openapi(getLlmModelsRoute, (c) => {
    const activeProvider = getCurrentSettings()
      .ACTIVE_LLM_PROVIDER as keyof typeof providerModelOptions;
    const options = providerModelOptions[activeProvider] || providerModelOptions.azure;
    return c.json({
      activeProvider,
      options: options.map((value) => ({ value, label: value })),
    });
  })
  .openapi(smokeLlmRoute, async (c) => {
    const provider = process.env.ACTIVE_LLM_PROVIDER || 'azure';
    try {
      await callSupervisorLLM(
        'You are a strict JSON generator.',
        'Return {"phase":"stop","instruction":"smoke","rationale":"ok","expectedEvidence":[],"terminalState":"completed","riskLevel":"low"}'
      );
      return c.json({ ok: true, provider, message: 'smoke ok' }, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, provider, message }, 200);
    }
  })
  .openapi(getMcpServersRoute, (c) => {
    return c.json({ servers: listMcpServers() }, 200);
  })
  .openapi(createMcpServerRoute, (c) => {
    const server = createMcpServer(c.req.valid('json'));
    return c.json(server, 201);
  })
  .openapi(importMcpServersRoute, async (c) => {
    const input = c.req.valid('json');
    const servers = importMcpServersFromText(input.text);
    const results = input.testAfterImport
      ? await Promise.all(
          servers.map(async (server) => {
            const status = await mcpClientManager.testServer(server);
            return {
              serverId: server.id,
              ok: status.ok,
              message: status.message,
              toolCount: status.toolCount,
            };
          })
        )
      : [];
    return c.json({ servers, results }, 201);
  })
  .openapi(updateMcpServerRoute, async (c) => {
    const server = updateMcpServer(c.req.param('id'), c.req.valid('json'));
    if (!server)
      return c.json({ error: { code: 'NOT_FOUND', message: 'MCP server not found' } }, 404);
    await mcpClientManager.disconnect(server.id);
    return c.json(server, 200);
  })
  .openapi(deleteMcpServerRoute, async (c) => {
    const removed = deleteMcpServer(c.req.param('id'));
    if (!removed)
      return c.json({ error: { code: 'NOT_FOUND', message: 'MCP server not found' } }, 404);
    await mcpClientManager.disconnect(removed.id);
    return c.json(removed, 200);
  })
  .openapi(testMcpServerRoute, async (c) => {
    const server = getMcpServer(c.req.param('id'));
    if (!server)
      return c.json({ error: { code: 'NOT_FOUND', message: 'MCP server not found' } }, 404);
    const status = await mcpClientManager.testServer(server);
    return c.json(
      {
        ok: status.ok,
        message: status.message,
        toolCount: status.toolCount,
      },
      200
    );
  })
  .openapi(getAgentHooksRoute, (c) => {
    return c.json({ hooks: listAgentHooks() }, 200);
  })
  .openapi(createAgentHookRoute, (c) => {
    const hook = createAgentHook(c.req.valid('json'));
    return c.json(hook, 201);
  })
  .openapi(updateAgentHookRoute, (c) => {
    const hook = updateAgentHook(c.req.param('id'), c.req.valid('json'));
    if (!hook)
      return c.json({ error: { code: 'NOT_FOUND', message: 'Agent hook not found' } }, 404);
    return c.json(hook, 200);
  })
  .openapi(deleteAgentHookRoute, (c) => {
    const removed = deleteAgentHook(c.req.param('id'));
    if (!removed)
      return c.json({ error: { code: 'NOT_FOUND', message: 'Agent hook not found' } }, 404);
    return c.json(removed, 200);
  })
  .openapi(testAgentHookRoute, async (c) => {
    const hook = getAgentHook(c.req.param('id'));
    if (!hook)
      return c.json({ error: { code: 'NOT_FOUND', message: 'Agent hook not found' } }, 404);
    const result = await runSingleAgentHookForTest(hook, buildSampleHookInput(hook.event));
    return c.json(result, 200);
  });
