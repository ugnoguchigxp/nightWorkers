import { createOpenApiRouter } from '../lib/openapi';
import { readCodexSdkStatus } from '../services/codex-global-config/status';
import { buildSampleHookInput } from '../services/hooks/hooks-config-schema';
import { readEffectiveAgentHooksSettings } from '../services/hooks/hooks-effective-settings';
import { runSingleAgentHookForTest } from '../services/hooks/hooks-runner';
import {
  createAgentHook,
  deleteAgentHook,
  getAgentHook,
  updateAgentHook,
} from '../services/hooks/hooks-settings';
import { mcpClientManager } from '../services/mcp/mcp-client-manager';
import {
  getEffectiveMcpServer,
  readEffectiveMcpServerSettings,
} from '../services/mcp/mcp-effective-settings';
import {
  createMcpServer,
  deleteMcpServer,
  importMcpServersFromText,
  updateMcpServer,
} from '../services/mcp/mcp-settings';
import { runStartupPreflight } from '../services/preflight/preflight';
import { listPricingRows, seedCodexPricingRows, upsertPricingRow } from '../services/pricing';
import {
  type GeneralSettings,
  readFxRateCache,
  readGeneralSettings,
  refreshEcbFxRates,
  writeGeneralSettings,
} from '../services/settings/general-settings';
import { callSupervisorLLM } from '../services/structured-llm';
import { checkStructuredLlmProviderHealth } from '../services/structured-llm/provider-health';
import { buildRound1JobTypePrompt } from '../services/supervisor/prompt';
import {
  createAgentHookRoute,
  createMcpServerRoute,
  deleteAgentHookRoute,
  deleteMcpServerRoute,
  getAgentHooksRoute,
  getCodexSdkStatusRoute,
  getFxRatesRoute,
  getGeneralSettingsRoute,
  getLlmModelsRoute,
  getLlmSettingsRoute,
  getMcpServersRoute,
  getStartupPreflightRoute,
  importMcpServersRoute,
  listPricingRoute,
  refreshFxRatesRoute,
  saveGeneralSettingsRoute,
  saveLlmSettingsRoute,
  savePricingRoute,
  seedCodexPricingRoute,
  smokeLlmRoute,
  testAgentHookRoute,
  testLlmProviderHealthRoute,
  testMcpServerRoute,
  updateAgentHookRoute,
  updateMcpServerRoute,
} from './settings-route-definitions';
import {
  applySettingsToProcessEnv,
  llmProviderEndpointSchema,
  MASKED_SECRET,
  maskLlmSettings,
  mergeMaskedSecrets,
  providerModelOptions,
  getCurrentSettings as readCurrentSettings,
  writeRuntimeSettings,
} from './settings-runtime';
export const getCurrentSettings = readCurrentSettings;
export { maskLlmSettings, mergeMaskedSecrets };

export const settingsRouter = createOpenApiRouter()
  .openapi(getLlmSettingsRoute, (c) => {
    return c.json(maskLlmSettings(getCurrentSettings()));
  })
  .openapi(saveLlmSettingsRoute, async (c) => {
    const settings = mergeMaskedSecrets(c.req.valid('json'), getCurrentSettings());
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
      options: options.map((value: string) => ({ value, label: value })),
    });
  })
  .openapi(getCodexSdkStatusRoute, (c) => {
    const settings = getCurrentSettings();
    return c.json(
      readCodexSdkStatus({
        accessToken: settings.CODEX_ACCESS_TOKEN,
        configuredModel: settings.CODEX_MODEL,
      }),
      200
    );
  })
  .openapi(getGeneralSettingsRoute, (c) => {
    return c.json(readGeneralSettings(), 200);
  })
  .openapi(saveGeneralSettingsRoute, (c) => {
    const settings = writeGeneralSettings(c.req.valid('json') as GeneralSettings);
    return c.json(settings, 200);
  })
  .openapi(getFxRatesRoute, (c) => {
    return c.json(readFxRateCache(), 200);
  })
  .openapi(refreshFxRatesRoute, async (c) => {
    try {
      const cache = await refreshEcbFxRates();
      return c.json(cache, 200);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  })
  .openapi(getStartupPreflightRoute, (c) => {
    return c.json(runStartupPreflight(), 200);
  })
  .openapi(listPricingRoute, async (c) => {
    const rows = await listPricingRows();
    return c.json(rows, 200);
  })
  .openapi(savePricingRoute, async (c) => {
    const row = await upsertPricingRow(c.req.valid('json'));
    return c.json(row, 200);
  })
  .openapi(seedCodexPricingRoute, async (c) => {
    const rows = await seedCodexPricingRows();
    return c.json(rows, 200);
  })
  .openapi(smokeLlmRoute, async (c) => {
    const provider = getCurrentSettings().ACTIVE_LLM_PROVIDER || 'azure';
    try {
      await callSupervisorLLM(
        buildRound1JobTypePrompt(process.cwd()),
        'LLM smoke check: answer this as a general lightweight request.',
        { round: 1, schemaFirst: true }
      );
      return c.json({ ok: true, provider, message: 'smoke ok' }, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, provider, message }, 200);
    }
  })
  .openapi(testLlmProviderHealthRoute, async (c) => {
    const settings = getCurrentSettings();
    const body = await c.req.json().catch(() => null);
    const parsedBodyEndpoint = llmProviderEndpointSchema.safeParse(
      body && typeof body === 'object' && 'endpoint' in body ? body.endpoint : null
    );
    const parsedEndpoint =
      parsedBodyEndpoint.success && parsedBodyEndpoint.data.id === c.req.param('id')
        ? parsedBodyEndpoint.data
        : null;
    const savedEndpoint = (settings.providerEndpoints || []).find(
      (item) => item.id === c.req.param('id')
    );
    const bodyEndpoint =
      parsedEndpoint && parsedEndpoint.apiKey === MASKED_SECRET
        ? { ...parsedEndpoint, apiKey: savedEndpoint?.apiKey || '' }
        : parsedEndpoint;
    const endpoint = bodyEndpoint || savedEndpoint;
    if (!endpoint)
      return c.json(
        { error: { code: 'NOT_FOUND', message: 'LLM provider endpoint not found' } },
        404
      );
    const result = await checkStructuredLlmProviderHealth(endpoint);
    return c.json(result, 200);
  })
  .openapi(getMcpServersRoute, (c) => {
    const settings = readEffectiveMcpServerSettings();
    return c.json({ servers: settings.servers, diagnostics: settings.diagnostics || [] }, 200);
  })
  .openapi(createMcpServerRoute, (c) => {
    const server = createMcpServer(c.req.valid('json'));
    return c.json(server, 201);
  })
  .openapi(importMcpServersRoute, async (c) => {
    const input = c.req.valid('json');
    const servers = importMcpServersFromText(input.text);
    const updatedServers = new Map(servers.map((server) => [server.id, server]));
    const results = input.testAfterImport
      ? await Promise.all(
          servers.map(async (server) => {
            const status = await mcpClientManager.testServer(server);
            if (!status.ok) {
              const updated = updateMcpServer(server.id, { enabled: false });
              if (updated) updatedServers.set(updated.id, updated);
            }
            return {
              serverId: server.id,
              ok: status.ok,
              message: status.message,
              toolCount: status.toolCount,
            };
          })
        )
      : [];
    return c.json(
      { servers: servers.map((server) => updatedServers.get(server.id) ?? server), results },
      201
    );
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
    const server = getEffectiveMcpServer(c.req.param('id'));
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
    return c.json(readEffectiveAgentHooksSettings(), 200);
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
