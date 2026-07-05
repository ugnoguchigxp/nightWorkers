import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getNightWorkersCodexToolNames } from '../../api/mcp/nightworkers-tool-manifest';
import {
  buildCodexRuntimePrompt,
  CodexAgentRuntime,
} from '../../api/services/agent-runtime/CodexAgentRuntime';
import { CODEX_CONTRACT_WARNING_CATALOG } from '../../api/services/agent-runtime/codex-contract-warning-catalog';
import {
  createCodexEventMapperState,
  mapCodexThreadEvent,
  redactProviderEvent,
} from '../../api/services/agent-runtime/codex-event-mapper';
import { resolveCodexRuntimeMcpConfigState } from '../../api/services/agent-runtime/codex-runtime-config';
import { buildContext, fakeThread, git } from './helpers';
import './setup';

describe('CodexAgentRuntime event mapping and catalog contracts', () => {
  it('maps command and MCP activity without rejecting provider activity', () => {
    const state = createCodexEventMapperState();
    const commandEvents = mapCodexThreadEvent(
      {
        type: 'item.completed',
        item: {
          id: 'cmd-1',
          type: 'command_execution',
          command: 'pnpm test',
          aggregated_output: 'ok',
          exit_code: 0,
          status: 'completed',
        },
      },
      state
    );
    const mcpEvents = mapCodexThreadEvent(
      {
        type: 'item.completed',
        item: {
          id: 'mcp-1',
          type: 'mcp_tool_call',
          server: 'nightworkers',
          tool: 'get_task_context',
          arguments: { taskId: 'task-1', Authorization: 'Bearer secret' },
          status: 'completed',
        },
      },
      state
    );

    expect(commandEvents[0]).toMatchObject({
      type: 'tool_call_finished',
      payload: {
        command: 'pnpm test',
        commandClass: 'verification',
        aggregatedOutput: 'ok',
        exitCode: 0,
      },
    });
    expect(mcpEvents[0]).toMatchObject({
      type: 'tool_call_finished',
      payload: {
        toolName: 'nightworkers.get_task_context',
        mcpServer: 'nightworkers',
        mcpTool: 'get_task_context',
        arguments: { taskId: 'task-1', Authorization: '[REDACTED]' },
      },
    });
  });

  it('keeps manifest, prompt, and MCP expected tool names in sync', () => {
    const tools = getNightWorkersCodexToolNames();
    const prompt = buildCodexRuntimePrompt(buildContext());
    const mcpConfig = resolveCodexRuntimeMcpConfigState();

    expect(prompt).toContain(`Available NightWorkers MCP tools in this lane: ${tools.join(', ')}.`);
    expect(mcpConfig.expectedTools).toEqual(tools);
  });

  it('keeps emitted Codex contract warning codes documented in the read-only catalog', async () => {
    const source = await readFile('api/services/agent-runtime/CodexAgentRuntime.ts', 'utf8');
    const emittedCodes = [...source.matchAll(/code: '(codex_[^']+)'/g)].map((match) => match[1]);

    expect(new Set(emittedCodes)).toEqual(new Set(Object.keys(CODEX_CONTRACT_WARNING_CATALOG)));
    expect(
      Object.values(CODEX_CONTRACT_WARNING_CATALOG).every(
        (entry) => entry.description.length > 0 && entry.terminalPolicy.length > 0
      )
    ).toBe(true);
  });

  it('warns for NightWorkers MCP tools outside the manifest helper list', async () => {
    const runtime = new CodexAgentRuntime({
      threadFactory: () =>
        fakeThread([
          {
            type: 'item.completed',
            item: {
              id: 'unexpected-tool',
              type: 'mcp_tool_call',
              server: 'nightworkers',
              tool: 'run_command',
              arguments: { command: 'pwd' },
              status: 'completed',
              result: { ok: true },
            },
          },
          { type: 'item.completed', item: { id: 'msg-1', type: 'agent_message', text: 'done' } },
        ] as never),
    });

    const result = await runtime.start(buildContext(), { emit: async () => {} });

    expect(getNightWorkersCodexToolNames()).not.toContain('nightworkers.run_command');
    expect(result.contractWarnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'codex_unexpected_nightworkers_mcp_tool',
          toolName: 'nightworkers.run_command',
        }),
      ])
    );
  });

  it('classifies Codex native command_execution events for audit evidence', () => {
    const state = createCodexEventMapperState();
    const cases = [
      ['pnpm verify', 'broad_verification'],
      ['bun run verify:base', 'broad_verification'],
      ['npm run typecheck', 'verification'],
      ['git clone https://example.test/repo.git', 'git_clone_or_import'],
      ['pnpm install', 'install'],
      ['git status --short', 'inspection'],
      ['/bin/zsh -lc \'sed -n "1,80p" src/app.ts\'', 'inspection'],
      ['node custom-script.js', 'other'],
    ] as const;

    for (const [command, commandClass] of cases) {
      const [event] = mapCodexThreadEvent(
        {
          type: 'item.completed',
          item: {
            id: `cmd-${commandClass}`,
            type: 'command_execution',
            command,
            status: 'completed',
          },
        } as never,
        state
      );
      expect(event).toMatchObject({
        payload: { command, commandClass },
      });
    }
  });

  it('compacts large Codex command_execution payloads at the activity boundary', () => {
    const state = createCodexEventMapperState();
    const longOutput = [
      'running tests',
      ...Array.from({ length: 1400 }, (_, index) => `verbose output ${index}`),
      'AssertionError: expected 1 to equal 2',
      'failed tests: services.codex-agent-runtime.test.ts',
      ...Array.from({ length: 1400 }, (_, index) => `tail output ${index}`),
    ].join('\n');
    const [event] = mapCodexThreadEvent(
      {
        type: 'item.completed',
        item: {
          id: 'cmd-large-output',
          type: 'command_execution',
          command: 'bunx vitest run tests/services.codex-agent-runtime.test.ts',
          aggregated_output: longOutput,
          exit_code: 1,
          status: 'completed',
        },
      } as never,
      state
    );

    expect(event.payload).toMatchObject({
      toolName: 'command_execution',
      aggregatedOutputTruncated: true,
      aggregatedOutputOriginalChars: longOutput.length,
      compressionStrategy: 'command_output',
      fullProviderEventAvailable: true,
    });
    const payload = event.payload as Record<string, unknown>;
    expect(String(payload.aggregatedOutput)).toContain('[model-visible-payload-compressed]');
    expect(String(payload.aggregatedOutput)).toContain('AssertionError: expected 1 to equal 2');
    expect(String(payload.aggregatedOutput)).not.toContain(longOutput);
    expect(Number(payload.aggregatedOutputReturnedChars)).toBeLessThan(longOutput.length);
  });

  it('compacts large Codex MCP result and provider event projections', () => {
    const state = createCodexEventMapperState();
    const largeText = [
      'start',
      ...Array.from({ length: 3000 }, (_, index) => `large structured result ${index}`),
      'AssertionError: MCP result should be compacted',
      ...Array.from({ length: 3000 }, (_, index) => `tail structured result ${index}`),
    ].join('\n');
    const [event] = mapCodexThreadEvent(
      {
        type: 'item.completed',
        item: {
          id: 'mcp-large-result',
          type: 'mcp_tool_call',
          server: 'nightworkers',
          tool: 'read_current_specification',
          arguments: { view: 'full' },
          result: {
            structuredContent: {
              payload: {
                content: largeText,
              },
            },
            content: [{ type: 'text', text: largeText }],
          },
          status: 'completed',
        },
      } as never,
      state
    );

    expect(event.payload).toMatchObject({
      toolName: 'nightworkers.read_current_specification',
      resultCompacted: true,
      providerEventCompacted: true,
    });
    const payload = event.payload as Record<string, unknown>;
    expect(JSON.stringify(payload.result)).toContain('[model-visible-payload-compressed]');
    expect(JSON.stringify(payload.result)).toContain('MCP result should be compacted');
    expect(JSON.stringify(payload.result)).not.toContain(largeText);
    expect(JSON.stringify(payload.providerEvent)).not.toContain(largeText);
  });

  it('maps in-progress command and MCP updates as tool progress', () => {
    const state = createCodexEventMapperState();

    expect(
      mapCodexThreadEvent(
        {
          type: 'item.updated',
          item: {
            id: 'cmd-progress',
            type: 'command_execution',
            command: 'pnpm test',
            aggregated_output: 'running',
            status: 'in_progress',
          },
        },
        state
      )[0]
    ).toMatchObject({
      type: 'tool_call_progress',
      payload: { toolName: 'command_execution', status: 'in_progress' },
    });
    expect(
      mapCodexThreadEvent(
        {
          type: 'item.updated',
          item: {
            id: 'mcp-progress',
            type: 'mcp_tool_call',
            server: 'nightworkers',
            tool: 'get_task_context',
            arguments: { taskId: 'task-1' },
            status: 'in_progress',
          },
        },
        state
      )[0]
    ).toMatchObject({
      type: 'tool_call_progress',
      payload: { toolName: 'nightworkers.get_task_context', status: 'in_progress' },
    });
  });

  it('maps file changes with normalized changed file paths', () => {
    const events = mapCodexThreadEvent({
      type: 'item.completed',
      item: {
        id: 'file-change-1',
        type: 'file_change',
        status: 'completed',
        changes: [{ path: 'src/fizzbuzz.ts' }, 'README.md'],
      },
    } as never);

    expect(events[0]).toMatchObject({
      type: 'diff_collected',
      payload: {
        changedFiles: ['src/fizzbuzz.ts', 'README.md'],
        status: 'completed',
      },
    });
  });

  it('collects post-run workspace file creation as a diff event', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'nightworkers-codex-diff-'));
    try {
      await git(repoRoot, ['init']);
      await git(repoRoot, ['config', 'user.email', 'test@example.com']);
      await git(repoRoot, ['config', 'user.name', 'Test User']);
      await writeFile(path.join(repoRoot, 'README.md'), 'baseline\n');
      await git(repoRoot, ['add', 'README.md']);
      await git(repoRoot, ['commit', '-m', 'baseline']);
      await writeFile(path.join(repoRoot, 'fizzbuzz.ts'), 'export const fizzbuzz = true;\n');
      const runtime = new CodexAgentRuntime({
        collectWorkspaceDiff: true,
        threadFactory: () =>
          fakeThread([
            { type: 'turn.started' },
            {
              type: 'item.completed',
              item: { id: 'item-1', type: 'agent_message', text: 'done' },
            },
          ]),
      });
      const events: unknown[] = [];

      const result = await runtime.start(buildContext({ repoRoot }), {
        emit: async (event) => {
          events.push(event);
        },
      });

      expect(result.diffPatch).toContain('diff --git a/fizzbuzz.ts b/fizzbuzz.ts');
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'diff_collected',
            payload: expect.objectContaining({
              source: 'post_run_git_diff',
              changedFiles: ['fizzbuzz.ts'],
            }),
          }),
        ])
      );
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('redacts secret-like provider event fields', () => {
    expect(
      redactProviderEvent({
        headers: { Authorization: 'Bearer secret' },
        nested: { apiKey: 'secret' },
      })
    ).toEqual({
      headers: { Authorization: '[REDACTED]' },
      nested: { apiKey: '[REDACTED]' },
    });
  });
});
