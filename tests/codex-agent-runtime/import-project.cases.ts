import { describe, expect, it, vi } from 'vitest';
import { CodexAgentRuntime } from '../../api/services/agent-runtime/CodexAgentRuntime';
import { buildContext, fakeThread } from './helpers';
import './setup';

describe('CodexAgentRuntime import project contract', () => {
  it('fails once for provider-cancelled project import and records transport diagnostics', async () => {
    const runtime = new CodexAgentRuntime({
      threadFactory: vi.fn().mockReturnValue(
        fakeThread([
          {
            type: 'item.completed',
            item: {
              id: 'mcp-template-1',
              type: 'mcp_tool_call',
              server: 'nightworkers',
              tool: 'import_project',
              arguments: { source: 'starter', stack: 'hono', variant: 'sqlite' },
              status: 'failed',
              error: { message: 'user cancelled MCP tool call' },
            },
          },
          {
            type: 'item.completed',
            item: {
              id: 'file-after-template-failure',
              type: 'file_change',
              status: 'completed',
              changes: [{ path: 'index.html' }],
            },
          },
        ] as never)
      ),
    });
    const events: unknown[] = [];

    const result = await runtime.start(buildContext(), {
      emit: async (event) => {
        events.push(event);
      },
    });

    expect(result.terminalState).toBe('needs_human');
    expect(result.stoppedBy).toBe('tool_failure');
    expect(result.finalReport).toContain(
      'Project import failed before the MCP server returned a tool result: user cancelled MCP tool call'
    );
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'runtime_error',
          payload: expect.objectContaining({
            providerItemId: 'mcp-template-1',
            reason: 'project_import_transport_cancelled',
          }),
        }),
        expect.objectContaining({
          type: 'runtime_finished',
          payload: expect.objectContaining({
            terminalState: 'needs_human',
            stoppedBy: 'tool_failure',
          }),
        }),
      ])
    );
    expect(events).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'diff_collected',
          payload: expect.objectContaining({ changedFiles: ['index.html'] }),
        }),
      ])
    );
  });

  it('treats explicit cancelled project import status as cancelled', async () => {
    const runtime = new CodexAgentRuntime({
      threadFactory: () =>
        fakeThread([
          {
            type: 'item.completed',
            item: {
              id: 'mcp-template',
              type: 'mcp_tool_call',
              server: 'nightworkers',
              tool: 'import_project',
              arguments: { source: 'starter', stack: 'hono', variant: 'sqlite' },
              status: 'cancelled',
            },
          },
        ] as never),
    });
    const events: unknown[] = [];

    const result = await runtime.start(buildContext(), {
      emit: async (event) => {
        events.push(event);
      },
    });

    expect(result.terminalState).toBe('cancelled');
    expect(result.stoppedBy).toBe('cancelled');
    expect(result.finalReport).toContain('Project import was cancelled');
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'runtime_finished',
          payload: expect.objectContaining({
            terminalState: 'cancelled',
            stoppedBy: 'cancelled',
          }),
        }),
      ])
    );
  });

  it('warns when import_project succeeds with recommended verification but no evidence', async () => {
    const runtime = new CodexAgentRuntime({
      threadFactory: () =>
        fakeThread([
          {
            type: 'item.completed',
            item: {
              id: 'import-1',
              type: 'mcp_tool_call',
              server: 'nightworkers',
              tool: 'import_project',
              arguments: { source: 'starter', stack: 'hono' },
              status: 'completed',
              result: {
                ok: true,
                postImport: {
                  manifest: {
                    recommendedVerificationCommands: ['bun run verify:base'],
                  },
                  initialization: { ok: true },
                  llmContext: 'Use Hono starter',
                },
              },
            },
          },
          { type: 'item.completed', item: { id: 'msg-1', type: 'agent_message', text: 'done' } },
        ] as never),
    });

    const result = await runtime.start(buildContext(), { emit: async () => {} });

    expect(result.contractWarnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'codex_import_project_verification_missing',
          providerItemId: 'import-1',
          toolName: 'nightworkers.import_project',
        }),
      ])
    );
  });

  it('does not let pre-import verification evidence satisfy post-import verification', async () => {
    const runtime = new CodexAgentRuntime({
      threadFactory: () =>
        fakeThread([
          {
            type: 'item.completed',
            item: {
              id: 'cmd-pre-import',
              type: 'command_execution',
              command: 'bun run typecheck',
              aggregated_output: 'ok',
              exit_code: 0,
              status: 'completed',
            },
          },
          {
            type: 'item.completed',
            item: {
              id: 'import-1',
              type: 'mcp_tool_call',
              server: 'nightworkers',
              tool: 'import_project',
              arguments: { source: 'starter', stack: 'hono' },
              status: 'completed',
              result: {
                ok: true,
                postImport: {
                  manifest: {
                    recommendedVerificationCommands: ['bun run verify:base'],
                  },
                },
              },
            },
          },
          { type: 'item.completed', item: { id: 'msg-1', type: 'agent_message', text: 'done' } },
        ] as never),
    });

    const result = await runtime.start(buildContext(), { emit: async () => {} });

    expect(result.contractWarnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'codex_import_project_verification_missing',
          providerItemId: 'import-1',
        }),
      ])
    );
  });

  it('warns when post-import verification command fails', async () => {
    const runtime = new CodexAgentRuntime({
      threadFactory: () =>
        fakeThread([
          {
            type: 'item.completed',
            item: {
              id: 'import-1',
              type: 'mcp_tool_call',
              server: 'nightworkers',
              tool: 'import_project',
              arguments: { source: 'starter', stack: 'hono' },
              status: 'completed',
              result: {
                ok: true,
                postImport: {
                  manifest: {
                    recommendedVerificationCommands: ['bun run verify:base'],
                  },
                },
              },
            },
          },
          {
            type: 'item.completed',
            item: {
              id: 'cmd-verify',
              type: 'command_execution',
              command: 'bun run verify:base',
              aggregated_output: 'failed',
              exit_code: 1,
              status: 'failed',
            },
          },
          { type: 'item.completed', item: { id: 'msg-1', type: 'agent_message', text: 'done' } },
        ] as never),
    });

    const result = await runtime.start(buildContext(), { emit: async () => {} });

    expect(result.contractWarnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'codex_import_project_verification_missing',
          providerItemId: 'import-1',
        }),
      ])
    );
  });

  it('does not require post-import verification when no commands are recommended', async () => {
    const runtime = new CodexAgentRuntime({
      threadFactory: () =>
        fakeThread([
          {
            type: 'item.completed',
            item: {
              id: 'import-1',
              type: 'mcp_tool_call',
              server: 'nightworkers',
              tool: 'import_project',
              arguments: { source: 'starter', stack: 'hono' },
              status: 'completed',
              result: {
                ok: true,
                postImport: {
                  manifest: {
                    recommendedVerificationCommands: [],
                  },
                },
              },
            },
          },
          { type: 'item.completed', item: { id: 'msg-1', type: 'agent_message', text: 'done' } },
        ] as never),
    });

    const result = await runtime.start(buildContext(), { emit: async () => {} });

    expect(result.contractWarnings ?? []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'codex_import_project_verification_missing' }),
      ])
    );
  });

  it('reads import_project verification recommendations from MCP structuredContent payload', async () => {
    const runtime = new CodexAgentRuntime({
      threadFactory: () =>
        fakeThread([
          {
            type: 'item.completed',
            item: {
              id: 'import-structured',
              type: 'mcp_tool_call',
              server: 'nightworkers',
              tool: 'import_project',
              arguments: { source: 'starter', stack: 'hono' },
              status: 'completed',
              result: {
                structuredContent: {
                  payload: {
                    mode: 'template',
                    template: { templateId: 'hono-standard' },
                    git: null,
                    postImport: {
                      manifest: {
                        recommendedVerificationCommands: ['bun run verify:base'],
                      },
                    },
                  },
                },
                content: [{ type: 'text', text: '{"ignored":true}' }],
              },
            },
          },
          { type: 'item.completed', item: { id: 'msg-1', type: 'agent_message', text: 'done' } },
        ] as never),
    });

    const result = await runtime.start(buildContext(), { emit: async () => {} });

    expect(result.contractWarnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'codex_import_project_verification_missing',
          providerItemId: 'import-structured',
        }),
      ])
    );
  });

  it('hard-gates import_project MCP error results even when item status is completed', async () => {
    const runtime = new CodexAgentRuntime({
      threadFactory: () =>
        fakeThread([
          {
            type: 'item.completed',
            item: {
              id: 'import-error-content',
              type: 'mcp_tool_call',
              server: 'nightworkers',
              tool: 'import_project',
              arguments: { source: 'starter', stack: 'hono' },
              status: 'completed',
              result: {
                isError: true,
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      error: {
                        code: 'TASK_REPOSITORY_NOT_FOUND',
                        message: 'Cannot resolve repository.',
                      },
                      payload: { mode: '', template: null, git: null, postImport: null },
                    }),
                  },
                ],
              },
            },
          },
          {
            type: 'item.completed',
            item: {
              id: 'file-after-import-error',
              type: 'file_change',
              status: 'completed',
              changes: [{ path: 'index.html' }],
            },
          },
        ] as never),
    });
    const events: unknown[] = [];

    const result = await runtime.start(buildContext(), {
      emit: async (event) => {
        events.push(event);
      },
    });

    expect(result.terminalState).toBe('needs_human');
    expect(result.finalReport).toContain('Cannot resolve repository.');
    expect(events).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'diff_collected',
          payload: expect.objectContaining({ changedFiles: ['index.html'] }),
        }),
      ])
    );
  });

  it('accepts successful verification command evidence after import_project', async () => {
    const runtime = new CodexAgentRuntime({
      threadFactory: () =>
        fakeThread([
          {
            type: 'item.completed',
            item: {
              id: 'import-1',
              type: 'mcp_tool_call',
              server: 'nightworkers',
              tool: 'import_project',
              arguments: { source: 'starter', stack: 'hono' },
              status: 'completed',
              result: {
                ok: true,
                postImport: {
                  manifest: {
                    recommendedVerificationCommands: ['bun run verify:base'],
                  },
                },
              },
            },
          },
          {
            type: 'item.completed',
            item: {
              id: 'cmd-verify',
              type: 'command_execution',
              command: "/bin/zsh -lc 'bun run verify:base'",
              aggregated_output: 'ok',
              exit_code: 0,
              status: 'completed',
            },
          },
          { type: 'item.completed', item: { id: 'msg-1', type: 'agent_message', text: 'done' } },
        ] as never),
    });

    const result = await runtime.start(buildContext(), { emit: async () => {} });

    expect(result.contractWarnings ?? []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'codex_import_project_verification_missing' }),
        expect.objectContaining({
          code: 'codex_import_project_recommended_verification_mismatch',
        }),
      ])
    );
  });

  it('accepts same-runner shorthand verification command evidence after import_project', async () => {
    const runtime = new CodexAgentRuntime({
      threadFactory: () =>
        fakeThread([
          {
            type: 'item.completed',
            item: {
              id: 'import-1',
              type: 'mcp_tool_call',
              server: 'nightworkers',
              tool: 'import_project',
              arguments: { source: 'starter', stack: 'hono' },
              status: 'completed',
              result: {
                ok: true,
                postImport: {
                  manifest: {
                    recommendedVerificationCommands: ['bun run verify:base'],
                  },
                },
              },
            },
          },
          {
            type: 'item.completed',
            item: {
              id: 'cmd-verify',
              type: 'command_execution',
              command: 'bun verify:base',
              aggregated_output: 'ok',
              exit_code: 0,
              status: 'completed',
            },
          },
          { type: 'item.completed', item: { id: 'msg-1', type: 'agent_message', text: 'done' } },
        ] as never),
    });

    const result = await runtime.start(buildContext(), { emit: async () => {} });

    expect(result.contractWarnings ?? []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'codex_import_project_verification_missing' }),
        expect.objectContaining({
          code: 'codex_import_project_recommended_verification_mismatch',
        }),
      ])
    );
  });

  it('warns when successful post-import verification does not match recommended commands', async () => {
    const runtime = new CodexAgentRuntime({
      threadFactory: () =>
        fakeThread([
          {
            type: 'item.completed',
            item: {
              id: 'import-1',
              type: 'mcp_tool_call',
              server: 'nightworkers',
              tool: 'import_project',
              arguments: { source: 'starter', stack: 'hono' },
              status: 'completed',
              result: {
                ok: true,
                postImport: {
                  manifest: {
                    recommendedVerificationCommands: ['bun run verify:base'],
                  },
                },
              },
            },
          },
          {
            type: 'item.completed',
            item: {
              id: 'cmd-typecheck',
              type: 'command_execution',
              command: 'bun run typecheck',
              aggregated_output: 'ok',
              exit_code: 0,
              status: 'completed',
            },
          },
          { type: 'item.completed', item: { id: 'msg-1', type: 'agent_message', text: 'done' } },
        ] as never),
    });

    const result = await runtime.start(buildContext(), { emit: async () => {} });

    expect(result.terminalState).toBe('completed');
    expect(result.contractWarnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'codex_import_project_recommended_verification_mismatch',
          severity: 'warning',
          providerItemId: 'import-1',
          command: 'bun run typecheck',
        }),
      ])
    );
    expect(result.contractWarnings ?? []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'codex_import_project_verification_missing' }),
      ])
    );
  });

  it('accepts any one recommended verification command match after import_project', async () => {
    const runtime = new CodexAgentRuntime({
      threadFactory: () =>
        fakeThread([
          {
            type: 'item.completed',
            item: {
              id: 'import-1',
              type: 'mcp_tool_call',
              server: 'nightworkers',
              tool: 'import_project',
              arguments: { source: 'starter', stack: 'hono' },
              status: 'completed',
              result: {
                ok: true,
                postImport: {
                  manifest: {
                    recommendedVerificationCommands: ['bun run verify:base', 'bun run typecheck'],
                  },
                },
              },
            },
          },
          {
            type: 'item.completed',
            item: {
              id: 'cmd-typecheck',
              type: 'command_execution',
              command: 'bun run typecheck',
              aggregated_output: 'ok',
              exit_code: 0,
              status: 'completed',
            },
          },
          { type: 'item.completed', item: { id: 'msg-1', type: 'agent_message', text: 'done' } },
        ] as never),
    });

    const result = await runtime.start(buildContext(), { emit: async () => {} });

    expect(result.contractWarnings ?? []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'codex_import_project_verification_missing' }),
        expect.objectContaining({
          code: 'codex_import_project_recommended_verification_mismatch',
        }),
      ])
    );
  });

  it('requires human review when native import completes without import_project success', async () => {
    const runtime = new CodexAgentRuntime({
      threadFactory: () =>
        fakeThread([
          {
            type: 'item.completed',
            item: {
              id: 'cmd-clone',
              type: 'command_execution',
              command: 'git clone https://example.test/repo.git .',
              aggregated_output: 'ok',
              exit_code: 0,
              status: 'completed',
            },
          },
          { type: 'item.completed', item: { id: 'msg-1', type: 'agent_message', text: 'done' } },
        ] as never),
    });

    const result = await runtime.start(buildContext(), { emit: async () => {} });

    expect(result.terminalState).toBe('needs_human');
    expect(result.stoppedBy).toBe('tool_failure');
    expect(result.riskLevel).toBe('high');
    expect(result.finalReport).toContain('without nightworkers.import_project success');
    expect(result.contractWarnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'codex_high_risk_native_import_command',
          severity: 'error',
          providerItemId: 'cmd-clone',
        }),
        expect.objectContaining({
          code: 'codex_native_import_without_import_project',
          severity: 'error',
          providerItemId: 'cmd-clone',
        }),
      ])
    );
  });

  it('keeps completed terminal state when native import follows import_project success', async () => {
    const runtime = new CodexAgentRuntime({
      threadFactory: () =>
        fakeThread([
          {
            type: 'item.completed',
            item: {
              id: 'import-1',
              type: 'mcp_tool_call',
              server: 'nightworkers',
              tool: 'import_project',
              arguments: { source: 'git', repoUrl: 'https://example.test/repo.git' },
              status: 'completed',
              result: {
                ok: true,
                postImport: {
                  manifest: {
                    recommendedVerificationCommands: [],
                  },
                },
              },
            },
          },
          {
            type: 'item.completed',
            item: {
              id: 'cmd-clone',
              type: 'command_execution',
              command: 'git clone https://example.test/fixture.git fixture',
              aggregated_output: 'ok',
              exit_code: 0,
              status: 'completed',
            },
          },
          { type: 'item.completed', item: { id: 'msg-1', type: 'agent_message', text: 'done' } },
        ] as never),
    });

    const result = await runtime.start(buildContext(), { emit: async () => {} });

    expect(result.terminalState).toBe('completed');
    expect(result.contractWarnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'codex_high_risk_native_import_command',
          severity: 'error',
          providerItemId: 'cmd-clone',
        }),
      ])
    );
    expect(result.contractWarnings ?? []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'codex_native_import_without_import_project' }),
      ])
    );
  });

  it('does not hard-gate normal verification commands as native import', async () => {
    const runtime = new CodexAgentRuntime({
      threadFactory: () =>
        fakeThread([
          {
            type: 'item.completed',
            item: {
              id: 'cmd-test',
              type: 'command_execution',
              command: 'bun run typecheck',
              aggregated_output: 'ok',
              exit_code: 0,
              status: 'completed',
            },
          },
          { type: 'item.completed', item: { id: 'msg-1', type: 'agent_message', text: 'done' } },
        ] as never),
    });

    const result = await runtime.start(buildContext(), { emit: async () => {} });

    expect(result.terminalState).toBe('completed');
    expect(result.contractWarnings ?? []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'codex_native_import_without_import_project' }),
      ])
    );
  });
});
