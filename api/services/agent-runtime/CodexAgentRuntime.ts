import type { Thread, ThreadEvent } from '@openai/codex-sdk';
import { gitDiffTool } from '../worker-tools/git';
import { createCodexEventMapperState, mapCodexThreadEvent } from './codex-event-mapper';
import {
  buildCodexRuntimeSdkOptions,
  buildCodexRuntimeThreadOptions,
} from './codex-runtime-config';
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
  private readonly collectWorkspaceDiff: boolean;

  constructor(input: { threadFactory?: CodexThreadFactory; collectWorkspaceDiff?: boolean } = {}) {
    this.threadFactory = input.threadFactory;
    this.collectWorkspaceDiff = input.collectWorkspaceDiff ?? !input.threadFactory;
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
      const { events } = await thread.runStreamed(buildCodexRuntimePrompt(context), {
        signal: controller.signal,
      });

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

      const diffPatch = await this.collectDiff(context, sink, logs);
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
        diffPatch,
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
    const codexOptions = buildCodexRuntimeSdkOptions({
      accessToken: process.env.CODEX_ACCESS_TOKEN || '',
      env: {
        ...process.env,
        NIGHTWORKERS_TASK_ID: context.taskId,
        NIGHTWORKERS_RUN_ID: context.runId,
      },
    });
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

  private async collectDiff(
    context: AgentRunContext,
    sink: AgentRuntimeSink,
    logs: string[]
  ): Promise<string> {
    if (!this.collectWorkspaceDiff) return '';
    const result = await gitDiffTool({ repoRoot: context.repoRoot });
    if (!result.ok || !result.payload.hasChanges) return '';
    const changedFiles = changedFilesFromDiff(result.payload.diff);
    const message = `[Codex] Workspace diff collected: ${changedFiles.length || 'unknown'} file(s).`;
    logs.push(message);
    await sink.emit({
      type: 'diff_collected',
      message,
      payload: {
        provider: 'codex',
        source: 'post_run_git_diff',
        changedFiles,
        diff: result.payload.diff,
        diffStat: result.payload.diffStat,
        hasChanges: result.payload.hasChanges,
      },
    });
    return result.payload.diff;
  }
}

export function buildCodexRuntimePrompt(context: AgentRunContext): string {
  const request = (context.latestUserMessage || context.compiledPrompt).trim();
  const contract = [
    '[NightWorkers Runtime Contract]',
    `taskId: ${context.taskId}`,
    `runId: ${context.runId}`,
    `repoRoot: ${context.repoRoot}`,
    '',
    'NightWorkers MCP:',
    '- MCP server name: nightworkers',
    '- For planning, implementation-plan, specification, design-doc, or requirement-check work, use nightworkers.read_current_specification first.',
    '- If the current task specification is not found, use nightworkers.list_recent_specifications to locate the relevant task, then read it by taskId.',
    '- Ground plans and verification steps in the MCP specification content when it is available.',
  ].join('\n');
  return request ? `${request}\n\n${contract}` : contract;
}

function changedFilesFromDiff(diff: string): string[] {
  const files = new Set<string>();
  for (const line of diff.split('\n')) {
    const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (match?.[2]) files.add(match[2]);
  }
  return [...files];
}
