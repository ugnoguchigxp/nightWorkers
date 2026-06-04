import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMcpServer } from '../api/services/mcp/mcp-settings';
import {
  buildCodexSupervisorSdkOptions,
  buildCodexSupervisorThreadOptions,
  callSupervisorLLM,
} from '../api/services/supervisor/llm-provider';
import { buildRound2SystemPrompt } from '../api/services/supervisor/prompt';

describe('Supervisor LLM provider evidence fallback', () => {
  const originalProvider = process.env.ACTIVE_LLM_PROVIDER;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalMcpSettingsPath = process.env.NIGHTWORKERS_MCP_SETTINGS_PATH;
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nightworkers-supervisor-mcp-'));
    process.env.NIGHTWORKERS_MCP_SETTINGS_PATH = path.join(tempDir, 'mcp-servers.json');
    process.env.ACTIVE_LLM_PROVIDER = 'fixture';
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalMcpSettingsPath === undefined) {
      delete process.env.NIGHTWORKERS_MCP_SETTINGS_PATH;
    } else {
      process.env.NIGHTWORKERS_MCP_SETTINGS_PATH = originalMcpSettingsPath;
    }
    if (originalProvider === undefined) {
      delete process.env.ACTIVE_LLM_PROVIDER;
    } else {
      process.env.ACTIVE_LLM_PROVIDER = originalProvider;
    }
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it('keeps evidence tool selection in the prompt-driven fixture path', async () => {
    const decision = await callSupervisorLLM(
      buildRound2SystemPrompt(),
      JSON.stringify({
        latestUserMessage:
          'spec/jsonl-replay-import-regression-implementation-plan.md のドキュメントレビューをしてください',
        round1Decision: {
          phase: 'plan',
          workflow: 'evidence_review',
          instruction: 'Review the requested specification document.',
          rationale: 'Need repository evidence.',
          finalResponse: '',
          expectedEvidence: ['spec document contents'],
          riskLevel: 'medium',
          toolCall: null,
        },
        observations: [],
      }),
      { round: 2 }
    );

    expect(decision.phase).toBe('act');
    expect(decision.workflow).toBe('evidence_review');
    expect(decision.toolCall).toEqual({
      name: 'read_file',
      arguments: {
        filePath: 'spec/jsonl-replay-import-regression-implementation-plan.md',
      },
    });
  });

  it('allows a stop decision after repository observations have been supplied', async () => {
    const decision = await callSupervisorLLM(
      buildRound2SystemPrompt(),
      JSON.stringify({
        latestUserMessage:
          'spec/jsonl-replay-import-regression-implementation-plan.md のドキュメントレビューをしてください',
        round1Decision: {
          phase: 'plan',
          workflow: 'evidence_review',
          instruction: 'Review the requested specification document.',
          rationale: 'Need repository evidence.',
          finalResponse: '',
          expectedEvidence: ['spec document contents'],
          riskLevel: 'medium',
          toolCall: null,
        },
        observations: ['tool=read_file status=ok\n# implementation plan'],
      }),
      { round: 2 }
    );

    expect(decision.phase).toBe('stop');
    expect(decision.workflow).toBe('evidence_review');
    expect(decision.toolCall).toBeNull();
    expect(decision.finalResponse).toContain('after reading repository evidence');
  });

  it('normalizes structured expectedEvidence objects before schema validation', async () => {
    const decision = await callSupervisorLLM(
      buildRound2SystemPrompt(),
      'E2E_OBJECT_EVIDENCE_FIXTURE',
      { round: 1 }
    );

    expect(decision.phase).toBe('plan');
    expect(decision.workflow).toBe('evidence_review');
    expect(decision.expectedEvidence).toEqual([
      'spec/implementation-queue-redesign-plan.md: 1-200: implementation plan consistency',
      'api/services/supervisor/llm-provider.ts: supervisor decision parsing',
    ]);
  });

  it('normalizes namespaced MCP tool calls into the internal bridge tool', async () => {
    const server = createMcpServer({
      name: 'Fixture MCP',
      enabled: true,
      transport: 'stdio',
      command: 'node',
      args: ['fixture-server.js'],
      toolPrefix: 'fixture_server',
    });

    const decision = await callSupervisorLLM(
      buildRound2SystemPrompt(),
      'E2E_MCP_NAMESPACED_TOOL_FIXTURE',
      { round: 2 }
    );

    expect(decision.toolCall).toEqual({
      name: 'mcp_call_tool',
      arguments: {
        serverId: server.id,
        toolName: 'lookup',
        arguments: {
          query: 'nightworkers',
        },
      },
    });
  });

  it('emits supervisor LLM debug lifecycle events through the optional sink', async () => {
    const events: Array<{ type: string; message: string }> = [];

    const decision = await callSupervisorLLM(buildRound2SystemPrompt(), 'fixture smoke', {
      round: 1,
      emitEvent: (event) => events.push({ type: event.type, message: event.message }),
    });

    expect(decision.phase).toBe('plan');
    expect(events.map((event) => event.type)).toEqual([
      'model.request_started',
      'model.response_finished',
    ]);
  });

  it('isolates Codex supervisor calls from image and plugin features', () => {
    const options = buildCodexSupervisorSdkOptions('');

    expect(options).toEqual({
      config: {
        features: {
          image_generation: false,
          plugins: false,
          computer_use: false,
          browser_use: false,
          browser_use_external: false,
          in_app_browser: false,
          multi_agent: false,
          workspace_dependencies: false,
          tool_search: false,
        },
      },
    });
  });

  it('passes Codex access token while preserving supervisor feature isolation', () => {
    const originalPath = process.env.PATH;
    process.env.PATH = '/usr/bin';

    try {
      const options = buildCodexSupervisorSdkOptions('codex-token');

      expect(options.config).toEqual({
        features: {
          image_generation: false,
          plugins: false,
          computer_use: false,
          browser_use: false,
          browser_use_external: false,
          in_app_browser: false,
          multi_agent: false,
          workspace_dependencies: false,
          tool_search: false,
        },
      });
      expect(options.env).toMatchObject({
        PATH: '/usr/bin',
        CODEX_ACCESS_TOKEN: 'codex-token',
      });
    } finally {
      if (originalPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = originalPath;
      }
    }
  });

  it('runs Codex supervisor calls from the repository workspace', () => {
    const options = buildCodexSupervisorThreadOptions('gpt-5.4-mini', '/repo/project');

    expect(options).toMatchObject({
      model: 'gpt-5.4-mini',
      sandboxMode: 'workspace-write',
      approvalPolicy: 'never',
      networkAccessEnabled: false,
      webSearchMode: 'disabled',
      skipGitRepoCheck: true,
    });
    expect(options.sandboxMode).not.toBe('read-only');
    expect(options.workingDirectory).toBe('/repo/project');
  });
});

