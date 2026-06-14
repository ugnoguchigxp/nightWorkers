import { describe, expect, it } from 'vitest';
import {
  buildRuntimeLaneInitialTodos,
  resolveAgentRuntime,
} from '../api/services/agent-runtime/registry';
import {
  readRuntimeLaneConfigFromEnv,
  resolveRuntimeLane,
} from '../api/services/agent-runtime/runtime-lane';

describe('agent runtime registry', () => {
  it('resolves native-local and codex-agent runtimes', () => {
    expect(resolveAgentRuntime('native-local').kind).toBe('native-local');
    expect(resolveAgentRuntime('codex-agent').kind).toBe('codex-agent');
  });

  it('owns runtime-lane initial Todo setup', () => {
    const nativeTodos = buildRuntimeLaneInitialTodos('native-supervisor', {
      compiledPromptText: ['画面パス: `settings`', '## 機能要件', '1. 保存できる'].join('\n'),
    });
    const codexTodos = buildRuntimeLaneInitialTodos('codex-sdk', {
      compiledPromptText: '軽微な修正を実装してください。',
    });

    expect(nativeTodos).toMatchObject([
      { title: '仕様と既存構成を確認する', taskType: 'inspection' },
      { title: 'settings 画面の実装準備を行う', taskType: 'scaffold' },
      {
        title: 'settings 画面を仕様に沿って実装する',
        taskType: 'implementation',
        description: '保存できる を実装する。',
      },
      { title: '受け入れ条件を検証する', taskType: 'verification' },
    ]);
    expect(codexTodos).toMatchObject([
      { title: '対象変更を確認して実装する', taskType: 'implementation' },
      { title: '必要最小限の動作確認を行う', taskType: 'focused_verification' },
    ]);
  });

  it('defaults runtime lane resolution to native supervisor', () => {
    expect(resolveRuntimeLane()).toMatchObject({
      lane: 'native-supervisor',
      workerKind: 'native-local',
      source: 'provider_default',
    });
  });

  it('accepts codex-agent as a compatibility alias for the codex-sdk lane', () => {
    expect(
      resolveRuntimeLane(readRuntimeLaneConfigFromEnv({ NIGHTWORKERS_RUNTIME_LANE: 'codex-agent' }))
    ).toMatchObject({
      lane: 'codex-sdk',
      workerKind: 'codex-agent',
      source: 'env',
      diagnostics: [
        expect.objectContaining({
          level: 'info',
          message: expect.stringContaining('compatibility alias'),
        }),
      ],
    });
  });

  it('keeps the runtime lane priority at task, queue, settings, env, provider default', () => {
    expect(
      resolveRuntimeLane({
        taskRuntimeLane: 'native-supervisor',
        queueRuntimeLane: 'codex-agent',
        settingsRuntimeLane: 'codex-agent',
        envRuntimeLane: 'codex-agent',
        activeLlmProvider: 'codex',
        codexEnabled: true,
      })
    ).toMatchObject({ lane: 'native-supervisor', source: 'task' });

    expect(
      resolveRuntimeLane({
        queueRuntimeLane: 'codex-agent',
        settingsRuntimeLane: 'native-supervisor',
        envRuntimeLane: 'native-supervisor',
      })
    ).toMatchObject({ lane: 'codex-sdk', source: 'queue' });

    expect(
      resolveRuntimeLane({
        settingsRuntimeLane: 'native-supervisor',
        envRuntimeLane: 'codex-agent',
        activeLlmProvider: 'codex',
        codexEnabled: true,
      })
    ).toMatchObject({ lane: 'native-supervisor', source: 'settings' });
  });

  it('uses codex-sdk as the provider-derived compatibility default when Codex is active and enabled', () => {
    expect(
      resolveRuntimeLane({
        activeLlmProvider: 'codex',
        codexEnabled: true,
      })
    ).toMatchObject({
      lane: 'codex-sdk',
      workerKind: 'codex-agent',
      source: 'provider_default',
      diagnostics: [
        expect.objectContaining({
          level: 'warning',
          message: expect.stringContaining('IMPLEMENTATION_RUNTIME_LANE=codex-sdk'),
        }),
      ],
    });
  });

  it('lets explicit settings keep Codex provider execution on the native supervisor lane', () => {
    expect(
      resolveRuntimeLane({
        settingsRuntimeLane: 'native-supervisor',
        activeLlmProvider: 'codex',
        codexEnabled: true,
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
      })
    ).toMatchObject({
      lane: 'native-supervisor',
      workerKind: 'native-local',
      source: 'provider_default',
    });
  });
});
