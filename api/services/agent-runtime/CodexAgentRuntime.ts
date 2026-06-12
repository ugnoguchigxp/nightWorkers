import { randomUUID } from 'node:crypto';
import type { Thread, ThreadEvent } from '@openai/codex-sdk';
import type { NormalizedLlmUsage } from '../llm-usage';
import { recordLlmUsage } from '../llm-usage';
import { gitDiffTool } from '../worker-tools/git';
import { createCodexEventMapperState, mapCodexThreadEvent } from './codex-event-mapper';
import {
  buildCodexRuntimeSdkOptions,
  buildCodexRuntimeThreadOptions,
} from './codex-runtime-config';
import type {
  AgentRunContext,
  AgentRuntime,
  AgentRuntimeEvent,
  AgentRuntimeResult,
  AgentRuntimeSink,
} from './types';

export type CodexThreadFactory = (context: AgentRunContext) => Promise<Thread> | Thread;
type RuntimeUsageRecorder = typeof recordLlmUsage;

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
  private readonly persistRuntimeUsage: boolean;
  private readonly usageRecorder: RuntimeUsageRecorder;

  constructor(
    input: {
      threadFactory?: CodexThreadFactory;
      collectWorkspaceDiff?: boolean;
      persistRuntimeUsage?: boolean;
      usageRecorder?: RuntimeUsageRecorder;
    } = {}
  ) {
    this.threadFactory = input.threadFactory;
    this.collectWorkspaceDiff = input.collectWorkspaceDiff ?? !input.threadFactory;
    this.persistRuntimeUsage = input.persistRuntimeUsage ?? !input.threadFactory;
    this.usageRecorder = input.usageRecorder ?? recordLlmUsage;
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
          const importOutcome = getProjectImportOutcome(mapped);
          if (importOutcome === 'cancelled') {
            return this.finishRun(context, sink, logs, {
              terminalState: 'cancelled',
              finalReport: 'Project import was cancelled by the user.',
              stoppedBy: 'cancelled',
              riskLevel: 'medium',
              collectDiff: false,
            });
          }
          if (importOutcome === 'failed') {
            const payload = readEventPayload(mapped);
            const error =
              typeof payload.error === 'string'
                ? payload.error
                : 'nightworkers.import_project failed';
            finalText = `Project import failed: ${error}. Stopping without fallback implementation.`;
            return this.finishRun(context, sink, logs, {
              terminalState: 'needs_human',
              finalReport: finalText,
              stoppedBy: 'tool_failure',
              riskLevel: 'high',
              collectDiff: false,
            });
          }
          if (mapped.type === 'model_response_finished') {
            const payload = mapped.payload as { text?: unknown } | undefined;
            if (typeof payload?.text === 'string') finalText = payload.text;
            await this.recordRuntimeUsageIfPresent(context, mapped.payload);
          }
          if (mapped.type === 'runtime_error') {
            terminalState = 'failed';
            stoppedBy = 'llm_error';
          }
        }
      }

      return this.finishRun(context, sink, logs, {
        terminalState,
        finalReport: finalText,
        stoppedBy,
        riskLevel: terminalState === 'completed' ? 'medium' : 'high',
      });
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

  private async recordRuntimeUsageIfPresent(
    context: AgentRunContext,
    payload: unknown
  ): Promise<void> {
    if (!this.persistRuntimeUsage) return;
    const record =
      payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
    if (record.provider !== 'codex' || !record.usage) return;
    const usage = normalizeRuntimeUsage(record.usage, record.rawUsage);
    if (!usage) return;
    await this.usageRecorder({
      taskId: context.taskId,
      runId: context.runId,
      callId: `codex-runtime:${context.runId}:${randomUUID()}`,
      provider: 'codex',
      model: resolveRuntimeModel(context),
      label: 'codex-runtime',
      round: null,
      usage,
      promptPartTokenEstimates: {
        latestUserMessageTokens:
          context.contextSnapshot.conversationContext?.usage?.latestUserMessageTokens,
        stateCardTokens: context.contextSnapshot.conversationContext?.usage?.stateCardTokens,
        userPromptTokens:
          context.contextSnapshot.conversationContext?.usage?.runtimeUserPromptTokens,
      },
      durationMs: 0,
      metadataJson: {
        source: 'codex_agent_runtime_turn_completed',
        providerEventType: record.providerEventType ?? null,
      },
    });
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

  private async finishRun(
    context: AgentRunContext,
    sink: AgentRuntimeSink,
    logs: string[],
    input: {
      terminalState: AgentRuntimeResult['terminalState'];
      finalReport: string;
      stoppedBy: AgentRuntimeResult['stoppedBy'];
      riskLevel: AgentRuntimeResult['riskLevel'];
      collectDiff?: boolean;
    }
  ): Promise<AgentRuntimeResult> {
    const diffPatch =
      input.collectDiff === false ? '' : await this.collectDiff(context, sink, logs);
    const result: AgentRuntimeResult = {
      terminalState: input.terminalState,
      summary:
        input.finalReport ||
        (input.terminalState === 'completed'
          ? 'Codex Agent Runtime completed.'
          : DEFAULT_RESULT.summary),
      finalReport: input.finalReport,
      stoppedBy: input.stoppedBy,
      riskLevel: input.riskLevel,
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

function readEventPayload(event: AgentRuntimeEvent): Record<string, unknown> {
  return event.payload && typeof event.payload === 'object'
    ? (event.payload as Record<string, unknown>)
    : {};
}

function getProjectImportOutcome(event: AgentRuntimeEvent): 'failed' | 'cancelled' | null {
  if (event.type !== 'tool_call_finished') return null;
  const payload = readEventPayload(event);
  if (
    payload.toolName !== 'nightworkers.import_project' &&
    payload.toolName !== 'nightworkers.materialize_template'
  ) {
    return null;
  }
  if (payload.status === 'cancelled') return 'cancelled';
  if (payload.status === 'failed' || typeof payload.error === 'string') return 'failed';
  return null;
}

function normalizeRuntimeUsage(usageValue: unknown, rawUsage: unknown): NormalizedLlmUsage | null {
  if (!usageValue || typeof usageValue !== 'object') return null;
  const usage = usageValue as Record<string, unknown>;
  const inputTokens = normalizeOptionalToken(usage.inputTokens);
  const outputTokens = normalizeOptionalToken(usage.outputTokens);
  const cachedInputTokens = normalizeOptionalToken(usage.cachedInputTokens);
  const reasoningOutputTokens = normalizeOptionalToken(usage.reasoningOutputTokens);
  if (inputTokens === null && outputTokens === null) return null;
  return {
    inputTokens,
    outputTokens,
    cachedInputTokens,
    reasoningOutputTokens,
    totalTokens:
      inputTokens !== null || outputTokens !== null
        ? (inputTokens ?? 0) + (outputTokens ?? 0)
        : null,
    mode: 'measured',
    rawUsage,
  };
}

function normalizeOptionalToken(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : null;
}

function resolveRuntimeModel(context: AgentRunContext): string | null {
  const codexOptions =
    context.runtimeOptions?.codex && typeof context.runtimeOptions.codex === 'object'
      ? (context.runtimeOptions.codex as Record<string, unknown>)
      : null;
  return typeof codexOptions?.model === 'string' ? codexOptions.model : null;
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
    '- Run context-still.initial_instructions before other task work and follow its current procedure guidance.',
    '- Treat the nightworkers MCP tools as the required execution interface. When a named NightWorkers tool fits the job, call it directly instead of describing equivalent shell steps.',
    '- Use nightworkers.todo_list as the single Todo control tool.',
    '- For multi-step implementation work, call nightworkers.todo_list with operation=replace once near the start to register the implementation Todos for this run.',
    '- operation=replace only defines or resets the Todo plan. It does not mean the first implementation Todo is already finished.',
    '- Use operation=start only when you must change which Todo is currently running.',
    '- Use operation=done only after the current Todo has concrete execution evidence such as a successful MCP tool call, file change, or verification result. done automatically starts the next pending Todo.',
    '- Use operation=block for approval or input waits, and operation=fail for concrete implementation or verification failures.',
    '- A Todo tracking failure is tracking failure, not task completion. Do not jump to closeout or final completion just because Todo tracking failed.',
    '- If a Todo-tracking MCP call fails but the actual implementation tool to run next is still clear, continue with the implementation work instead of stopping just to report the Todo-tracking failure.',
    '- Do not call context-still.compile_eval during planning, Todo registration, or immediately after a Todo tracking failure. compile_eval is a closeout action only after implementation and verification are genuinely finished.',
    '- For planning, implementation-plan, specification, design-doc, or requirement-check work, use nightworkers.read_current_specification first.',
    '- If the current task specification is not found, use nightworkers.list_recent_specifications to locate the relevant task, then read it by taskId.',
    '- Ground plans and verification steps in the MCP specification content when it is available.',
    '- Use nightworkers.import_project as the single Project import entrypoint. Pass templateId for registered templates, or repoUrl for arbitrary Git imports.',
    '- For unspecified new Web/API apps in an empty or near-empty Project root, call nightworkers.import_project with templateId=hono-standard before custom implementation. Use the default SQLite variant unless the user explicitly asks for another stack, a blank project, or a DB/RAG/SSR/SSG variant.',
    '- If the user specifies a DB, choose the matching hono-standard variant such as postgres, pgvector, turso, or cloudflare. If the user asks for RAG, knowledge-base search, embeddings-backed document search, or agentic search, choose the hono-standard rag variant. If the user specifies SSR or SSG without a DB/RAG variant, pass the matching overlay. Do not combine a DB/RAG variant and an overlay in one import_project call.',
    '- Do not use shell git clone when nightworkers.import_project covers the task.',
    '- If nightworkers.import_project fails, is cancelled, or is not approved, stop and report the tool failure. Do not create a fallback static app or alternative implementation.',
    '- After nightworkers.import_project succeeds, inspect package.json, adapt the scaffold to the specification, and run manifest-based verification before reporting completion.',
    '- For CLI evidence, prefer NightWorkers worker-tool results. run_command and run_verification keep full stdout/stderr by default, so do not summarize away exact git/build/test output unless it is truly excessive.',
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
