import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildCodexSupervisorSdkOptions,
  buildCodexSupervisorThreadOptions,
  buildNormalizedSupervisorLlmRequest,
} from '../../api/services/supervisor/llm-provider';
import { readCodexStreamedTurn } from '../../api/services/supervisor/llm-provider/codex';
import {
  jsonFixWrapper,
  parseRepairedJsonWithSchema,
} from '../../api/services/supervisor/llm-provider/json';
import { questionnaireChoiceFormSchema } from '../../shared/schemas/design-questionnaire.schema';

describe('Supervisor LLM provider', () => {
  it('extracts fenced JSON with jsonFixWrapper', () => {
    const fixed = jsonFixWrapper('```json\n{"ok":true}\n```');

    expect(fixed).toMatchObject({
      parsedJson: { ok: true },
      repaired: true,
      repairKind: 'extracted_candidate',
    });
  });

  it('repairs truncated JSON before Zod schema validation', () => {
    const parsed = parseRepairedJsonWithSchema(
      '{"title":"実装前に決めたいこと","questions":[{"text":"範囲は？","type":"radio","options":["A","B"]}',
      questionnaireChoiceFormSchema
    );

    expect(parsed).toMatchObject({
      ok: true,
      repaired: true,
      repairKind: 'balanced_json',
    });
    if (parsed.ok) expect(parsed.value.questions[0]?.options).toEqual(['A', 'B']);
  });

  it('keeps raw output when repaired JSON fails schema validation', () => {
    const parsed = parseRepairedJsonWithSchema(
      '{"title":"x","questions":[]}',
      questionnaireChoiceFormSchema
    );

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.rawOutput).toBe('{"title":"x","questions":[]}');
  });

  it('isolates Codex supervisor calls from image and plugin features', () => {
    const originalThreadId = process.env.CODEX_THREAD_ID;
    const originalOriginator = process.env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE;
    const originalCodexHome = process.env.CODEX_HOME;
    const originalSupervisorHome = process.env.NIGHTWORKERS_CODEX_SUPERVISOR_HOME;
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'nightworkers-codex-home-'));
    const supervisorHome = fs.mkdtempSync(
      path.join(os.tmpdir(), 'nightworkers-codex-supervisor-home-')
    );
    fs.writeFileSync(path.join(codexHome, 'auth.json'), '{"token":"test"}');
    fs.writeFileSync(path.join(codexHome, 'AGENTS.md'), 'call initial_instructions');
    fs.writeFileSync(path.join(codexHome, 'config.toml'), '[mcp_servers.context-still]');
    process.env.CODEX_THREAD_ID = 'parent-thread';
    process.env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE = 'Codex Desktop';
    process.env.CODEX_HOME = codexHome;
    process.env.NIGHTWORKERS_CODEX_SUPERVISOR_HOME = supervisorHome;
    const options = buildCodexSupervisorSdkOptions('');

    try {
      expect(options.config).toEqual({
        features: {
          mcp: false,
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
        mcp_servers: {},
      });
      expect(options.env).toBeDefined();
      expect(options.env?.CODEX_THREAD_ID).toBeUndefined();
      expect(options.env?.CODEX_INTERNAL_ORIGINATOR_OVERRIDE).toBeUndefined();
      expect(options.env?.CODEX_HOME).toBe(supervisorHome);
      expect(fs.existsSync(path.join(supervisorHome, 'auth.json'))).toBe(true);
      expect(fs.existsSync(path.join(supervisorHome, 'AGENTS.md'))).toBe(false);
      expect(fs.existsSync(path.join(supervisorHome, 'config.toml'))).toBe(false);
    } finally {
      if (originalThreadId === undefined) delete process.env.CODEX_THREAD_ID;
      else process.env.CODEX_THREAD_ID = originalThreadId;
      if (originalOriginator === undefined) delete process.env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE;
      else process.env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE = originalOriginator;
      if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = originalCodexHome;
      if (originalSupervisorHome === undefined)
        delete process.env.NIGHTWORKERS_CODEX_SUPERVISOR_HOME;
      else process.env.NIGHTWORKERS_CODEX_SUPERVISOR_HOME = originalSupervisorHome;
      fs.rmSync(codexHome, { recursive: true, force: true });
      fs.rmSync(supervisorHome, { recursive: true, force: true });
    }
  });

  it('passes Codex access token while preserving supervisor feature isolation', () => {
    const originalPath = process.env.PATH;
    const originalShell = process.env.CODEX_SHELL;
    const originalSupervisorHome = process.env.NIGHTWORKERS_CODEX_SUPERVISOR_HOME;
    const supervisorHome = fs.mkdtempSync(
      path.join(os.tmpdir(), 'nightworkers-codex-supervisor-home-')
    );
    process.env.PATH = '/usr/bin';
    process.env.CODEX_SHELL = '1';
    process.env.NIGHTWORKERS_CODEX_SUPERVISOR_HOME = supervisorHome;

    try {
      const options = buildCodexSupervisorSdkOptions('codex-token');

      expect(options.config).toEqual({
        features: {
          mcp: false,
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
        mcp_servers: {},
      });
      expect(options.env).toMatchObject({
        PATH: '/usr/bin',
        CODEX_ACCESS_TOKEN: 'codex-token',
      });
      expect(options.env?.CODEX_SHELL).toBeUndefined();
      expect(options.env?.CODEX_HOME).toBe(supervisorHome);
    } finally {
      if (originalPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = originalPath;
      }
      if (originalShell === undefined) {
        delete process.env.CODEX_SHELL;
      } else {
        process.env.CODEX_SHELL = originalShell;
      }
      if (originalSupervisorHome === undefined)
        delete process.env.NIGHTWORKERS_CODEX_SUPERVISOR_HOME;
      else process.env.NIGHTWORKERS_CODEX_SUPERVISOR_HOME = originalSupervisorHome;
      fs.rmSync(supervisorHome, { recursive: true, force: true });
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

  it('rejects Codex MCP tool calls with server and tool diagnostics', async () => {
    async function* events() {
      yield {
        type: 'item.started',
        item: {
          id: 'mcp-1',
          type: 'mcp_tool_call',
          server: 'context_still',
          tool: 'context_compile',
          arguments: { goal: 'classify' },
          status: 'in_progress',
        },
      };
    }
    const emitted: Array<{ type: string; data?: Record<string, unknown> }> = [];
    const request = buildNormalizedSupervisorLlmRequest({
      systemPrompt: 'system',
      userPrompt: 'user',
      label: 'supervisor',
      round: 1,
      schemaFirst: true,
      settings: { ACTIVE_LLM_PROVIDER: 'codex' },
    });

    await expect(
      readCodexStreamedTurn({
        thread: {
          runStreamed: async () => ({ events: events() as any }),
        } as any,
        prompt: 'prompt',
        signal: new AbortController().signal,
        options: {
          round: 1,
          schemaFirst: true,
          emitEvent: (event) => emitted.push({ type: event.type, data: event.data }),
        },
        normalizedRequest: request,
      })
    ).rejects.toThrow(/Provider activity rejected: codex.mcp_tool_call/);

    expect(emitted.at(-1)?.data).toMatchObject({
      providerId: 'codex',
      providerClass: 'agent_runtime',
      activityType: 'codex.mcp_tool_call',
      toolName: 'context_compile',
    });
    expect(String(emitted.at(-1)?.data?.preview || '')).toContain('context_still');
  });
});
