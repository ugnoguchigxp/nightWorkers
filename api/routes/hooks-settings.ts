import { createOpenApiRouter } from '../lib/openapi';
import { buildSampleHookInput } from '../services/hooks/hooks-config-schema';
import { readEffectiveAgentHooksSettings } from '../services/hooks/hooks-effective-settings';
import { runSingleAgentHookForTest } from '../services/hooks/hooks-runner';
import {
  createAgentHook,
  deleteAgentHook,
  getAgentHook,
  updateAgentHook,
} from '../services/hooks/hooks-settings';
import {
  createAgentHookRoute,
  deleteAgentHookRoute,
  getAgentHooksRoute,
  testAgentHookRoute,
  updateAgentHookRoute,
} from './settings-route-definitions';

export const hooksSettingsRouter = createOpenApiRouter()
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
