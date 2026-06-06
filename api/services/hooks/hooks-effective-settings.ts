import { listCodexGlobalAgentHooks } from '../codex-global-config/hooks-bridge';
import type { McpServerSettingsDiagnostic } from '../mcp/mcp-config-schema';
import { listAgentHooks } from './hooks-settings';
import type { AgentHookConfig } from './types';

export type EffectiveAgentHook = AgentHookConfig & {
  source: 'nightworkers_settings' | 'codex_global';
};

export type EffectiveAgentHooksSettings = {
  hooks: EffectiveAgentHook[];
  diagnostics: McpServerSettingsDiagnostic[];
};

export function readEffectiveAgentHooksSettings(
  projectRoot = process.cwd()
): EffectiveAgentHooksSettings {
  const localHooks: EffectiveAgentHook[] = listAgentHooks().map((hook) => ({
    ...hook,
    source: 'nightworkers_settings',
  }));
  const globalSettings = listCodexGlobalAgentHooks(projectRoot);
  const diagnostics = [...globalSettings.diagnostics];
  const usedNames = new Set(localHooks.map((hook) => hook.name));
  const usedIds = new Set(localHooks.map((hook) => hook.id));
  const globalHooks = globalSettings.hooks.flatMap((hook) => {
    if (usedNames.has(hook.name)) {
      diagnostics.push({
        level: 'warning',
        path: `hooks.${hook.name}`,
        message: `Skipped Codex global hook ${hook.name}: name conflicts with NightWorkers settings.`,
      });
      return [];
    }
    if (usedIds.has(hook.id)) {
      diagnostics.push({
        level: 'warning',
        path: `hooks.${hook.name}`,
        message: `Skipped Codex global hook ${hook.name}: generated id conflicts with NightWorkers settings.`,
      });
      return [];
    }
    usedNames.add(hook.name);
    usedIds.add(hook.id);
    return [hook];
  });

  return {
    hooks: [...localHooks, ...globalHooks],
    diagnostics,
  };
}

export function listEffectiveAgentHooks(projectRoot = process.cwd()): EffectiveAgentHook[] {
  return readEffectiveAgentHooksSettings(projectRoot).hooks;
}
