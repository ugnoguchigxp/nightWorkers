import { describe, expect, it } from 'vitest';
import {
  buildRuntimeLaneInitialTodos,
  buildRuntimeLaneOptions,
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
    const nativeTodos = buildRuntimeLaneInitialTodos('native-api-runner', {
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

  it('does not create implementation Todos for planning mode', () => {
    expect(
      buildRuntimeLaneInitialTodos('native-api-runner', {
        compiledPromptText: '実装計画を作ってください。',
        executionMode: 'planning',
      })
    ).toEqual([]);
  });

  it('does not create implementation Todos for general answers', () => {
    expect(
      buildRuntimeLaneInitialTodos('codex-sdk', {
        compiledPromptText: 'バックエンドを使わない構成でしょうか？',
        executionMode: 'general_answer',
      })
    ).toEqual([]);
    expect(
      buildRuntimeLaneInitialTodos('native-api-runner', {
        compiledPromptText: 'バックエンドを使わない構成でしょうか？',
        executionMode: 'general_answer',
      })
    ).toEqual([]);
  });

  it('creates review-specific Todos and role metadata for review mode', () => {
    const todos = buildRuntimeLaneInitialTodos('native-api-runner', {
      compiledPromptText: 'コードレビューから再開できますか？',
      executionMode: 'review',
    });
    const runtimeOptions = buildRuntimeLaneOptions({
      compiledPromptText: 'コードレビューから再開できますか？',
      executionMode: 'review',
    });

    expect(todos).toMatchObject([
      { title: 'レビュー対象と差分を確認する', taskType: 'inspection' },
      { title: 'レビュー結果を根拠付きで整理する', taskType: 'focused_verification' },
    ]);
    expect(todos.some((todo) => todo.taskType === 'implementation')).toBe(false);
    expect(runtimeOptions).toMatchObject({
      executionMode: 'review',
      llmRouting: {
        activeRole: 'review',
        executionMode: 'review',
      },
    });
  });

  it('defaults runtime lane resolution to native api runner', () => {
    expect(resolveRuntimeLane()).toMatchObject({
      lane: 'native-api-runner',
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
        taskRuntimeLane: 'native-api-runner',
        queueRuntimeLane: 'codex-agent',
        settingsRuntimeLane: 'codex-agent',
        envRuntimeLane: 'codex-agent',
        activeLlmProvider: 'codex',
        codexEnabled: true,
      })
    ).toMatchObject({ lane: 'native-api-runner', source: 'task' });

    expect(
      resolveRuntimeLane({
        queueRuntimeLane: 'codex-agent',
        settingsRuntimeLane: 'native-api-runner',
        envRuntimeLane: 'native-api-runner',
      })
    ).toMatchObject({ lane: 'codex-sdk', source: 'queue' });

    expect(
      resolveRuntimeLane({
        settingsRuntimeLane: 'native-api-runner',
        envRuntimeLane: 'codex-agent',
        activeLlmProvider: 'codex',
        codexEnabled: true,
      })
    ).toMatchObject({ lane: 'native-api-runner', source: 'settings' });
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

  it('lets explicit settings keep Codex provider execution on the native api runner lane', () => {
    expect(
      resolveRuntimeLane({
        settingsRuntimeLane: 'native-api-runner',
        activeLlmProvider: 'codex',
        codexEnabled: true,
      })
    ).toMatchObject({
      lane: 'native-api-runner',
      workerKind: 'native-local',
      source: 'settings',
    });
  });

  it('keeps disabled Codex provider settings on the native api runner lane', () => {
    expect(
      resolveRuntimeLane({
        activeLlmProvider: 'codex',
        codexEnabled: false,
      })
    ).toMatchObject({
      lane: 'native-api-runner',
      workerKind: 'native-local',
      source: 'provider_default',
    });
  });
});
