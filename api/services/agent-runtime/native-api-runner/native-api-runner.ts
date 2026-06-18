import * as repo from '../../../modules/nightworkers/nightworkers.repository';
import { estimateTokens } from '../../conversation-context/token-budget';
import { recordLlmUsage } from '../../llm-usage';
import { callProviderToolTurn } from '../../structured-llm/providers';
import { normalizeStructuredLlmModelTarget } from '../../structured-llm/selection';
import type { ProviderToolTurnResult } from '../../structured-llm/tool-calls';
import type { AgentRunContext, AgentRuntimeResult, AgentRuntimeSink } from '../types';
import { readNativeApiExecutionMode } from './native-api-mode';
import {
  buildNativeApiProviderRequests,
  type NativeApiProviderRequest,
} from './native-api-request-adapter';
import { NativeApiSessionStore } from './native-api-session-store';
import {
  NativeApiStartupController,
  type NativeApiStartupControllerLike,
} from './native-api-startup-controller';
import {
  dispatchNativeApiToolCall,
  type NativeApiDispatchState,
  type NativeApiPostImportState,
} from './native-api-tool-dispatcher';
import { buildInitialNativeApiHistory, type NativeApiHistoryItem } from './native-api-tool-history';
import { getNativeApiToolDefinitions } from './native-api-tool-registry';

const DEFAULT_MAX_NATIVE_API_TURNS = 20;

export type NativeApiToolTurnProvider = typeof callProviderToolTurn;
type NativeApiUsageRecorder = typeof recordLlmUsage;

export class NativeApiRunner {
  private readonly cancelledRunIds = new Set<string>();
  private readonly activeRunControllers = new Map<string, AbortController>();
  private readonly store: NativeApiSessionStore;
  private readonly startupController: NativeApiStartupControllerLike;
  private readonly providerTurn: NativeApiToolTurnProvider;
  private readonly usageRecorder: NativeApiUsageRecorder;
  private readonly maxTurns: number;

  constructor(
    input: {
      store?: NativeApiSessionStore;
      startupController?: NativeApiStartupControllerLike;
      providerTurn?: NativeApiToolTurnProvider;
      usageRecorder?: NativeApiUsageRecorder;
      maxTurns?: number;
    } = {}
  ) {
    this.store = input.store ?? new NativeApiSessionStore();
    this.startupController =
      input.startupController ?? new NativeApiStartupController({ store: this.store });
    this.providerTurn = input.providerTurn ?? callProviderToolTurn;
    this.usageRecorder = input.usageRecorder ?? recordLlmUsage;
    this.maxTurns = input.maxTurns ?? DEFAULT_MAX_NATIVE_API_TURNS;
  }

