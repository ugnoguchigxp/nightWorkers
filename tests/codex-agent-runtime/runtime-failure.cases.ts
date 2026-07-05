import { describe, expect, it, vi } from 'vitest';
import { CodexAgentRuntime } from '../../api/services/agent-runtime/CodexAgentRuntime';
import { buildContext, fakeThread, fakeThreadThatThrows } from './helpers';
import './setup';

describe('CodexAgentRuntime usage and failure handling', () => {
  it('records Codex turn usage through the shared LLM usage recorder', async () => {
    const usageRecorder = vi.fn(async (input) => ({ id: 'usage-record', ...input }) as never);
    const runtime = new CodexAgentRuntime({
      persistRuntimeUsage: true,
      usageRecorder,
      threadFactory: () =>
        fakeThread([
          {
            type: 'turn.completed',
            usage: {
              input_tokens: 1200,
              cached_input_tokens: 300,
              output_tokens: 45,
              reasoning_output_tokens: 6,
            },
          },
        ]),
    });

    await runtime.start(
      buildContext({
        codex: { model: 'gpt-5.3-codex' },
        conversationContextUsage: {
          latestUserMessageTokens: 10,
          stateCardTokens: 20,
          runtimeUserPromptTokens: 30,
        },
      }),
      { emit: async () => {} }
    );

    expect(usageRecorder).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-codex',
        runId: 'run-codex',
        provider: 'codex',
        model: 'gpt-5.3-codex',
        label: 'codex-runtime',
        usage: expect.objectContaining({
          inputTokens: 1200,
          outputTokens: 45,
          cachedInputTokens: 300,
          reasoningOutputTokens: 6,
          totalTokens: 1245,
          mode: 'measured',
          rawUsage: {
            input_tokens: 1200,
            cached_input_tokens: 300,
            output_tokens: 45,
            reasoning_output_tokens: 6,
          },
        }),
        promptPartTokenEstimates: {
          latestUserMessageTokens: 10,
          stateCardTokens: 20,
          userPromptTokens: expect.any(Number),
          systemPromptTokens: expect.any(Number),
        },
        promptPartObservabilityEnabled: true,
        metadataJson: expect.objectContaining({
          providerUsageSource: 'codex_sdk_measured',
          promptPartSource: 'nightworkers_estimate',
          runtimePromptShape: 'request_plus_runtime_contract',
          systemPromptMeaning: 'runtime_contract_tokens',
          nonCachedInputTokens: 900,
          promptPartObservabilityEnabled: true,
        }),
      })
    );
    const recorded = usageRecorder.mock.calls[0]?.[0];
    expect(recorded.promptPartTokenEstimates.userPromptTokens).toBeGreaterThan(0);
    expect(recorded.promptPartTokenEstimates.systemPromptTokens).toBeGreaterThan(0);
  });

  it('does not send Codex prompt estimates when prompt observability is disabled', async () => {
    const usageRecorder = vi.fn(async (input) => ({ id: 'usage-record', ...input }) as never);
    const runtime = new CodexAgentRuntime({
      persistRuntimeUsage: true,
      usageRecorder,
      threadFactory: () =>
        fakeThread([
          {
            type: 'turn.completed',
            usage: {
              input_tokens: 1200,
              output_tokens: 45,
            },
          },
        ]),
    });

    await runtime.start(
      buildContext({
        runtimeOptions: {
          executionMode: 'implementation',
          llmUsage: { promptPartObservabilityEnabled: false },
        },
      }),
      { emit: async () => {} }
    );

    expect(usageRecorder).toHaveBeenCalledWith(
      expect.objectContaining({
        usage: expect.objectContaining({
          inputTokens: 1200,
          outputTokens: 45,
          mode: 'measured',
        }),
        promptPartTokenEstimates: undefined,
        promptPartObservabilityEnabled: false,
        metadataJson: expect.objectContaining({
          promptPartSource: null,
          promptPartObservabilityEnabled: false,
        }),
      })
    );
  });

  it('returns cancelled when the run is stopped before the stream starts', async () => {
    const runtime = new CodexAgentRuntime({
      threadFactory: () => fakeThread([{ type: 'turn.started' }]),
    });
    await runtime.stop('run-codex');

    const result = await runtime.start(buildContext(), { emit: async () => {} });

    expect(result.terminalState).toBe('cancelled');
    expect(result.stoppedBy).toBe('cancelled');
  });

  it('maps runtime failure to failed result and runtime_error event', async () => {
    const runtime = new CodexAgentRuntime({
      threadFactory: () => fakeThread([{ type: 'turn.failed', error: { message: 'boom' } }]),
    });
    const events: unknown[] = [];

    const result = await runtime.start(buildContext(), {
      emit: async (event) => {
        events.push(event);
      },
    });

    expect(result.terminalState).toBe('failed');
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'runtime_error',
          payload: expect.objectContaining({ error: 'boom' }),
        }),
      ])
    );
  });

  it('retries provider capacity failures before marking the run failed', async () => {
    const threadFactory = vi
      .fn()
      .mockReturnValueOnce(
        fakeThreadThatThrows(
          [
            {
              type: 'turn.failed',
              error: { message: 'Selected model is at capacity. Please try a different model.' },
            },
          ] as never,
          new Error('Codex Exec exited with code 1: apply_patch verification failed: stale stderr')
        )
      )
      .mockReturnValueOnce(
        fakeThread([
          { type: 'item.completed', item: { id: 'msg-1', type: 'agent_message', text: 'done' } },
        ] as never)
      );
    const runtime = new CodexAgentRuntime({ threadFactory });
    const events: unknown[] = [];

    const result = await runtime.start(buildContext(), {
      emit: async (event) => {
        events.push(event);
      },
    });

    expect(threadFactory).toHaveBeenCalledTimes(2);
    expect(result.terminalState).toBe('completed');
    expect(result.finalReport).toBe('done');
    expect(result.summary).toBe('done');
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'model_retry_scheduled',
          payload: expect.objectContaining({
            reason: 'provider_capacity',
            retryNumber: 1,
            maxRetries: 1,
          }),
        }),
        expect.objectContaining({
          type: 'model_retry_started',
          payload: expect.objectContaining({
            reason: 'provider_capacity',
            retryNumber: 1,
            maxRetries: 1,
          }),
        }),
      ])
    );
  });

  it('prefers structured terminal runtime errors over stale Codex exec stderr', async () => {
    const runtime = new CodexAgentRuntime({
      threadFactory: () =>
        fakeThreadThatThrows(
          [
            {
              type: 'item.completed',
              item: {
                id: 'file-change-styles',
                type: 'file_change',
                status: 'completed',
                changes: [{ path: 'web/src/styles.css' }],
              },
            },
            {
              type: 'turn.failed',
              error: { message: 'Selected model is at capacity. Please try a different model.' },
            },
          ] as never,
          new Error(
            'Codex Exec exited with code 1: apply_patch verification failed: Failed to find expected lines in /Users/y.noguchi/Code/todolist/web/src/styles.css:\n.auth-chip {'
          )
        ),
    });

    const result = await runtime.start(buildContext(), { emit: async () => {} });

    expect(result.terminalState).toBe('failed');
    expect(result.summary).toContain('provider_capacity');
    expect(result.summary).toContain('Selected model is at capacity');
    expect(result.summary).not.toContain('apply_patch verification failed');
    expect(result.logContent).toContain(
      'Recovered tool failure: apply_patch verification failed in /Users/y.noguchi/Code/todolist/web/src/styles.css.'
    );
    expect(result.testResults).toMatchObject({
      codexFailure: {
        terminalReason: 'provider_capacity',
        recoveredToolFailures: [
          expect.objectContaining({
            recovered: true,
            filePath: '/Users/y.noguchi/Code/todolist/web/src/styles.css',
          }),
        ],
      },
    });
  });

  it('keeps recovered apply_patch failures as diagnostics for non-zero exec exits', async () => {
    const events: unknown[] = [];
    const runtime = new CodexAgentRuntime({
      threadFactory: () =>
        fakeThreadThatThrows(
          [
            {
              type: 'item.completed',
              item: {
                id: 'file-change-styles',
                type: 'file_change',
                status: 'completed',
                changes: [{ path: 'web/src/styles.css' }],
              },
            },
          ] as never,
          new Error(
            'Codex Exec exited with code 1: apply_patch verification failed: Failed to find expected lines in /Users/y.noguchi/Code/todolist/web/src/styles.css:\n.auth-chip {'
          )
        ),
    });

    const result = await runtime.start(buildContext(), {
      emit: async (event) => {
        events.push(event);
      },
    });

    expect(result.summary).toContain('codex_exec_nonzero');
    expect(result.summary).not.toContain('unrecovered_tool_failure');
    expect(result.logContent).toContain('Recovered tool failure: apply_patch verification failed');
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'runtime_warning',
          payload: expect.objectContaining({
            code: 'recovered_tool_failure',
            toolName: 'apply_patch',
          }),
        }),
      ])
    );
  });

  it('does not treat file changes observed before timestamped apply_patch failures as recovered', async () => {
    const runtime = new CodexAgentRuntime({
      threadFactory: () =>
        fakeThreadThatThrows(
          [
            {
              type: 'item.completed',
              item: {
                id: 'file-change-styles-before-failure',
                type: 'file_change',
                status: 'completed',
                changes: [{ path: 'web/src/styles.css' }],
              },
            },
          ] as never,
          new Error(
            'Codex Exec exited with code 1: 2999-01-01T00:00:00.000000Z ERROR apply_patch verification failed: Failed to find expected lines in /Users/y.noguchi/Code/todolist/web/src/styles.css:\n.auth-chip {'
          )
        ),
    });

    const result = await runtime.start(buildContext(), { emit: async () => {} });

    expect(result.summary).toContain('unrecovered_tool_failure');
    expect(result.logContent).not.toContain('Recovered tool failure');
    expect(result.testResults).toMatchObject({
      codexFailure: {
        terminalReason: 'unrecovered_tool_failure',
        unrecoveredToolFailures: [
          expect.objectContaining({
            recovered: false,
            filePath: '/Users/y.noguchi/Code/todolist/web/src/styles.css',
          }),
        ],
      },
    });
  });

  it('classifies non-zero Codex exec exits without structured errors', async () => {
    const runtime = new CodexAgentRuntime({
      threadFactory: () =>
        fakeThreadThatThrows([], new Error('Codex Exec exited with code 1: stderr details')),
    });

    const result = await runtime.start(buildContext(), { emit: async () => {} });

    expect(result.summary).toContain('codex_exec_nonzero');
    expect(result.summary).not.toContain('stderr details');
    expect(result.logContent).toContain('stderr details');
    expect(result.testResults).toMatchObject({
      codexFailure: { terminalReason: 'codex_exec_nonzero', execExitDetail: 'code 1' },
    });
  });

  it('preserves non-exec runtime exception messages in failed summaries', async () => {
    const runtime = new CodexAgentRuntime({
      threadFactory: () => fakeThreadThatThrows([], new Error('network transport failed')),
    });

    const result = await runtime.start(buildContext(), { emit: async () => {} });

    expect(result.summary).toContain('unknown_runtime_error');
    expect(result.summary).toContain('network transport failed');
  });

  it('classifies unmatched apply_patch failures as unrecovered tool failures', async () => {
    const runtime = new CodexAgentRuntime({
      threadFactory: () =>
        fakeThreadThatThrows(
          [],
          new Error(
            'Codex Exec exited with code 1: apply_patch verification failed: Failed to find expected lines in /Users/y.noguchi/Code/todolist/web/src/styles.css:\n.auth-chip {'
          )
        ),
    });

    const result = await runtime.start(buildContext(), { emit: async () => {} });

    expect(result.summary).toContain('unrecovered_tool_failure');
    expect(result.summary).toContain('apply_patch verification failed');
    expect(result.testResults).toMatchObject({
      codexFailure: {
        terminalReason: 'unrecovered_tool_failure',
        unrecoveredToolFailures: [
          expect.objectContaining({
            recovered: false,
            filePath: '/Users/y.noguchi/Code/todolist/web/src/styles.css',
          }),
        ],
      },
    });
  });
});
