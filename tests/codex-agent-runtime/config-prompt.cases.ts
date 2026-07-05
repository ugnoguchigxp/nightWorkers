import { describe, expect, it, vi } from 'vitest';
import { getNightWorkersCodexToolNames } from '../../api/mcp/nightworkers-tool-manifest';
import {
  buildCodexRuntimePrompt,
  buildCodexRuntimePromptParts,
  CodexAgentRuntime,
} from '../../api/services/agent-runtime/CodexAgentRuntime';
import {
  buildCodexRuntimeSdkOptions,
  buildCodexRuntimeThreadOptions,
  resolveCodexRuntimeMcpConfigState,
} from '../../api/services/agent-runtime/codex-runtime-config';
import { createCodexRuntimeThread } from '../../api/services/agent-runtime/codex-sdk/codex-sdk-client';
import { buildOntologyBoundaryAuditSnapshot } from '../../api/services/agent-runtime/ontology-runtime-context';
import { buildContext, fakeThread } from './helpers';
import './setup';

describe('CodexAgentRuntime config and prompt', () => {
  it('builds runtime Codex options without structured provider feature suppression', () => {
    const options = buildCodexRuntimeSdkOptions({
      accessToken: 'runtime-token',
      env: {
        PATH: '/usr/bin',
        CODEX_THREAD_ID: 'parent-thread',
        CODEX_SHELL: '1',
        NIGHTWORKERS_CODEX_MCP_URL: 'http://127.0.0.1:39173/mcp/nightworkers',
        NIGHTWORKERS_TASK_ID: 'task-codex',
        NIGHTWORKERS_RUN_ID: 'run-codex',
        DATABASE_URL: 'file:/tmp/nightworkers.sqlite',
        JWT_SECRET: 'secret-with-enough-length-for-tests',
        NIGHTWORKERS_DESKTOP: '1',
        NIGHTWORKERS_RUNTIME_DIR: '/tmp/nightworkers-runtime',
      } as never,
    });

    expect(options.config).toMatchObject({
      features: { mcp: true },
      mcp_servers: {
        nightworkers: {
          transport: 'streamable_http',
          url: 'http://127.0.0.1:39173/mcp/nightworkers?taskId=task-codex&runId=run-codex',
          tools: {
            read_current_specification: { approval_mode: 'approve' },
            list_recent_specifications: { approval_mode: 'approve' },
            todo_list: { approval_mode: 'approve' },
            import_project: { approval_mode: 'approve' },
          },
        },
      },
    });
    expect(options.env).toMatchObject({
      PATH: '/usr/bin',
      CODEX_ACCESS_TOKEN: 'runtime-token',
    });
    expect(options.env?.CODEX_THREAD_ID).toBeUndefined();
    expect(options.env?.CODEX_SHELL).toBeUndefined();
  });

  it('configures the Hono-hosted NightWorkers MCP by default', () => {
    const options = buildCodexRuntimeSdkOptions({
      accessToken: 'runtime-token',
      env: {
        PATH: '/usr/bin',
        CODEX_THREAD_ID: 'parent-thread',
        PORT: '49200',
      } as never,
    });

    expect(options.config).toMatchObject({
      features: { mcp: true },
      mcp_servers: {
        nightworkers: {
          transport: 'streamable_http',
          url: 'http://127.0.0.1:49200/mcp/nightworkers',
        },
      },
    });
    expect(options.env).toMatchObject({
      PATH: '/usr/bin',
      CODEX_ACCESS_TOKEN: 'runtime-token',
    });
    expect(options.env?.CODEX_THREAD_ID).toBeUndefined();
  });

  it('resumes a compatible Codex SDK thread when runtime resume state is present', async () => {
    const resumedThread = fakeThread([]);
    const freshThread = fakeThread([]);
    const codexClient = {
      resumeThread: vi.fn(() => resumedThread),
      startThread: vi.fn(() => freshThread),
    };
    const resumeEvents: unknown[] = [];

    const thread = await createCodexRuntimeThread({
      context: {
        ...buildContext(),
        contextSnapshot: {
          ...buildContext().contextSnapshot,
          runtimeResume: {
            kind: 'codex_thread',
            stateId: 'state-1',
            providerThreadId: 'codex-thread-1',
          },
        },
      },
      codexClient,
      onResumeEvent: (event) => {
        resumeEvents.push(event);
      },
    });

    expect(thread).toBe(resumedThread);
    expect(codexClient.resumeThread).toHaveBeenCalledWith(
      'codex-thread-1',
      expect.objectContaining({ workingDirectory: expect.any(String) })
    );
    expect(codexClient.startThread).not.toHaveBeenCalled();
    expect(resumeEvents).toEqual([
      { status: 'reused', providerThreadId: 'codex-thread-1', stateId: 'state-1' },
    ]);
  });

  it('falls back to a fresh Codex SDK thread when resumeThread is rejected', async () => {
    const freshThread = fakeThread([]);
    const codexClient = {
      resumeThread: vi.fn(() => {
        throw new Error('resume rejected');
      }),
      startThread: vi.fn(() => freshThread),
    };
    const resumeEvents: unknown[] = [];

    const thread = await createCodexRuntimeThread({
      context: {
        ...buildContext(),
        contextSnapshot: {
          ...buildContext().contextSnapshot,
          runtimeResume: {
            kind: 'codex_thread',
            stateId: 'state-stale',
            providerThreadId: 'codex-thread-stale',
          },
        },
      },
      codexClient,
      onResumeEvent: (event) => {
        resumeEvents.push(event);
      },
    });

    expect(thread).toBe(freshThread);
    expect(codexClient.resumeThread).toHaveBeenCalledOnce();
    expect(codexClient.startThread).toHaveBeenCalledOnce();
    expect(resumeEvents).toEqual([
      {
        status: 'fallback_started_fresh',
        providerThreadId: 'codex-thread-stale',
        stateId: 'state-stale',
        error: 'resume rejected',
      },
    ]);
  });

  it('derives the Hono-hosted NightWorkers MCP URL from the API origin', () => {
    const originOptions = buildCodexRuntimeSdkOptions({
      env: {
        NIGHTWORKERS_API_ORIGIN: 'http://127.0.0.1:49300',
      } as never,
    });
    expect(originOptions.config).toMatchObject({
      mcp_servers: {
        nightworkers: {
          url: 'http://127.0.0.1:49300/mcp/nightworkers',
        },
      },
    });

    const explicitPathOptions = buildCodexRuntimeSdkOptions({
      env: {
        NIGHTWORKERS_API_ORIGIN: 'http://127.0.0.1:49300/mcp/nightworkers',
      } as never,
    });
    expect(explicitPathOptions.config).toMatchObject({
      mcp_servers: {
        nightworkers: {
          url: 'http://127.0.0.1:49300/mcp/nightworkers',
        },
      },
    });
  });

  it('resolves Codex MCP config source to the Hono-hosted inline server', () => {
    expect(
      resolveCodexRuntimeMcpConfigState({
        env: { NIGHTWORKERS_CODEX_MCP_URL: 'http://127.0.0.1:39173/mcp/nightworkers' } as never,
      })
    ).toMatchObject({
      source: 'inline_configured',
      hasInlineNightWorkersMcp: true,
      serverName: 'nightworkers',
      expectedTools: getNightWorkersCodexToolNames(),
    });
    expect(resolveCodexRuntimeMcpConfigState({ env: {} as never })).toMatchObject({
      source: 'inline_configured',
      hasInlineNightWorkersMcp: true,
      serverName: 'nightworkers',
    });
    expect(resolveCodexRuntimeMcpConfigState({ enableNightworkersMcp: false })).toMatchObject({
      source: 'disabled',
      hasInlineNightWorkersMcp: false,
    });
  });

  it('can explicitly disable MCP for Codex runtime', () => {
    const options = buildCodexRuntimeSdkOptions({
      enableNightworkersMcp: false,
      env: { PATH: '/usr/bin' } as never,
    });

    expect(options.config).toMatchObject({
      features: { mcp: false },
      mcp_servers: {},
    });
  });

  it('builds runtime thread options from the repository root', () => {
    const options = buildCodexRuntimeThreadOptions(
      buildContext({
        repoRoot: '/repo/project',
        codex: { model: 'gpt-5.3-codex', thinkingDepth: 'very_high' },
      })
    );

    expect(options).toMatchObject({
      model: 'gpt-5.3-codex',
      modelReasoningEffort: 'xhigh',
      sandboxMode: 'workspace-write',
      approvalPolicy: 'never',
      networkAccessEnabled: false,
      webSearchMode: 'disabled',
      skipGitRepoCheck: true,
      workingDirectory: '/repo/project',
    });
  });

  it('adds NightWorkers MCP planning guidance to the Codex runtime prompt', () => {
    const prompt = buildCodexRuntimePrompt(
      buildContext({
        latestUserMessage: '実装計画書を作ってください',
      })
    );

    expect(prompt).toContain('実装計画書を作ってください');
    expect(prompt).toContain('[NightWorkers Runtime Contract]');
    expect(prompt).toContain('taskId: task-codex');
    expect(prompt).toContain('runId: run-codex');
    expect(prompt).toContain('executionMode: implementation');
    expect(prompt).toContain('Plan mode: disabled');
    expect(prompt).toContain('Plan Mode を明示していない');
    expect(prompt).toContain('context-still.initial_instructions');
    expect(prompt).toContain(getNightWorkersCodexToolNames().join(', '));
    expect(prompt).toContain('nightworkers.todo_list');
    expect(prompt).toContain('operation=replace');
    expect(prompt).toContain('operation=done');
    expect(prompt).toContain('Minimal implementation behavior:');
    expect(prompt).toContain('計画文書で止まらず、必要最小限の確認後に実装へ進む');
    expect(prompt).toContain('詳細な implementation-plan artifact を作らない');
    expect(prompt).toContain(
      'LLM コードレビュー、品質ゲート verify コマンド、closeout は省略しない'
    );
    expect(prompt).toContain('data_migration.add_integration_test');
    expect(prompt).toContain('既存 migration を使う実 DB focused integration test');
    expect(prompt).toContain('テスト内で schema を手書き再現せず');
    expect(prompt).toContain('小さいコード変更で仕様 artifact がないことだけを理由に停止しない');
    expect(prompt).toContain(
      'Execution order: specification -> Todo execution -> verification -> closeout.'
    );
    expect(prompt).toContain('Planning is not closeout');
    expect(prompt).toContain('do not call context-still.compile_eval');
    expect(prompt).toContain(
      'closeout starts only after implementation and verification are genuinely finished'
    );
    expect(prompt).toContain('「完了報告を行う」closeout gate の final assistant report');
    expect(prompt).toContain('Todo 作成結果、計画共有、途中経過');
    expect(prompt).toContain(
      'open Todo が completion_report だけになった final assistant report 直前'
    );
    expect(prompt).toContain(
      'nightworkers.todo_list operation=replace 直後や context_compile 直後'
    );
    expect(prompt).toContain('TodoList pane is the user-visible progress source of truth');
    expect(prompt).toContain('Timeline cards are not the mechanism');
    expect(prompt).toContain('Do not call nightworkers.todo_list operation=list to make progress');
    expect(prompt).toContain('未確認 mutation や未実施 verification を done にしない');
    expect(prompt).toContain(
      'ファイルを編集する前に、対象ファイルまたは直接関係する既存ファイルを読む'
    );
    expect(prompt).toContain('rg --files や ls は探索');
    expect(prompt).toContain('nightworkers.read_current_specification');
    expect(prompt).toContain('nightworkers.list_recent_specifications');
    expect(prompt).toContain('For explicit planning, implementation-plan, specification');
    expect(prompt).toContain('implementation work grounded in an existing specification');
    expect(prompt).toContain('nightworkers.import_project');
    expect(prompt).not.toContain('nightworkers.materialize_template');
    expect(prompt).not.toContain('nightworkers.clone_git_repo');
    expect(prompt).not.toContain('nightworkers.run_command');
    expect(prompt).not.toContain('nightworkers.run_verification');
    expect(prompt).toContain('source=starter, stack=hono');
    expect(prompt).toContain('default SQLite variant');
    expect(prompt).toContain('Codex native command_execution events');
    expect(prompt).toContain('Do not create a fallback static app');
    expect(prompt).toContain('do not stop with a plan-only answer or next-steps summary');
    expect(prompt).toContain('Module ontology protocol:');
    expect(prompt).toContain('nightworkers.classify_goal');
    expect(prompt).toContain('nightworkers.compile_module_context');
    expect(prompt).toContain('nightworkers.check_boundary');
    expect(prompt).toContain('nightworkers.get_verification_plan');
    expect(prompt).toContain('primary module, secondary modules, boundary crossings');
  });

  it('includes ontology runtime snapshot in Codex prompt when present', () => {
    const prompt = buildCodexRuntimePrompt(
      buildContext({
        ontologyContext: {
          version: 1,
          available: true,
          primaryModule: 'project-detail',
          secondaryModules: ['mission-planner'],
          summaryType: 'task_scoped',
          taskGenerationEvidence: true,
          taskCandidateId: 'candidate-1',
          ownedPaths: ['api/modules/project-detail/**'],
          invariants: ['candidate-routing'],
          focusedVerification: ['bunx vitest run tests/project-detail-backend.test.ts'],
          boundaryWarnings: ['Do not change provider routing policy.'],
          warnings: [],
        },
      })
    );

    expect(prompt).toContain('Ontology runtime snapshot:');
    expect(prompt).toContain('primary module: project-detail');
    expect(prompt).toContain('secondary modules: mission-planner');
    expect(prompt).toContain('task generation evidence: present');
    expect(prompt).toContain('focused verification candidates');
    expect(prompt).toContain('Ontology closeout requirements:');
  });

  it('keeps boundary audit unavailable when no touched files are present', async () => {
    const audit = await buildOntologyBoundaryAuditSnapshot({
      repoRoot: process.cwd(),
      ontologyContext: {
        version: 1,
        available: true,
        primaryModule: 'project-detail',
        secondaryModules: [],
        focusedVerification: ['bunx vitest run tests/project-detail-backend.test.ts'],
      },
      touchedFiles: [],
    });

    expect(audit).toMatchObject({
      available: false,
      source: 'unavailable',
      verificationSelection: {
        focused: ['bunx vitest run tests/project-detail-backend.test.ts'],
      },
    });
    expect(audit.warnings[0]).toContain('No touched files');
  });

  it('records declared secondary module crossings in boundary audit', async () => {
    const audit = await buildOntologyBoundaryAuditSnapshot({
      repoRoot: process.cwd(),
      ontologyContext: {
        version: 1,
        available: true,
        primaryModule: 'project-detail',
        secondaryModules: ['mission-planner'],
        focusedVerification: ['bunx vitest run tests/project-detail-backend.test.ts'],
      },
      touchedFiles: ['api/modules/mission-planner/mission-planner.service.ts'],
    });

    expect(audit).toMatchObject({
      available: true,
      decision: 'allow_with_crossing',
      primaryModule: 'project-detail',
      boundaryCrossings: [
        expect.objectContaining({
          module: 'mission-planner',
          declaredSecondary: true,
          paths: ['api/modules/mission-planner/mission-planner.service.ts'],
        }),
      ],
      verificationSelection: {
        focused: ['bunx vitest run tests/project-detail-backend.test.ts'],
        warnings: [],
      },
    });
  });

  it('builds Codex runtime prompt parts without changing the prompt string', () => {
    const context = buildContext({
      latestUserMessage: '仕様に沿って実装してください',
    });
    const prompt = buildCodexRuntimePrompt(context);
    const parts = buildCodexRuntimePromptParts(context);

    expect(parts.prompt).toBe(prompt);
    expect(parts.request).toBe('仕様に沿って実装してください');
    expect(parts.runtimeContract).toContain('[NightWorkers Runtime Contract]');
    expect(parts.estimates.requestTokens).toBeGreaterThan(0);
    expect(parts.estimates.runtimeContractTokens).toBeGreaterThan(0);
    expect(parts.estimates.fullPromptTokens).toBeGreaterThan(parts.estimates.requestTokens);
  });

  it('marks Codex runtime prompt as planning only for planning executionMode', () => {
    const prompt = buildCodexRuntimePrompt(
      buildContext({
        latestUserMessage: '実装計画書を作ってください',
        executionMode: 'planning',
      })
    );

    expect(prompt).toContain('executionMode: planning');
    expect(prompt).toContain('Plan mode: enabled');
    expect(prompt).toContain('実装編集は行わない');
    expect(prompt).toContain(
      getNightWorkersCodexToolNames({ executionMode: 'planning' }).join(', ')
    );
    expect(prompt).not.toContain('nightworkers.todo_list');
    expect(prompt).not.toContain('nightworkers.import_project');
  });

  it('removes mutating NightWorkers MCP tools from planning Codex inline config', () => {
    const options = buildCodexRuntimeSdkOptions({
      env: {
        NIGHTWORKERS_EXECUTION_MODE: 'planning',
        NIGHTWORKERS_CODEX_MCP_URL: 'http://127.0.0.1:39173/mcp/nightworkers',
      } as never,
    });

    expect(options.config).toMatchObject({
      mcp_servers: {
        nightworkers: {
          tools: {
            read_current_specification: { approval_mode: 'approve' },
            list_recent_specifications: { approval_mode: 'approve' },
          },
        },
      },
    });
    expect(
      (options.config as { mcp_servers?: { nightworkers?: { tools?: Record<string, unknown> } } })
        .mcp_servers?.nightworkers?.tools
    ).not.toHaveProperty('todo_list');
    expect(
      (options.config as { mcp_servers?: { nightworkers?: { tools?: Record<string, unknown> } } })
        .mcp_servers?.nightworkers?.tools
    ).not.toHaveProperty('import_project');
    expect(
      resolveCodexRuntimeMcpConfigState({
        env: { NIGHTWORKERS_EXECUTION_MODE: 'planning' } as never,
      }).expectedTools
    ).toEqual(getNightWorkersCodexToolNames({ executionMode: 'planning' }));
  });

  it('emits planning runtime contract with read-only NightWorkers MCP tools', async () => {
    const runtime = new CodexAgentRuntime({
      threadFactory: () =>
        fakeThread([
          { type: 'thread.started', thread_id: 'codex-thread-1' },
          { type: 'item.completed', item: { id: 'msg-1', type: 'agent_message', text: 'plan' } },
        ] as never),
    });
    const events: unknown[] = [];

    await runtime.start(buildContext({ executionMode: 'planning' }), {
      emit: async (event) => {
        events.push(event);
      },
    });

    const runtimeStarted = events.find(
      (event) => (event as { type?: string }).type === 'runtime_started'
    ) as { payload?: { runtimeContract?: { mcp?: { expectedTools?: string[] } } } };
    expect(runtimeStarted?.payload?.runtimeContract?.mcp?.expectedTools).toEqual(
      getNightWorkersCodexToolNames({ executionMode: 'planning' })
    );
    expect(runtimeStarted?.payload?.runtimeContract?.mcp?.expectedTools).not.toContain(
      'nightworkers.todo_list'
    );
    expect(runtimeStarted?.payload?.runtimeContract?.mcp?.expectedTools).not.toContain(
      'nightworkers.import_project'
    );
  });

  it('keeps general answer prompts separate from implementation contracts', () => {
    const prompt = buildCodexRuntimePrompt(
      buildContext({
        latestUserMessage: 'バックエンド使わない構成でしょうか？',
        executionMode: 'general_answer',
      })
    );

    expect(prompt).toContain('executionMode: general_answer');
    expect(prompt).toContain('General answer behavior:');
    expect(prompt).toContain('質問に答えるための読み取り確認だけ');
    expect(prompt).toContain('Plan Mode artifact、Plan Mode Workspace、TodoList');
    expect(prompt).not.toContain('Minimal implementation behavior:');
    expect(prompt).not.toContain('nightworkers.todo_list');
    expect(prompt).not.toContain('LLM コードレビュー、品質ゲート verify コマンド、closeout');
    expect(prompt).not.toContain('Execution order: specification -> Todo execution');
    expect(prompt).not.toContain('implementation-plan artifact を主成果物');
  });

  it('passes the composed runtime prompt to Codex threads', async () => {
    const thread = fakeThread([
      { type: 'turn.started' },
      { type: 'item.completed', item: { id: 'msg-1', type: 'agent_message', text: 'done' } },
    ]);
    const runtime = new CodexAgentRuntime({
      threadFactory: () => thread,
    });

    await runtime.start(buildContext({ latestUserMessage: '仕様に沿って計画して' }), {
      emit: async () => {},
    });

    expect(thread.runStreamed).toHaveBeenCalledWith(
      expect.stringContaining('nightworkers.read_current_specification'),
      expect.any(Object)
    );
  });
});