describe('Supervisor LLM OpenAI streaming', () => {
  const originalProvider = process.env.ACTIVE_LLM_PROVIDER;
  const originalOpenAiEnabled = process.env.OPENAI_ENABLED;
  const originalOpenAiKey = process.env.OPENAI_API_KEY;
  const originalOpenAiModel = process.env.OPENAI_MODEL;
  const originalStreaming = process.env.OPENAI_STREAMING_ENABLED;
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    if (originalProvider === undefined) delete process.env.ACTIVE_LLM_PROVIDER;
    else process.env.ACTIVE_LLM_PROVIDER = originalProvider;
    if (originalOpenAiEnabled === undefined) delete process.env.OPENAI_ENABLED;
    else process.env.OPENAI_ENABLED = originalOpenAiEnabled;
    if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalOpenAiKey;
    if (originalOpenAiModel === undefined) delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = originalOpenAiModel;
    if (originalStreaming === undefined) delete process.env.OPENAI_STREAMING_ENABLED;
    else process.env.OPENAI_STREAMING_ENABLED = originalStreaming;
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('assembles streamed Chat Completions deltas and emits response_delta events', async () => {
    process.env.ACTIVE_LLM_PROVIDER = 'openai';
    process.env.OPENAI_ENABLED = 'true';
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.OPENAI_MODEL = 'gpt-test';
    process.env.OPENAI_STREAMING_ENABLED = 'true';

    const streamedJson =
      '{"phase":"stop","workflow":"general","instruction":"done","rationale":"ok","finalResponse":"done","expectedEvidence":[],"terminalState":"completed","riskLevel":"low","toolCall":null}';
    const chunks = [streamedJson.slice(0, 80), streamedJson.slice(80)];
    const streamBody = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: chunks[0] } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: chunks[1] } }] })}`,
    ].join('');

    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}'));
      expect(body.stream).toBe(true);
      return new Response(streamBody, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const events: Array<{ type: string; message: string }> = [];
    const decision = await callSupervisorLLM('system', 'user', {
      round: 1,
      emitEvent: (event) => events.push({ type: event.type, message: event.message }),
    });

    expect(decision.phase).toBe('stop');
    expect(decision.finalResponse).toBe('done');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(events.some((event) => event.type === 'model.response_delta')).toBe(true);
    expect(events.find((event) => event.type === 'model.response_delta')?.message).toContain(
      '"phase":"stop"'
    );
  });

  it('returns plain text supervisor output visibly instead of substituting a fallback message', async () => {
    process.env.ACTIVE_LLM_PROVIDER = 'openai';
    process.env.OPENAI_ENABLED = 'true';
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.OPENAI_MODEL = 'gpt-test';
    process.env.OPENAI_STREAMING_ENABLED = 'false';

    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: 'read-only sandbox のため編集できませんでした。',
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }) as unknown as typeof fetch;

    const events: Array<{ type: string; message: string }> = [];
    const decision = await callSupervisorLLM(
      buildRound2SystemPrompt('code_change'),
      JSON.stringify({
        latestUserMessage: 'Composer.tsx の送信ボタンを修正してください',
        round1Decision: {
          phase: 'plan',
          workflow: 'code_change',
          instruction: 'Change code',
          rationale: 'User requested an edit.',
          finalResponse: '',
          expectedEvidence: [],
          riskLevel: 'medium',
          toolCall: null,
        },
        observations: [],
      }),
      {
        round: 2,
        emitEvent: (event) => events.push({ type: event.type, message: event.message }),
      }
    );

    expect(decision).toMatchObject({
      phase: 'stop',
      terminalState: 'needs_human',
      riskLevel: 'high',
    });
    expect(decision.finalResponse).toBe('read-only sandbox のため編集できませんでした。');
    expect(decision.instruction).toBe('');
    expect(decision.rationale).toBe('');
    expect(events.some((event) => event.type === 'model.response_parse_failed')).toBe(true);
  });

  it('returns raw JSON visibly when a stop decision has no display fields', async () => {
    process.env.ACTIVE_LLM_PROVIDER = 'openai';
    process.env.OPENAI_ENABLED = 'true';
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.OPENAI_MODEL = 'gpt-test';
    process.env.OPENAI_STREAMING_ENABLED = 'false';

    const rawDecision = JSON.stringify({
      phase: 'stop',
      workflow: 'general',
      instruction: '',
      rationale: '',
      finalResponse: '',
      expectedEvidence: [],
      terminalState: 'completed',
      riskLevel: 'low',
      toolCall: null,
    });
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ choices: [{ message: { content: rawDecision } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const decision = await callSupervisorLLM('system', 'user', { round: 1 });

    expect(decision).toMatchObject({
      phase: 'stop',
      terminalState: 'needs_human',
      riskLevel: 'high',
    });
    expect(decision.finalResponse).toBe(rawDecision);
    expect(decision.instruction).toBe('');
    expect(decision.rationale).toBe('');
  });

  it('returns schema-invalid raw output visibly without adding fixed display text', async () => {
    process.env.ACTIVE_LLM_PROVIDER = 'openai';
    process.env.OPENAI_ENABLED = 'true';
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.OPENAI_MODEL = 'gpt-test';
    process.env.OPENAI_STREAMING_ENABLED = 'false';

    const rawDecision = JSON.stringify({
      phase: 'invalid_phase',
      finalResponse: 'LLM raw schema-invalid response',
    });
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ choices: [{ message: { content: rawDecision } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const decision = await callSupervisorLLM('system', 'user', { round: 1 });

    expect(decision).toMatchObject({
      phase: 'stop',
      terminalState: 'needs_human',
      riskLevel: 'high',
    });
    expect(decision.finalResponse).toBe(rawDecision);
    expect(decision.instruction).toBe('');
    expect(decision.rationale).toBe('');
  });
});
