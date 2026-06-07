import type { Thread, ThreadEvent, ThreadOptions } from '@openai/codex-sdk';
import {
  buildCodexSupervisorSdkOptions,
  buildCodexSupervisorThreadOptions,
} from '../supervisor/llm-provider';
import { createCodexEventMapperState, mapCodexThreadEvent } from './codex-event-mapper';
import type { AgentRunContext, AgentRuntime, AgentRuntimeResult, AgentRuntimeSink } from './types';

export type CodexThreadFactory = (context: AgentRunContext) => Promise<Thread> | Thread;

const DEFAULT_RESULT: AgentRuntimeResult = {
  terminalState: 'failed',
  summary: 'Codex Agent Runtime failed.',
  finalReport: '',
  stoppedBy: 'llm_error',
  riskLevel: 'high',
};

export class CodexAgentRuntime implements AgentRuntime {
  readonly kind = 'codex-agent' as const;
  private cancelledRunIds = new Set<string>();
  private readonly threadFactory?: CodexThreadFactory;

  constructor(input: { threadFactory?: CodexThreadFactory } = {}) {
    this.threadFactory = input.threadFactory;
  }

  async start(
    context: AgentRunContext,
    sink: AgentRuntimeSink,
    signal?: AbortSignal
  ): Promise<AgentRuntimeResult> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const logs: string[] = [];
    let finalText = '';
    let terminalState: AgentRuntimeResult['terminalState'] = 'completed';
    let stoppedBy: AgentRuntimeResult['stoppedBy'] = 'decision';
    const mapperState = createCodexEventMapperState();

    try {
      if (signal?.aborted || this.cancelledRunIds.has(context.runId)) {
        controller.abort();
        return this.toCancelled('');
      }

      const thread = await this.createThread(context);
      const { events } = await thread.runStreamed(
        context.latestUserMessage || context.compiledPrompt,
        {
          signal: controller.signal,
        }
      );

      for await (const event of events as AsyncGenerator<ThreadEvent>) {
        if (this.cancelledRunIds.has(context.runId)) {
          controller.abort();
          return this.toCancelled(logs.join('\n'));
        }
        const mappedEvents = mapCodexThreadEvent(event, mapperState);
        for (const mapped of mappedEvents) {
          logs.push(mapped.message);
          await sink.emit(mapped);
          if (mapped.type === 'model_response_finished') {
            const payload = mapped.payload as { text?: unknown } | undefined;
            if (typeof payload?.text === 'string') finalText = payload.text;
          }
          if (mapped.type === 'runtime_error') {
            terminalState = 'failed';
            stoppedBy = 'llm_error';
          }
        }
      }

      const result: AgentRuntimeResult = {
        terminalState,
        summary:
          finalText ||
          (terminalState === 'completed'
            ? 'Codex Agent Runtime completed.'
            : DEFAULT_RESULT.summary),
        finalReport: finalText,
        stoppedBy,
        riskLevel: terminalState === 'completed' ? 'medium' : 'high',
        logContent: logs.join('\n'),
      };
      await sink.emit({
        type: 'runtime_finished',
        message: `[System] Codex Agent Runtime finished with terminalState=${result.terminalState}.`,
        payload: {
          provider: 'codex',
          terminalState: result.terminalState,
          stoppedBy: result.stoppedBy,
          finalReport: result.finalReport,
          summary: result.summary,
        },
      });
      return result;
    } catch (err) {
      if (controller.signal.aborted || this.cancelledRunIds.has(context.runId)) {
        return this.toCancelled(logs.join('\n'));
      }
      const message = err instanceof Error ? err.message : String(err);
      await sink.emit({
        type: 'runtime_error',
        message: `[System Error] Codex Agent Runtime failed: ${message}`,
        payload: { provider: 'codex', error: message },
      });
      return {
        ...DEFAULT_RESULT,
        summary: `Codex Agent Runtime failed: ${message}`,
        logContent: [...logs, message].join('\n'),
      };
    } finally {
      signal?.removeEventListener('abort', abort);
    }
  }

  async stop(runId: string): Promise<void> {
    this.cancelledRunIds.add(runId);
  }

  private async createThread(context: AgentRunContext): Promise<Thread> {
    if (this.threadFactory) return this.threadFactory(context);
    const { Codex } = await import('@openai/codex-sdk');
    const codexOptions = buildCodexSupervisorSdkOptions(process.env.CODEX_ACCESS_TOKEN || '');
    const codex = new Codex(codexOptions);
    const threadOptions = buildCodexRuntimeThreadOptions(context);
    return codex.startThread(threadOptions);
  }

  private toCancelled(logContent: string): AgentRuntimeResult {
    return {
      terminalState: 'cancelled',
      summary: 'Codex Agent Runtime cancelled.',
      finalReport: 'Codex Agent Runtime cancelled.',
      stoppedBy: 'cancelled',
      riskLevel: 'medium',
      logContent,
    };
  }
}

function buildCodexRuntimeThreadOptions(context: AgentRunContext): ThreadOptions {
  const codexOptions =
    context.runtimeOptions?.codex && typeof context.runtimeOptions.codex === 'object'
      ? (context.runtimeOptions.codex as Record<string, unknown>)
      : {};
  const model = typeof codexOptions.model === 'string' ? codexOptions.model : undefined;
  const base = buildCodexSupervisorThreadOptions(model, context.repoRoot);
  return {
    ...base,
    workingDirectory: context.repoRoot,
  };
}
