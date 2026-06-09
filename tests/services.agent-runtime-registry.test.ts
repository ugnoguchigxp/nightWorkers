import { describe, expect, it } from 'vitest';
import { resolveAgentRuntime } from '../api/services/agent-runtime/registry';
import { resolveRuntimeLane } from '../api/services/agent-runtime/runtime-lane';

describe('agent runtime registry', () => {
  it('resolves native-local and codex-agent runtimes', () => {
    expect(resolveAgentRuntime('native-local').kind).toBe('native-local');
    expect(resolveAgentRuntime('codex-agent').kind).toBe('codex-agent');
  });

  it('defaults runtime lane resolution to native supervisor', () => {
    expect(resolveRuntimeLane({ env: {} })).toMatchObject({
      lane: 'native-supervisor',
      workerKind: 'native-local',
      source: 'provider_default',
    });
  });

  it('allows env override for codex-agent without changing the default path', () => {
    expect(resolveRuntimeLane({ env: { NIGHTWORKERS_RUNTIME_LANE: 'codex-agent' } })).toMatchObject(
      {
        lane: 'codex-agent',
        workerKind: 'codex-agent',
        source: 'env',
      }
    );
  });

  it('uses codex-agent as the provider-derived default when Codex is active and enabled', () => {
    expect(
      resolveRuntimeLane({
        activeLlmProvider: 'codex',
        codexEnabled: true,
        env: {},
      })
    ).toMatchObject({
      lane: 'codex-agent',
      workerKind: 'codex-agent',
      source: 'provider_default',
    });
  });

  it('lets explicit settings keep Codex provider execution on the native supervisor lane', () => {
    expect(
      resolveRuntimeLane({
        settingsRuntimeLane: 'native-supervisor',
        activeLlmProvider: 'codex',
        codexEnabled: true,
        env: {},
      })
    ).toMatchObject({
      lane: 'native-supervisor',
      workerKind: 'native-local',
      source: 'settings',
    });
  });

  it('keeps disabled Codex provider settings on the native supervisor lane', () => {
    expect(
      resolveRuntimeLane({
        activeLlmProvider: 'codex',
        codexEnabled: false,
        env: {},
      })
    ).toMatchObject({
      lane: 'native-supervisor',
      workerKind: 'native-local',
      source: 'provider_default',
    });
  });
});
