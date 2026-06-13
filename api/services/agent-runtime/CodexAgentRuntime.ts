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

const RETRYABLE_IMPORT_CANCEL_ERROR = 'user cancelled MCP tool call';

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
          if (importOutcome?.kind === 'cancelled') {
            return this.finishRun(context, sink, logs, {
              terminalState: 'cancelled',
              finalReport: 'Project import was cancelled by the user.',
              stoppedBy: 'cancelled',
              riskLevel: 'medium',
              collectDiff: false,
            });
          }
          if (importOutcome?.kind === 'failed') {
            if (importOutcome.retryableTransportCancel) {
              const diagnosticMessage =
                '[System] nightworkers.import_project was cancelled before the MCP server returned a tool result. Automatic retry is disabled.';
              logs.push(diagnosticMessage);
              await sink.emit({
                type: 'runtime_error',
                message: diagnosticMessage,
                payload: {
                  provider: 'codex',
                  toolName: importOutcome.toolName,
                  error: importOutcome.error,
                  reason: 'project_import_transport_cancelled',
                  providerItemId: importOutcome.providerItemId,
                },
              });
            }
            finalText = buildProjectImportFailureReport(importOutcome);
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

type ProjectImportOutcome =
  | {
      kind: 'cancelled';
      toolName: string;
      providerItemId: string | null;
    }
  | {
      kind: 'failed';
      toolName: string;
      providerItemId: string | null;
      error: string;
      retryableTransportCancel: boolean;
    };

function getProjectImportOutcome(event: AgentRuntimeEvent): ProjectImportOutcome | null {
  if (event.type !== 'tool_call_finished') return null;
  const payload = readEventPayload(event);
  const toolName =
    payload.toolName === 'nightworkers.import_project' ||
    payload.toolName === 'nightworkers.materialize_template'
      ? payload.toolName
      : null;
  if (!toolName) {
    return null;
  }
  const providerItemId = typeof payload.providerItemId === 'string' ? payload.providerItemId : null;
  if (payload.status === 'cancelled') {
    return {
      kind: 'cancelled',
      toolName,
      providerItemId,
    };
  }
  if (payload.status === 'failed' || typeof payload.error === 'string') {
    const error =
      typeof payload.error === 'string' ? payload.error : 'nightworkers.import_project failed';
    return {
      kind: 'failed',
      toolName,
      providerItemId,
      error,
      retryableTransportCancel: isRetryableProjectImportTransportCancel(payload, error),
    };
  }
  return null;
}

function isRetryableProjectImportTransportCancel(
  payload: Record<string, unknown>,
  error: string
): boolean {
  return (
    error === RETRYABLE_IMPORT_CANCEL_ERROR &&
    payload.status === 'failed' &&
    (payload.result === null || typeof payload.result === 'undefined')
  );
}

function buildProjectImportFailureReport(
  outcome: Extract<ProjectImportOutcome, { kind: 'failed' }>
): string {
  if (outcome.retryableTransportCancel) {
    return `Project import failed before the MCP server returned a tool result: ${outcome.error}. Stopping without retry or fallback implementation.`;
  }
  return `Project import failed: ${outcome.error}. Stopping without fallback implementation.`;
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
    '- Run context-still.initial_instructions before other task work and follow it.',
    '- Treat nightworkers MCP tools as the execution interface. When a named NightWorkers tool fits, call it directly instead of describing equivalent shell steps.',
    '- Execution order: specification -> Todo execution -> verification -> closeout.',
    '- Planning is not closeout. During planning or Todo setup, do not call context-still.compile_eval.',
    '- closeout starts only after implementation and verification are genuinely finished and no implementation Todo remains pending or running.',
    '- Use nightworkers.todo_list as the single Todo control tool.',
    '- For multi-step work, call nightworkers.todo_list operation=replace once near the start. This only defines the Todo plan; it does not complete any Todo.',
    '- operation=replace に closeout Todo を含めない。NightWorkers が最後に「知識登録を行う」と「完了報告を行う」を別々のゲートとして追加する。',
    '- 「知識登録を行う」は start/done せず、context-still.register_candidates の成功後に自動完了される。「完了報告を行う」は最後の assistant 完了報告でのみ自動完了される。',
    '- operation=replace に広域 verify Todo を含めない。NightWorkers が最後に quality_gate_verify Todo を追加する。その Todo が current になる前は typecheck、lint、unit test、build、targeted E2E などの focused checks に留める。',
    '- リポジトリ全体の広域 verify は、追加された quality_gate_verify Todo が current のときだけ実行する。広域 verify 成功後にファイル変更がなければ、再度広域 verify を実行しない。',
    '- Use operation=done only after concrete evidence exists for the current Todo. done auto-starts the next pending Todo.',
    '- Use operation=block for approval/input waits and operation=fail for concrete implementation or verification failures.',
    '- Do not start a later Todo while an earlier Todo is still pending or running. If verification cannot run or fails, close that verification Todo with fail or block first.',
    '- A failed, blocked, or skipped Todo is terminal. Do not try to restart it; continue only to closeout when no earlier Todo is pending or running.',
    '- If a Todo-tracking MCP call fails but the next implementation action is still clear, continue the implementation work. Tracking failure is not task completion.',
    '- After an implementation, scaffold, or verification Todo is running, do not stop with a plan-only answer or next-steps summary. Continue the concrete work, or close the current Todo with block/fail and explain the blocker.',
    '- For planning, implementation-plan, specification, design-doc, or requirement-check work, call nightworkers.read_current_specification first. If missing, use nightworkers.list_recent_specifications and then read by taskId.',
    '- Ground plans and verification steps in the specification content when available.',
    '- Use nightworkers.import_project as the single Project import entrypoint. For new scaffolds, pass source=starter with stack/variant. For arbitrary Git imports, pass source=git with repoUrl.',
    '- For unspecified new Web/API apps in an empty or near-empty Project root, use source=starter, stack=hono, and the default SQLite variant unless the user explicitly asks for another stack, blank project, or a DB/RAG/SSR/SSG variant.',
    '- If the user specifies a DB, choose the matching starter variant such as postgres, pgvector, turso, or cloudflare. If the user asks for RAG or embeddings-backed search, choose variant=rag on the hono stack. If the user specifies SSR or SSG without a DB/RAG variant, pass the matching overlay. Do not combine a DB/RAG variant and an overlay in one call.',
    '- Do not use shell git clone when nightworkers.import_project covers the task.',
    '- If nightworkers.import_project fails, is cancelled, or is not approved, stop and report the tool failure. Do not create a fallback static app or alternate implementation.',
    '- After import_project succeeds, first use postImport.llmContext when present, plus postImport.manifest and postImport.initialization. Do not re-read LLM_CONTEXT.md, package.json, or re-run install unless that payload is missing, truncated, or failed for a reason you are actively fixing.',
    '- Use postImport.manifest.recommendedVerificationCommands when choosing manifest-based verification before reporting completion.',
    '- For CLI evidence, prefer NightWorkers worker-tool results. run_command and run_verification keep full stdout/stderr by default, so preserve exact git/build/test output unless it is truly excessive.',
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
