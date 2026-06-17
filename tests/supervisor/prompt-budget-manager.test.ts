import { describe, expect, it } from 'vitest';
import { buildPromptBudget } from '../../api/services/supervisor/prompt-budget-manager';
import {
  parseRound2UserContextJsonSection,
  renderRound2UserContext,
} from '../../api/services/supervisor/user-context';

describe('PromptBudgetManager', () => {
  it('compresses Round 2 sections while preserving labels, JSON contracts, and Todo identity', () => {
    const systemPrompt = [
      'You must return parseable JSON.',
      'Allowed tools: todo_list, read_file, apply_patch, finalize_answer.',
      '{"toolCall":{"name":"finalize_answer","arguments":{"message":"string"}}}',
    ].join('\n');
    const longText = 'large-context '.repeat(900);
    const userPrompt = renderRound2UserContext({
      latestUserMessage: `${longText}latest request`,
      goal: `${longText}goal`,
      currentJobType: 'major_code_edit',
      workflow: 'major_code_edit',
      safetyPolicy: { allowed: true, note: longText },
      todoPlan: [
        {
          id: 'todo-1',
          seq: 1,
          title: `${longText}implementation`,
          status: 'running',
          taskType: 'implementation',
          procedureId: 'major_code_edit',
          description: longText,
          contextDigest: 'digest-1',
        },
      ],
      currentTodo: {
        id: 'todo-1',
        seq: 1,
        title: `${longText}implementation`,
        status: 'running',
        taskType: 'implementation',
        procedureId: 'major_code_edit',
        description: longText,
      },
      progressContext: {
        objective: `${longText}current implementation objective`,
        nextConcreteAction: '空の project root なので import_project を実行する',
        todoGuidance: `${longText}Todo is progress evidence, not the work itself.`,
        doNotRepeat: Array.from({ length: 8 }, (_, index) => `${index}:${longText}`),
        safeguards: Array.from({ length: 8 }, (_, index) => `${index}:${longText}`),
      },
      toolResults: [
        {
          step: 0,
          toolName: 'read_current_specification',
          ok: true,
          arguments: { taskId: 'task-1' },
          summary: longText,
          payload: {
            taskId: 'task-1',
            found: true,
            title: 'Context Budget Spec',
            digest: 'spec-digest',
            contentPreview: longText,
          },
        },
        {
          step: 0,
          toolName: 'context-still.context_compile',
          ok: true,
          arguments: { goal: longText },
          summary: longText,
          payload: { result: { content: [{ type: 'text', text: longText }] } },
        },
      ],
      loadedProcedureSummaries: [
        {
          jobType: 'major_code_edit',
          path: 'procedures/major_code_edit.md',
          digest: 'procedure-digest',
          useWhen: longText,
          procedure: Array.from({ length: 10 }, (_, index) => `${index}:${longText}`),
          requiredRules: Array.from({ length: 8 }, (_, index) => `${index}:${longText}`),
          loadedAtStep: 0,
        },
      ],
      artifactContextRefs: [],
      workspaceSnapshot: {
        isEmpty: false,
        topLevelDirs: Array.from({ length: 40 }, (_, index) => `dir-${index}`),
        topLevelFiles: Array.from({ length: 40 }, (_, index) => `file-${index}.ts`),
        truncated: true,
      },
    });

    const result = buildPromptBudget({
      systemPrompt,
      userPrompt,
      modelCapability: {
        providerEndpointId: 'local-qwen',
        model: 'qwen3-coder',
        contextWindowTokens: 7000,
        safePromptBudgetTokens: 5000,
        reservedOutputTokens: 2000,
        supportsProviderSideCompression: true,
        compressionProfile: 'balanced',
      },
    });

    expect(result.systemPrompt).toBe(systemPrompt);
    expect(result.userPrompt).toContain('[Latest User Request]');
    expect(result.userPrompt).toContain('[Current Execution State]');
    expect(result.userPrompt).toContain('[Progress Context]');
    expect(result.userPrompt).toContain('[Recent Tool Evidence]');
    expect(result.metadata.estimatedPromptTokensAfter).toBeLessThan(
      result.metadata.estimatedPromptTokensBefore
    );
    expect(result.metadata.budgetExceeded).toBe(false);
    expect(result.metadata.compressedSections).toEqual(
      expect.arrayContaining([
        'Current Execution State',
        'Recent Tool Evidence',
        'Loaded Procedure Summaries',
      ])
    );

    const executionState = parseRound2UserContextJsonSection<{
      todoPlan: Array<Record<string, unknown>>;
      currentTodo: Record<string, unknown>;
    }>(result.userPrompt, 'Current Execution State');
    expect(executionState.todoPlan[0]).toMatchObject({
      id: 'todo-1',
      seq: 1,
      status: 'running',
      taskType: 'implementation',
      procedureId: 'major_code_edit',
    });
    expect(executionState.todoPlan[0]).not.toHaveProperty('description');
    expect(executionState.todoPlan[0]).not.toHaveProperty('contextDigest');

    const progressContext = parseRound2UserContextJsonSection<{
      nextConcreteAction: string;
      doNotRepeat: string[];
    }>(result.userPrompt, 'Progress Context');
    expect(progressContext.nextConcreteAction).toBe(
      '空の project root なので import_project を実行する'
    );
    expect(progressContext.doNotRepeat.length).toBeLessThanOrEqual(5);

    const toolEvidence = parseRound2UserContextJsonSection<Array<Record<string, unknown>>>(
      result.userPrompt,
      'Recent Tool Evidence'
    );
    expect(toolEvidence[0]).toMatchObject({
      toolName: 'read_current_specification',
      payload: {
        title: 'Context Budget Spec',
        digest: 'spec-digest',
      },
    });
    expect(JSON.stringify(toolEvidence)).not.toContain(longText);
    expect(
      toolEvidence.find((item) => item.toolName === 'context-still.context_compile')
    ).not.toHaveProperty('payload');

    const procedures = parseRound2UserContextJsonSection<Array<{ procedure: string[] }>>(
      result.userPrompt,
      'Loaded Procedure Summaries'
    );
    expect(procedures[0].procedure.length).toBeLessThanOrEqual(6);
  });

  it('preserves recovery-critical missing path and directory evidence while compressing', () => {
    const longText = 'large-context '.repeat(900);
    const userPrompt = renderRound2UserContext({
      latestUserMessage: `${longText}latest request`,
      goal: `${longText}goal`,
      currentJobType: 'major_code_edit',
      workflow: 'major_code_edit',
      safetyPolicy: null,
      todoPlan: [],
      currentTodo: {
        id: 'todo-4',
        seq: 4,
        title: 'Todo List 用の型定義とストアを作成する',
        status: 'running',
        taskType: 'scaffold',
        procedureId: null,
      },
      progressContext: {
        objective: `${longText}objective`,
        nextConcreteAction:
          'read_file の web/src/routes/_authenticated/dashboard/route.tsx は存在しないことを確認済み。実在パスを使う。',
        todoGuidance: `${longText}guidance`,
        doNotRepeat: [
          'TodoList は既に作成済み。',
          '仕様書は既に読み込み済み。',
          'read_file の web/src/routes/_authenticated/dashboard/route.tsx は存在しないことを確認済み (4 回)。同じパスを繰り返さない。',
          'read_file の web/src/routes/root-route.tsx は直近 Todo で 5 回読んでいる。',
          'generic tail',
        ],
        safeguards: [],
      },
      toolResults: [
        {
          step: 1,
          toolName: 'list_dir',
          ok: true,
          arguments: { relativePath: 'web/src/routes', recursive: true },
          summary: longText,
          payload: {
            dirs: [],
            files: ['web/src/routes/root-route.tsx', 'web/src/routes/home-route.tsx'],
            truncated: false,
          },
        },
        {
          step: 2,
          toolName: 'read_file',
          ok: false,
          arguments: { filePath: 'web/src/routes/_authenticated/dashboard/route.tsx' },
          summary: longText,
          error: {
            code: 'FILE_NOT_FOUND',
            message: 'File not found: web/src/routes/_authenticated/dashboard/route.tsx',
          },
        },
      ],
      loadedProcedureSummaries: [],
      artifactContextRefs: [],
      workspaceSnapshot: {
        isEmpty: false,
        topLevelDirs: ['web'],
        topLevelFiles: ['package.json'],
        truncated: false,
      },
    });

    const result = buildPromptBudget({
      systemPrompt: 'Return JSON only.'.repeat(20),
      userPrompt,
      modelCapability: {
        providerEndpointId: 'local-qwen',
        model: 'qwen3-coder',
        contextWindowTokens: 7000,
        safePromptBudgetTokens: 5000,
        reservedOutputTokens: 2000,
        supportsProviderSideCompression: true,
        compressionProfile: 'balanced',
      },
    });

    const progressContext = parseRound2UserContextJsonSection<{
      doNotRepeat: string[];
    }>(result.userPrompt, 'Progress Context');
    expect(progressContext.doNotRepeat[0]).toContain('_authenticated/dashboard/route.tsx');

    const toolEvidence = parseRound2UserContextJsonSection<Array<Record<string, unknown>>>(
      result.userPrompt,
      'Recent Tool Evidence'
    );
    expect(toolEvidence[0]).toMatchObject({
      toolName: 'list_dir',
      payload: {
        files: ['web/src/routes/root-route.tsx', 'web/src/routes/home-route.tsx'],
      },
    });
    expect(toolEvidence[1]).toMatchObject({
      toolName: 'read_file',
      error: {
        code: 'FILE_NOT_FOUND',
      },
    });
  });

  it('uses configured large-window capability instead of a small global cap', () => {
    const userPrompt = renderRound2UserContext({
      latestUserMessage: 'x'.repeat(12_000),
      goal: 'large model should keep this prompt',
      currentJobType: 'major_code_edit',
      workflow: 'major_code_edit',
      safetyPolicy: null,
      todoPlan: [],
      currentTodo: null,
      progressContext: {
        objective: 'large prompt objective',
        nextConcreteAction: 'continue implementation',
        todoGuidance: 'Todo is progress evidence.',
        doNotRepeat: [],
        safeguards: [],
      },
      toolResults: [],
      loadedProcedureSummaries: [],
      artifactContextRefs: [],
      workspaceSnapshot: { isEmpty: false, topLevelDirs: [], topLevelFiles: [], truncated: false },
    });

    const result = buildPromptBudget({
      systemPrompt: 'system',
      userPrompt,
      modelCapability: {
        providerEndpointId: 'local-qwen-large',
        model: 'qwen3-coder-176k',
        contextWindowTokens: 180_000,
        safePromptBudgetTokens: 176_000,
        reservedOutputTokens: 4_000,
        supportsProviderSideCompression: true,
        compressionProfile: 'balanced',
      },
    });

    expect(result.userPrompt).toBe(userPrompt);
    expect(result.metadata.compressedSections).toEqual([]);
    expect(result.metadata.safePromptBudgetTokens).toBe(176_000);
    expect(result.metadata.budgetExceeded).toBe(false);
  });
});