  async run(
    context: AgentRunContext,
    sink: AgentRuntimeSink,
    signal?: AbortSignal
  ): Promise<AgentRuntimeResult> {
    if (signal?.aborted || this.cancelledRunIds.has(context.runId)) {
      return this.toCancelled();
    }

    let history: NativeApiHistoryItem[] = buildInitialNativeApiHistory(context);
    let state: NativeApiDispatchState = {
      readFiles: [],
      specificationRead: false,
      initialInstructionsCompleted: false,
      contextCompiled: false,
      todoAligned: false,
      startupCompleted: false,
      postImport: null,
      importProjectSucceeded: false,
      copyDirectorySucceeded: false,
      manifestReadAfterImport: false,
      successfulVerificationCommands: [],
      compileEvalCompleted: false,
    };
    let lastTodoSnapshotContent: string | null = null;
    let lastPostImportHistoryToolCallId: string | null = null;
    const executionMode = readNativeApiExecutionMode(context);
    const routeOverride = readRuntimeLlmRouteOverride(context);
    const runController = new AbortController();
    this.activeRunControllers.set(context.runId, runController);
    const timeout = createTimeoutSignal(signal, runController.signal, context.timeoutSeconds);
    try {
      if (shouldForceStartupGates(context)) {
        const startup = await this.startupController.runStartup({
          context,
          sink,
          history,
          state,
          signal: timeout.signal,
        });
        history = startup.history;
        state = startup.state;
        if (!startup.ok) {
          return startup.result;
        }
      }
      const contextWindowBaselineHistory = [...history];

      for (let turnIndex = 1; turnIndex <= this.maxTurns; turnIndex += 1) {
        if (await this.isCancelled(context.runId, timeout.signal)) return this.toCancelled();
        const todoSnapshot = await buildTodoSnapshotHistoryItem(context.runId);
        if (todoSnapshot && todoSnapshot.content !== lastTodoSnapshotContent) {
          history = [...history, todoSnapshot];
          lastTodoSnapshotContent = todoSnapshot.content;
        }
        if (state.postImport && state.postImport.toolCallId !== lastPostImportHistoryToolCallId) {
          history = [...history, buildPostImportHistoryItem(state.postImport)];
          lastPostImportHistoryToolCallId = state.postImport.toolCallId;
        }
        const providerRequests = buildNativeApiProviderRequests({
          context,
          history,
          tools: getNativeApiToolDefinitions({ executionMode }),
          routeOverride,
          routePolicy: {
            disallowedProviderIds: ['codex'],
            synthesizeFallbacksFromEnabledEndpoints: true,
          },
        });
        const initialProviderRequest = providerRequests[0];
        const turn = await this.store.createTurn({
          runId: context.runId,
          taskId: context.taskId,
          turnIndex,
          history,
          provider: initialProviderRequest.provider,
          model: initialProviderRequest.options.normalizedRequest.modelOrDeployment,
        });

        await sink.emit({
          type: 'turn_started',
          message: `[NativeApiRunner] provider-native turn ${turnIndex} started.`,
          payload: {
            runtime: 'native_api_runner',
            executionMode,
            turnId: turn.id,
            turnIndex,
            provider: initialProviderRequest.provider,
            providerEndpointId: initialProviderRequest.options.normalizedRequest.providerEndpointId,
            model: initialProviderRequest.options.normalizedRequest.modelOrDeployment,
            routeCandidateCount: providerRequests.length,
            messageRoles: initialProviderRequest.messages.map((message) => message.role),
            toolCount: initialProviderRequest.tools.length,
          },
        });

        let providerDebug: Record<string, unknown> = {};
        let providerResult: ProviderToolTurnResult | null = null;
        let providerRequest: NativeApiProviderRequest = initialProviderRequest;
        let startedAt = Date.now();
        let lastProviderFailure: {
          message: string;
          providerDebug: Record<string, unknown>;
        } | null = null;
        const routeAttempts: Array<Record<string, unknown>> = [];
        for (let attemptIndex = 0; attemptIndex < providerRequests.length; attemptIndex += 1) {
          providerRequest = providerRequests[attemptIndex];
          providerDebug = {};
          startedAt = Date.now();
          try {
            providerResult = await this.providerTurn({
              provider: providerRequest.provider,
              messages: providerRequest.messages,
              tools: providerRequest.tools,
              systemPrompt: providerRequest.systemPrompt,
              userPrompt: providerRequest.userPrompt,
              options: providerRequest.options,
              signal: timeout.signal,
              setProviderDebug: (value) => {
                providerDebug = value;
              },
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            lastProviderFailure = { message, providerDebug };
            routeAttempts.push({
              attemptIndex,
              ok: false,
              reason: 'provider_error',
              message,
              route: summarizeNativeApiRoute(providerRequest),
              providerDebug,
            });
            if (timeout.signal.aborted || (await this.isCancelled(context.runId, timeout.signal))) {
              providerResult = null;
              break;
            }
            if (attemptIndex < providerRequests.length - 1) {
              await emitNativeApiRouteFallback({
                sink,
                turnId: turn.id,
                attemptIndex,
                from: providerRequest,
                to: providerRequests[attemptIndex + 1],
                reason: 'provider_error',
                message,
              });
              continue;
            }
            providerResult = null;
          }

          if (!providerResult) break;
          routeAttempts.push({
            attemptIndex,
            ok: providerResult.type === 'supported',
            reason:
              providerResult.type === 'unsupported'
                ? 'unsupported'
                : providerResult.toolCalls.length === 0 && !providerResult.content.trim()
                  ? 'empty_no_tool_calls'
                  : 'accepted',
            route: summarizeNativeApiRoute(providerRequest),
            providerDebug: providerResult.providerDebug ?? providerDebug,
          });
          if (
            providerResult.type === 'supported' &&
            (providerResult.toolCalls.length > 0 || providerResult.content.trim())
          ) {
            break;
          }
          if (timeout.signal.aborted || (await this.isCancelled(context.runId, timeout.signal))) {
            providerResult = null;
            break;
          }
          if (attemptIndex < providerRequests.length - 1) {
            await emitNativeApiRouteFallback({
              sink,
              turnId: turn.id,
              attemptIndex,
              from: providerRequest,
              to: providerRequests[attemptIndex + 1],
              reason:
                providerResult.type === 'unsupported'
                  ? 'unsupported_provider'
                  : 'empty_no_tool_calls',
              message:
                providerResult.type === 'unsupported'
                  ? providerResult.reason
                  : 'Provider returned no native tool calls or content.',
            });
            continue;
          }
          break;
        }

        providerDebug = {
          ...(providerResult?.providerDebug ?? providerDebug),
          routeAttempts,
        };
        if (!providerResult) {
          const message = lastProviderFailure?.message ?? 'No native API provider route succeeded.';
          const cancelled = await this.isCancelled(context.runId, timeout.signal);
          await this.store.finishTurn({
            turnId: turn.id,
            status: cancelled ? 'cancelled' : 'failed',
            history,
            providerDebug,
            error: cancelled ? { message: 'Run cancelled during provider turn.' } : { message },
          });
          if (cancelled) return this.toCancelled();
          await sink.emit({
            type: 'runtime_error',
            message: `[NativeApiRunner] provider turn failed: ${message}`,
            payload: { provider: providerRequest.provider, error: message },
          });
          return {
            terminalState: 'needs_human',
            summary: 'Native API provider turn failed.',
            finalReport: `Native API provider turn failed without Codex/SchemaFirst fallback: ${message}`,
            stoppedBy: 'llm_error',
            riskLevel: 'high',
          };
        }

        if (await this.isCancelled(context.runId, timeout.signal)) {
          await this.store.finishTurn({
            turnId: turn.id,
            status: 'cancelled',
            history,
            providerDebug: providerResult.providerDebug ?? providerDebug,
            error: { message: 'Run cancelled after provider turn.' },
            model: providerResult.type === 'supported' ? (providerResult.model ?? null) : null,
          });
          return this.toCancelled();
        }

        if (providerResult.type === 'unsupported') {
          await this.store.finishTurn({
            turnId: turn.id,
            status: 'failed',
            history,
            providerDebug: providerResult.providerDebug ?? providerDebug,
            error: { message: providerResult.reason },
          });
          return {
            terminalState: 'needs_human',
            summary: 'Native API provider tool turn is unsupported.',
            finalReport: `${providerResult.reason}. NativeApiRunner did not fall back to Codex or SchemaFirst.`,
            stoppedBy: 'missing_tool_call',
            riskLevel: 'high',
          };
        }

        await recordNativeApiTurnUsage({
          context,
          executionMode,
          providerResult,
          providerDebug,
          systemPrompt: providerRequest.systemPrompt,
          userPrompt: providerRequest.userPrompt,
          turnIndex,
          provider: providerRequest.options.normalizedRequest.providerId,
          model:
            providerResult.model ?? providerRequest.options.normalizedRequest.modelOrDeployment,
          durationMs: Date.now() - startedAt,
          usageRecorder: this.usageRecorder,
        });

        history = [
          ...history,
          {
            type: 'assistant',
            content: providerResult.content,
            toolCalls: providerResult.toolCalls,
          },
        ];

        if (providerResult.toolCalls.length === 0) {
          const finalText = providerResult.content.trim();
          await this.store.finishTurn({
            turnId: turn.id,
            status: finalText ? 'completed' : 'failed',
            history,
            providerDebug: providerResult.providerDebug ?? providerDebug,
            model: providerResult.model ?? null,
          });
          if (finalText) {
            return {
              terminalState: 'completed',
              summary: firstLine(finalText),
              finalReport: finalText,
              stoppedBy: 'decision',
              riskLevel: 'medium',
            };
          }
          return {
            terminalState: 'needs_human',
            summary: 'Provider returned no native tool calls.',
            finalReport:
              'Provider returned no native tool calls. NativeApiRunner requires finalize_answer and did not fall back to Codex or SchemaFirst.',
            stoppedBy: 'missing_tool_call',
            riskLevel: 'high',
          };
        }

        for (const toolCall of providerResult.toolCalls) {
          if (await this.isCancelled(context.runId, timeout.signal)) {
            await this.store.finishTurn({ turnId: turn.id, status: 'cancelled', history });
            return this.toCancelled();
          }
          const record = await this.store.recordToolCallPending({
            runId: context.runId,
            taskId: context.taskId,
            turnId: turn.id,
            toolCall,
            todoSeq: context.currentTodo?.seq ?? null,
          });
          if (await this.isCancelled(context.runId, timeout.signal)) {
            await this.store.finishToolCall({
              id: record.id,
              status: 'cancelled',
              error: { message: 'Run cancelled before tool execution.' },
              modelVisibleOutput: JSON.stringify({
                ok: false,
                error: { code: 'RUN_CANCELLED', message: 'Run cancelled before tool execution.' },
              }),
            });
            await this.store.finishTurn({ turnId: turn.id, status: 'cancelled', history });
            return this.toCancelled();
          }
          await this.store.markToolCallRunning({ id: record.id });
          if (await this.isCancelled(context.runId, timeout.signal)) {
            await this.store.finishToolCall({
              id: record.id,
              status: 'cancelled',
              error: { message: 'Run cancelled before tool execution.' },
              modelVisibleOutput: JSON.stringify({
                ok: false,
                error: { code: 'RUN_CANCELLED', message: 'Run cancelled before tool execution.' },
              }),
            });
            await this.store.finishTurn({ turnId: turn.id, status: 'cancelled', history });
            return this.toCancelled();
          }
          const dispatch = await dispatchNativeApiToolCall({
            toolCall,
            context,
            sink,
            state,
          }).catch((error): Awaited<ReturnType<typeof dispatchNativeApiToolCall>> => {
            const message = error instanceof Error ? error.message : String(error);
            return {
              kind: 'continue',
              state,
              toolResult: {
                ok: false,
                content: JSON.stringify({
                  ok: false,
                  error: { code: 'TOOL_DISPATCH_EXCEPTION', message },
                }),
                error: { code: 'TOOL_DISPATCH_EXCEPTION', message },
              },
            };
          });
          state = dispatch.state;
          history = [
            ...history,
            {
              type: 'tool_result',
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              result: dispatch.toolResult,
            },
          ];
          await this.store.finishToolCall({
            id: record.id,
            status: dispatch.toolResult.ok ? 'completed' : 'failed',
            result: dispatch.toolResult,
            error: dispatch.toolResult.error,
            modelVisibleOutput: dispatch.toolResult.content,
          });
          if (dispatch.kind === 'final') {
            await this.store.finishTurn({
              turnId: turn.id,
              status: 'completed',
              history,
              providerDebug: providerResult.providerDebug ?? providerDebug,
              model: providerResult.model ?? null,
            });
            return {
              terminalState: 'completed',
              summary: dispatch.summary,
              finalReport: dispatch.finalReport,
              stoppedBy: 'decision',
              riskLevel: 'medium',
            };
          }
        }

        await this.store.finishTurn({
          turnId: turn.id,
          status: 'completed',
          history,
          providerDebug: providerResult.providerDebug ?? providerDebug,
          model: providerResult.model ?? null,
        });

        if (state.newContextWindowRequested) {
          history = [...contextWindowBaselineHistory];
          state = {
            ...state,
            newContextWindowRequested: false,
          };
          lastTodoSnapshotContent = null;
          lastPostImportHistoryToolCallId = null;
          await sink.emit({
            type: 'tool_call_progress',
            message:
              '[NativeApiRunner] started a new provider context window without summarizing conversation history.',
            payload: {
              action: 'context_window_started',
              runtime: 'native_api_runner',
              turnIndex,
              retainedHistoryItems: history.length,
            },
          });
        }
      }
    } finally {
      timeout.dispose();
      this.activeRunControllers.delete(context.runId);
    }

    return {
      terminalState: 'needs_human',
      summary: 'NativeApiRunner reached its maximum provider-native turns.',
      finalReport: 'NativeApiRunner reached its maximum provider-native turns.',
      stoppedBy: 'budget',
      riskLevel: 'high',
    };
  }

  async stop(runId: string): Promise<void> {
    this.cancelledRunIds.add(runId);
    this.activeRunControllers.get(runId)?.abort(new Error('NativeApiRunner stop requested.'));
  }

  private toCancelled(): AgentRuntimeResult {
    return {
      terminalState: 'cancelled',
      summary: 'Runtime execution cancelled.',
      finalReport: 'Runtime execution cancelled.',
      stoppedBy: 'cancelled',
      riskLevel: 'medium',
    };
  }

  private async isCancelled(runId: string, signal?: AbortSignal) {
    if (signal?.aborted || this.cancelledRunIds.has(runId)) return true;
    try {
      const run = await repo.getTaskRun(runId);
      if (run?.status === 'cancelled') {
        this.cancelledRunIds.add(runId);
        return true;
      }
    } catch {
      return false;
    }
    return false;
  }
}

function shouldForceStartupGates(context: AgentRunContext): boolean {
  return context.runtimeOptions?.forceStartupGates === true;
}

async function emitNativeApiRouteFallback(input: {
  sink: AgentRuntimeSink;
  turnId: string;
  attemptIndex: number;
  from: NativeApiProviderRequest;
  to: NativeApiProviderRequest;
  reason: string;
  message: string;
}) {
  await input.sink.emit({
    type: 'tool_call_progress',
    message: `[NativeApiRunner] provider-native route fallback started: ${input.reason}.`,
    payload: {
      runtime: 'native_api_runner',
      action: 'provider_route_fallback_started',
      turnId: input.turnId,
      attemptIndex: input.attemptIndex,
      reason: input.reason,
      message: input.message,
      from: summarizeNativeApiRoute(input.from),
      to: summarizeNativeApiRoute(input.to),
    },
  });
}

function summarizeNativeApiRoute(request: NativeApiProviderRequest) {
  return {
    provider: request.provider,
    providerId: request.options.normalizedRequest.providerId,
    providerEndpointId: request.options.normalizedRequest.providerEndpointId ?? null,
    routeSource: request.options.normalizedRequest.routeSource ?? null,
    model: request.options.normalizedRequest.modelOrDeployment ?? null,
    thinkingDepth: request.options.normalizedRequest.thinkingDepth ?? null,
  };
}

function readRuntimeLlmRouteOverride(context: AgentRunContext) {
  const routing =
    context.runtimeOptions?.llmRouting &&
    typeof context.runtimeOptions.llmRouting === 'object' &&
    !Array.isArray(context.runtimeOptions.llmRouting)
      ? (context.runtimeOptions.llmRouting as Record<string, unknown>)
      : {};
  return normalizeStructuredLlmModelTarget(routing.override);
}

async function buildTodoSnapshotHistoryItem(
  runId: string
): Promise<Extract<NativeApiHistoryItem, { type: 'user' }> | null> {
  try {
    const todos = await repo.listTaskRunTodosForRun(runId);
    if (todos.length === 0) return null;
    const lines = todos
      .sort((a, b) => a.seq - b.seq)
      .map((todo) => {
        const title = todo.title.replace(/\s+/g, ' ').trim();
        return `seq=${todo.seq} status=${todo.status} taskType=${todo.taskType} procedureId=${todo.procedureId ?? 'none'} title=${title}`;
      });
    return {
      type: 'user',
      source: 'todo',
      content: ['[Native API Runner Todo Snapshot]', ...lines].join('\n'),
    };
  } catch {
    return null;
  }
}

function buildPostImportHistoryItem(
  postImport: NativeApiPostImportState
): Extract<NativeApiHistoryItem, { type: 'user' }> {
  const manifest = toRecord(postImport.manifest);
  const packageJson = toRecord(manifest?.packageJson);
  const scripts = toRecord(packageJson?.scripts);
  return {
    type: 'user',
    source: 'state_card',
    content: [
      '[Native API Runner Post Import]',
      `toolCallId=${postImport.toolCallId}`,
      `mode=${postImport.mode}`,
      `templateId=${postImport.templateId ?? 'none'}`,
      `variant=${postImport.variant ?? 'none'}`,
      `manifestStatus=${typeof manifest?.status === 'string' ? manifest.status : 'unknown'}`,
      `manifestPath=${typeof manifest?.path === 'string' ? manifest.path : 'unknown'}`,
      `detectedPackageManager=${
        typeof manifest?.detectedPackageManager === 'string'
          ? manifest.detectedPackageManager
          : 'unknown'
      }`,
      `scripts=${Object.keys(scripts ?? {}).join(', ') || 'none'}`,
      `recommendedVerificationCommands=${
        postImport.recommendedVerificationCommands.join(' | ') || 'none'
      }`,
      `verifiedCommand=${postImport.verifiedCommand ?? 'none'}`,
      postImport.llmContext ? 'llmContext=available' : 'llmContext=missing',
      '',
      'Use this postImport payload before re-reading package manifests. If recommended verification commands exist, run one successfully before finalize_answer.',
    ].join('\n'),
  };
}

async function recordNativeApiTurnUsage(input: {
  context: AgentRunContext;
  executionMode: ReturnType<typeof readNativeApiExecutionMode>;
  providerResult: Extract<ProviderToolTurnResult, { type: 'supported' }>;
  providerDebug: Record<string, unknown>;
  systemPrompt: string;
  userPrompt: string;
  turnIndex: number;
  provider: string;
  model: string | null;
  durationMs: number;
  usageRecorder: NativeApiUsageRecorder;
}) {
  await input.usageRecorder({
    taskId: input.context.taskId,
    runId: input.context.runId,
    callId: `${input.context.runId}:native-api-turn:${input.turnIndex}`,
    provider: input.provider,
    model: input.model,
    label: 'native_api_runner',
    round: null,
    usage: input.providerResult.usage,
    promptPartTokenEstimates: {
      latestUserMessageTokens:
        input.context.contextSnapshot.conversationContext?.usage?.latestUserMessageTokens,
      stateCardTokens: input.context.contextSnapshot.conversationContext?.usage?.stateCardTokens,
      userPromptTokens:
        input.context.contextSnapshot.conversationContext?.usage?.runtimeUserPromptTokens ??
        estimateTokens(input.userPrompt),
      systemPromptTokens: estimateTokens(input.systemPrompt),
    },
    durationMs: input.durationMs,
    metadataJson: {
      mode: 'native_api_runner',
      executionMode: input.executionMode,
      toolCallCount: input.providerResult.toolCalls.length,
      providerDebug: input.providerDebug,
    },
  });
}

function createTimeoutSignal(
  parent: AbortSignal | undefined,
  runSignal: AbortSignal,
  timeoutSeconds: number
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error(`NativeApiRunner timed out after ${timeoutSeconds}s`));
  }, Math.max(1, timeoutSeconds) * 1000);
  const abortFromParent = () => controller.abort(parent?.reason);
  const abortFromRun = () => controller.abort(runSignal.reason);
  if (parent?.aborted) {
    abortFromParent();
  } else {
    parent?.addEventListener('abort', abortFromParent, { once: true });
  }
  if (runSignal.aborted) {
    abortFromRun();
  } else {
    runSignal.addEventListener('abort', abortFromRun, { once: true });
  }
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timeout);
      parent?.removeEventListener('abort', abortFromParent);
      runSignal.removeEventListener('abort', abortFromRun);
    },
  };
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstLine(value: string) {
  return (
    value
      .split(/\r?\n/)
      .find((line) => line.trim())
      ?.trim() || value.trim()
  );
}
