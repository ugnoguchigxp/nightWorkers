import * as repo from '../../../modules/nightworkers/nightworkers.repository';
import { estimateTokens } from '../../conversation-context/token-budget';
import { recordLlmUsage } from '../../llm-usage';
import { getCachedStructuredLlmProviderHealth } from '../../structured-llm/provider-health';
import { callProviderToolTurn } from '../../structured-llm/providers';
import { normalizeStructuredLlmModelTarget } from '../../structured-llm/selection';
import {
  readStructuredLlmProviderSettings,
  type StructuredLlmProviderEndpoint,
} from '../../structured-llm/settings';
import type { ProviderToolTurnResult } from '../../structured-llm/tool-calls';
import type { StructuredLlmRoutePolicy } from '../../structured-llm/types';
import type { AgentRunContext, AgentRuntimeResult, AgentRuntimeSink } from '../types';
import {
  NativeApiCloseoutController,
  type NativeApiCloseoutControllerLike,
} from './native-api-closeout-controller';
import {
  estimateNativeApiContextBudget,
  type NativeApiContextBudget,
  renderNativeApiContextBudgetHint,
} from './native-api-context-budget';
import {
  compactNativeApiHistoryToBaseline,
  type NativeApiBaselineCompactionResult,
} from './native-api-context-compaction';
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

export type NativeApiToolTurnProvider = typeof callProviderToolTurn;
type NativeApiUsageRecorder = typeof recordLlmUsage;

export class NativeApiRunner {
  private readonly cancelledRunIds = new Set<string>();
  private readonly activeRunControllers = new Map<string, AbortController>();
  private readonly store: NativeApiSessionStore;
  private readonly startupController: NativeApiStartupControllerLike;
  private readonly closeoutController: NativeApiCloseoutControllerLike;
  private readonly providerTurn: NativeApiToolTurnProvider;
  private readonly usageRecorder: NativeApiUsageRecorder;

  constructor(
    input: {
      store?: NativeApiSessionStore;
      startupController?: NativeApiStartupControllerLike;
      closeoutController?: NativeApiCloseoutControllerLike;
      providerTurn?: NativeApiToolTurnProvider;
      usageRecorder?: NativeApiUsageRecorder;
    } = {}
  ) {
    this.store = input.store ?? new NativeApiSessionStore();
    this.startupController =
      input.startupController ?? new NativeApiStartupController({ store: this.store });
    this.closeoutController =
      input.closeoutController ?? new NativeApiCloseoutController({ store: this.store });
    this.providerTurn = input.providerTurn ?? callProviderToolTurn;
    this.usageRecorder = input.usageRecorder ?? recordLlmUsage;
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
    let lastCurrentTodoContent: string | null = null;
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
      let contextBudgetHintInserted = false;
      let runtimeBaselineCompactionCount = 0;

      for (let turnIndex = 1; ; turnIndex += 1) {
        if (await this.isCancelled(context.runId, timeout.signal)) return this.toCancelled();
        const todoSnapshot = await buildTodoSnapshotHistory(context.runId);
        const currentTodo = todoSnapshot?.currentTodo ?? null;
        if (
          todoSnapshot?.snapshotItem &&
          todoSnapshot.snapshotItem.content !== lastTodoSnapshotContent
        ) {
          history = [...history, todoSnapshot.snapshotItem];
          lastTodoSnapshotContent = todoSnapshot.snapshotItem.content;
        }
        if (
          todoSnapshot?.currentTodoItem &&
          todoSnapshot.currentTodoItem.content !== lastCurrentTodoContent
        ) {
          history = [...history, todoSnapshot.currentTodoItem];
          lastCurrentTodoContent = todoSnapshot.currentTodoItem.content;
        }
        if (state.postImport && state.postImport.toolCallId !== lastPostImportHistoryToolCallId) {
          history = [...history, buildPostImportHistoryItem(state.postImport)];
          lastPostImportHistoryToolCallId = state.postImport.toolCallId;
        }
        const routePolicy = await buildNativeApiRoutePolicy({
          sink,
          runId: context.runId,
          taskId: context.taskId,
          basePolicy: {
            disallowedProviderIds: ['codex'],
          },
        });
        const tools = getNativeApiToolDefinitions({ executionMode });
        let providerRequests = buildNativeApiProviderRequests({
          context,
          history,
          tools,
          routeOverride,
          routePolicy,
        });
        const routeSnapshotGuard = validateNativeApiRouteSnapshot(providerRequests, context);
        if (!routeSnapshotGuard.ok) {
          await sink.emit({
            type: 'runtime_error',
            message: '[NativeApiRunner] provider route candidate was outside the run snapshot.',
            payload: {
              runtime: 'native_api_runner',
              executionMode,
              reason: 'route_candidate_outside_snapshot',
              route: routeSnapshotGuard.route,
            },
          });
          return {
            terminalState: 'needs_human',
            summary: 'Native API route candidate was outside the run snapshot.',
            finalReport:
              'Native API route candidate was outside the run snapshot. Provider call was blocked before execution.',
            stoppedBy: 'llm_error',
            riskLevel: 'high',
          };
        }
        if (providerRequests.length === 0) {
          await sink.emit({
            type: 'runtime_error',
            message: '[NativeApiRunner] no native/API provider route candidates were available.',
            payload: {
              runtime: 'native_api_runner',
              executionMode,
              reason: 'no_native_api_provider_route_candidates',
            },
          });
          return {
            terminalState: 'needs_human',
            summary: 'No native/API provider route candidates were available.',
            finalReport:
              'No native/API provider route candidates were available. NativeApiRunner did not fall back to Codex or SchemaFirst.',
            stoppedBy: 'llm_error',
            riskLevel: 'high',
          };
        }
        let contextBudget = estimateNativeApiContextBudget(providerRequests[0]);
        let contextCompaction: NativeApiBaselineCompactionResult | null = null;
        if (contextBudget.warningThresholdExceeded && !contextBudgetHintInserted) {
          await emitNativeApiContextBudgetEvent({
            sink,
            context,
            action: 'context_budget_warning',
            turnIndex,
            budget: contextBudget,
            message: '[NativeApiRunner] context budget warning threshold exceeded.',
          });
          history = [
            ...history,
            {
              type: 'user',
              source: 'runtime',
              content: renderNativeApiContextBudgetHint(contextBudget),
            },
          ];
          contextBudgetHintInserted = true;
          providerRequests = buildNativeApiProviderRequests({
            context,
            history,
            tools,
            routeOverride,
            routePolicy,
          });
          if (providerRequests.length === 0) {
            await sink.emit({
              type: 'runtime_error',
              message: '[NativeApiRunner] no native/API provider route candidates were available.',
              payload: {
                runtime: 'native_api_runner',
                executionMode,
                reason: 'no_native_api_provider_route_candidates',
              },
            });
            return {
              terminalState: 'needs_human',
              summary: 'No native/API provider route candidates were available.',
              finalReport:
                'No native/API provider route candidates were available. NativeApiRunner did not fall back to Codex or SchemaFirst.',
              stoppedBy: 'llm_error',
              riskLevel: 'high',
            };
          }
          contextBudget = estimateNativeApiContextBudget(providerRequests[0]);
        }
        if (contextBudget.compactLimitExceeded) {
          if (runtimeBaselineCompactionCount >= MAX_RUNTIME_BASELINE_COMPACTIONS) {
            await emitNativeApiContextBudgetEvent({
              sink,
              context,
              action: 'context_compaction_failed',
              turnIndex,
              budget: contextBudget,
              message:
                '[NativeApiRunner] context compaction loop guard stopped provider-native execution.',
            });
            return contextBudgetFailureResult(contextBudget, 'context_compaction_loop_guard');
          }
          await emitNativeApiContextBudgetEvent({
            sink,
            context,
            action: 'context_compaction_started',
            turnIndex,
            budget: contextBudget,
            message: '[NativeApiRunner] context compaction started before provider call.',
          });
          contextCompaction = compactNativeApiHistoryToBaseline({
            baselineHistory: contextWindowBaselineHistory,
            previousHistory: history,
            reason: contextBudget.hardLimitExceeded
              ? 'hard_limit_exceeded_before_provider_call'
              : 'auto_compact_limit_exceeded_before_provider_call',
            todoSnapshotItem: todoSnapshot?.snapshotItem,
            currentTodoItem: todoSnapshot?.currentTodoItem,
            postImportHistoryItem: state.postImport
              ? buildPostImportHistoryItem(state.postImport)
              : null,
          });
          runtimeBaselineCompactionCount += 1;
          history = contextCompaction.history;
          providerRequests = buildNativeApiProviderRequests({
            context,
            history,
            tools,
            routeOverride,
            routePolicy,
          });
          if (providerRequests.length === 0) {
            await emitNativeApiContextBudgetEvent({
              sink,
              context,
              action: 'context_compaction_failed',
              turnIndex,
              budget: contextBudget,
              message:
                '[NativeApiRunner] context compaction finished but no native/API provider route candidates remained.',
              compaction: contextCompaction,
            });
            return {
              terminalState: 'needs_human',
              summary: 'No native/API provider route candidates were available after compaction.',
              finalReport:
                'Context compaction completed, but no native/API provider route candidates remained. NativeApiRunner did not fall back to Codex or SchemaFirst.',
              stoppedBy: 'llm_error',
              riskLevel: 'high',
            };
          }
          contextBudget = estimateNativeApiContextBudget(providerRequests[0]);
          await emitNativeApiContextBudgetEvent({
            sink,
            context,
            action: 'context_compaction_finished',
            turnIndex,
            budget: contextBudget,
            message: '[NativeApiRunner] context compaction finished before provider call.',
            compaction: contextCompaction,
          });
          if (contextBudget.compactLimitExceeded || contextBudget.hardLimitExceeded) {
            await emitNativeApiContextBudgetEvent({
              sink,
              context,
              action: 'context_compaction_failed',
              turnIndex,
              budget: contextBudget,
              message:
                '[NativeApiRunner] context compaction did not reduce the provider request below the compact limit.',
              compaction: contextCompaction,
            });
            return contextBudgetFailureResult(contextBudget, 'context_compaction_insufficient');
          }
        }
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

        let contextPreflightDebug = {
          contextBudget,
          ...(contextCompaction
            ? { contextCompaction: summarizeNativeApiContextCompaction(contextCompaction) }
            : {}),
        };
        let providerDebug: Record<string, unknown> = { ...contextPreflightDebug };
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
          contextBudget = estimateNativeApiContextBudget(providerRequest);
          if (contextBudget.compactLimitExceeded) {
            if (runtimeBaselineCompactionCount >= MAX_RUNTIME_BASELINE_COMPACTIONS) {
              const message =
                'Context compaction loop guard stopped provider-native route attempt before provider call.';
              await emitNativeApiContextBudgetEvent({
                sink,
                context,
                action: 'context_compaction_failed',
                turnIndex,
                budget: contextBudget,
                message: `[NativeApiRunner] ${message}`,
              });
              lastProviderFailure = { message, providerDebug };
              routeAttempts.push({
                attemptIndex,
                ok: false,
                reason: 'context_compaction_loop_guard',
                message,
                durationMs: 0,
                attemptTimeoutMs: providerRequest.options.attemptTimeoutMs ?? null,
                route: summarizeNativeApiRoute(providerRequest),
                providerDebug,
              });
              providerResult = null;
              break;
            }
            await emitNativeApiContextBudgetEvent({
              sink,
              context,
              action: 'context_compaction_started',
              turnIndex,
              budget: contextBudget,
              message:
                '[NativeApiRunner] context compaction started before provider route attempt.',
            });
            contextCompaction = compactNativeApiHistoryToBaseline({
              baselineHistory: contextWindowBaselineHistory,
              previousHistory: history,
              reason: contextBudget.hardLimitExceeded
                ? 'hard_limit_exceeded_before_provider_call'
                : 'auto_compact_limit_exceeded_before_provider_call',
              todoSnapshotItem: todoSnapshot?.snapshotItem,
              currentTodoItem: todoSnapshot?.currentTodoItem,
              postImportHistoryItem: state.postImport
                ? buildPostImportHistoryItem(state.postImport)
                : null,
            });
            runtimeBaselineCompactionCount += 1;
            history = contextCompaction.history;
            providerRequests = buildNativeApiProviderRequests({
              context,
              history,
              tools,
              routeOverride,
              routePolicy,
            });
            const rebuiltRouteSnapshotGuard = validateNativeApiRouteSnapshot(
              providerRequests,
              context
            );
            if (!rebuiltRouteSnapshotGuard.ok) {
              const message =
                'Context compaction rebuilt a provider route candidate outside the run snapshot.';
              await sink.emit({
                type: 'runtime_error',
                message: `[NativeApiRunner] ${message}`,
                payload: {
                  runtime: 'native_api_runner',
                  executionMode,
                  reason: 'route_candidate_outside_snapshot',
                  route: rebuiltRouteSnapshotGuard.route,
                },
              });
              lastProviderFailure = { message, providerDebug };
              providerResult = null;
              break;
            }
            providerRequest = providerRequests[attemptIndex];
            if (!providerRequest) {
              const message =
                'Context compaction finished but the native/API route attempt disappeared.';
              await emitNativeApiContextBudgetEvent({
                sink,
                context,
                action: 'context_compaction_failed',
                turnIndex,
                budget: contextBudget,
                message: `[NativeApiRunner] ${message}`,
                compaction: contextCompaction,
              });
              lastProviderFailure = { message, providerDebug };
              providerResult = null;
              break;
            }
            contextBudget = estimateNativeApiContextBudget(providerRequest);
            contextPreflightDebug = {
              contextBudget,
              contextCompaction: summarizeNativeApiContextCompaction(contextCompaction),
            };
            await emitNativeApiContextBudgetEvent({
              sink,
              context,
              action: 'context_compaction_finished',
              turnIndex,
              budget: contextBudget,
              message:
                '[NativeApiRunner] context compaction finished before provider route attempt.',
              compaction: contextCompaction,
            });
            if (contextBudget.compactLimitExceeded || contextBudget.hardLimitExceeded) {
              const message =
                'Context compaction did not reduce the provider route attempt below the compact limit.';
              await emitNativeApiContextBudgetEvent({
                sink,
                context,
                action: 'context_compaction_failed',
                turnIndex,
                budget: contextBudget,
                message: `[NativeApiRunner] ${message}`,
                compaction: contextCompaction,
              });
              providerDebug = { ...contextPreflightDebug };
              lastProviderFailure = { message, providerDebug };
              routeAttempts.push({
                attemptIndex,
                ok: false,
                reason: 'context_budget_exceeded_before_provider_call',
                message,
                durationMs: 0,
                attemptTimeoutMs: providerRequest.options.attemptTimeoutMs ?? null,
                route: summarizeNativeApiRoute(providerRequest),
                providerDebug,
              });
              providerResult = null;
              break;
            }
          } else {
            contextPreflightDebug = {
              contextBudget,
              ...(contextCompaction
                ? { contextCompaction: summarizeNativeApiContextCompaction(contextCompaction) }
                : {}),
            };
          }
          providerDebug = { ...contextPreflightDebug };
          startedAt = Date.now();
          const attemptTimeoutMs = providerRequest.options.attemptTimeoutMs;
          const attemptSignal = createAttemptTimeoutSignal(timeout.signal, attemptTimeoutMs);
          try {
            providerResult = await this.providerTurn({
              provider: providerRequest.provider,
              messages: providerRequest.messages,
              tools: providerRequest.tools,
              systemPrompt: providerRequest.systemPrompt,
              userPrompt: providerRequest.userPrompt,
              options: providerRequest.options,
              signal: attemptSignal.signal,
              setProviderDebug: (value) => {
                providerDebug = value;
              },
            });
          } catch (error) {
            const durationMs = Date.now() - startedAt;
            const classified = classifyNativeApiProviderError(error, {
              attemptTimedOut: attemptSignal.didTimeout(),
              attemptTimeoutMs,
            });
            const message = classified.message;
            lastProviderFailure = { message, providerDebug };
            routeAttempts.push({
              attemptIndex,
              ok: false,
              reason: classified.reason,
              message,
              durationMs,
              attemptTimeoutMs: attemptTimeoutMs ?? null,
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
                reason: classified.reason,
                message,
              });
              continue;
            }
            providerResult = null;
          } finally {
            attemptSignal.dispose();
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
            durationMs: Date.now() - startedAt,
            attemptTimeoutMs: attemptTimeoutMs ?? null,
            route: summarizeNativeApiRoute(providerRequest),
            providerDebug,
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
          ...contextPreflightDebug,
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
            providerDebug,
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
            providerDebug,
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
          const canComplete = canCompleteWithTextOnly(executionMode, finalText);
          await this.store.finishTurn({
            turnId: turn.id,
            status: canComplete ? 'completed' : 'failed',
            history,
            providerDebug,
            model: providerResult.model ?? null,
          });
          if (canComplete) {
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
            finalReport: finalText
              ? 'Provider returned text without native tool calls. NativeApiRunner requires tool calls/finalize_answer for this execution mode and did not fall back to Codex or SchemaFirst.'
              : 'Provider returned no native tool calls. NativeApiRunner requires finalize_answer and did not fall back to Codex or SchemaFirst.',
            stoppedBy: 'missing_tool_call',
            riskLevel: 'high',
          };
        }

        for (const toolCall of providerResult.toolCalls) {
          if (await this.isCancelled(context.runId, timeout.signal)) {
            await this.store.finishTurn({
              turnId: turn.id,
              status: 'cancelled',
              history,
            });
            return this.toCancelled();
          }
          const record = await this.store.recordToolCallPending({
            runId: context.runId,
            taskId: context.taskId,
            turnId: turn.id,
            toolCall,
            todoSeq: currentTodo?.seq ?? context.currentTodo?.seq ?? null,
          });
          if (await this.isCancelled(context.runId, timeout.signal)) {
            await this.store.finishToolCall({
              id: record.id,
              status: 'cancelled',
              error: { message: 'Run cancelled before tool execution.' },
              modelVisibleOutput: JSON.stringify({
                ok: false,
                error: {
                  code: 'RUN_CANCELLED',
                  message: 'Run cancelled before tool execution.',
                },
              }),
            });
            await this.store.finishTurn({
              turnId: turn.id,
              status: 'cancelled',
              history,
            });
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
                error: {
                  code: 'RUN_CANCELLED',
                  message: 'Run cancelled before tool execution.',
                },
              }),
            });
            await this.store.finishTurn({
              turnId: turn.id,
              status: 'cancelled',
              history,
            });
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
            const closeout = await this.closeoutController.runCompileEval({
              context,
              sink,
              turnId: turn.id,
              state,
              finalReport: dispatch.finalReport,
              todoSeq: currentTodo?.seq ?? context.currentTodo?.seq ?? null,
            });
            state = closeout.state;
            if (!closeout.skipped) {
              history = [...history, closeout.historyItem];
            }
            await this.store.finishTurn({
              turnId: turn.id,
              status: 'completed',
              history,
              providerDebug,
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
          providerDebug,
          model: providerResult.model ?? null,
        });

        if (state.newContextWindowRequested) {
          history = [...contextWindowBaselineHistory];
          state = {
            ...state,
            newContextWindowRequested: false,
          };
          lastTodoSnapshotContent = null;
          lastCurrentTodoContent = null;
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
  if (context.runtimeOptions?.forceStartupGates === false) return false;
  const executionMode = readNativeApiExecutionMode(context);
  return (
    executionMode === 'implementation' ||
    executionMode === 'review' ||
    executionMode === 'runtime_debug'
  );
}

function canCompleteWithTextOnly(
  executionMode: ReturnType<typeof readNativeApiExecutionMode>,
  content: string
) {
  if (!content.trim()) return false;
  return executionMode === 'planning' || executionMode === 'general_answer';
}

const MAX_RUNTIME_BASELINE_COMPACTIONS = 3;

async function emitNativeApiContextBudgetEvent(input: {
  sink: AgentRuntimeSink;
  context: AgentRunContext;
  action:
    | 'context_budget_warning'
    | 'context_compaction_started'
    | 'context_compaction_finished'
    | 'context_compaction_failed';
  turnIndex: number;
  budget: NativeApiContextBudget;
  message: string;
  compaction?: NativeApiBaselineCompactionResult | null;
}) {
  const payload = {
    runtime: 'native_api_runner',
    action: input.action,
    runId: input.context.runId,
    taskId: input.context.taskId,
    turnIndex: input.turnIndex,
    contextBudget: summarizeNativeApiContextBudget(input.budget),
    ...(input.compaction
      ? { contextCompaction: summarizeNativeApiContextCompaction(input.compaction) }
      : {}),
  };
  await input.sink.emit({
    type: 'tool_call_progress',
    message: input.message,
    payload,
  });
  try {
    await repo.createTaskEvent({
      taskRunId: input.context.runId,
      type: input.action,
      actor: 'runtime',
      eventType: input.action,
      message: input.message,
      payloadJson: payload,
    });
  } catch {
    // Context budget events are observability-only; do not fail the runtime if event persistence fails.
  }
}

function summarizeNativeApiContextBudget(budget: NativeApiContextBudget) {
  return {
    estimatedPromptTokens: budget.estimatedPromptTokens,
    modelContextWindowTokens: budget.modelContextWindowTokens,
    safePromptBudgetTokens: budget.safePromptBudgetTokens,
    reservedOutputTokens: budget.reservedOutputTokens,
    autoCompactTokenLimit: budget.autoCompactTokenLimit,
    remainingContextHintThreshold: budget.remainingContextHintThreshold,
    remainingTokens: budget.remainingTokens,
    contextUsageRatio: budget.contextUsageRatio,
    warningThresholdExceeded: budget.warningThresholdExceeded,
    compactLimitExceeded: budget.compactLimitExceeded,
    hardLimitExceeded: budget.hardLimitExceeded,
    messageTokens: budget.messageTokens,
    toolTokens: budget.toolTokens,
  };
}

function summarizeNativeApiContextCompaction(compaction: NativeApiBaselineCompactionResult) {
  return {
    reason: compaction.reason,
    retainedHistoryItems: compaction.retainedHistoryItems,
    previousHistoryItems: compaction.previousHistoryItems,
  };
}

function contextBudgetFailureResult(
  budget: NativeApiContextBudget,
  reason: 'context_compaction_loop_guard' | 'context_compaction_insufficient'
): AgentRuntimeResult {
  return {
    terminalState: 'needs_human',
    summary: 'Native API context budget exceeded.',
    finalReport: [
      'Native API context budget exceeded before the provider call.',
      `reason=${reason}`,
      `estimatedPromptTokens=${budget.estimatedPromptTokens}`,
      `autoCompactTokenLimit=${budget.autoCompactTokenLimit}`,
      `modelContextWindowTokens=${budget.modelContextWindowTokens}`,
      'NativeApiRunner did not fall back to Codex, SchemaFirst, or an unconfigured provider endpoint.',
    ].join('\n'),
    stoppedBy: 'llm_error',
    riskLevel: 'high',
  };
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

function validateNativeApiRouteSnapshot(
  requests: NativeApiProviderRequest[],
  context: AgentRunContext
): { ok: true } | { ok: false; route: ReturnType<typeof summarizeNativeApiRoute> } {
  const allowedRouteKeys = readAllowedRouteKeysFromSnapshot(context);
  if (!allowedRouteKeys || requests.length === 0) return { ok: true };
  for (const request of requests) {
    const routeKey = nativeApiRequestRouteKey(request);
    if (!allowedRouteKeys.has(routeKey)) {
      return { ok: false, route: summarizeNativeApiRoute(request) };
    }
  }
  return { ok: true };
}

function readAllowedRouteKeysFromSnapshot(context: AgentRunContext): Set<string> | null {
  const snapshot = context.contextSnapshot as Record<string, unknown> | undefined;
  const effectiveLlmRouting = snapshot?.effectiveLlmRouting as Record<string, unknown> | undefined;
  const roles = effectiveLlmRouting?.roles as Record<string, unknown> | undefined;
  if (!roles) return null;
  const routeKeys = new Set<string>();
  for (const rolePlan of Object.values(roles)) {
    if (!rolePlan || typeof rolePlan !== 'object') continue;
    const record = rolePlan as Record<string, unknown>;
    collectSnapshotRouteKey(routeKeys, record.primary);
    collectSnapshotRouteKey(routeKeys, record.override);
    const fallbacks = Array.isArray(record.fallbacks) ? record.fallbacks : [];
    for (const fallback of fallbacks) collectSnapshotRouteKey(routeKeys, fallback);
    const candidates = Array.isArray(record.candidates) ? record.candidates : [];
    for (const candidate of candidates) collectSnapshotRouteKey(routeKeys, candidate);
  }
  return routeKeys.size > 0 ? routeKeys : null;
}

function collectSnapshotRouteKey(routeKeys: Set<string>, value: unknown) {
  if (!value || typeof value !== 'object') return;
  const route = value as Record<string, unknown>;
  if (typeof route.routeKey === 'string' && route.routeKey.trim()) {
    routeKeys.add(route.routeKey);
    return;
  }
  const providerEndpointId =
    typeof route.providerEndpointId === 'string' ? route.providerEndpointId : '';
  const model = typeof route.model === 'string' ? route.model : '';
  const providerId = typeof route.providerId === 'string' ? route.providerId : '';
  if (providerEndpointId && model && providerId) {
    routeKeys.add(`${providerEndpointId}::${model}::${providerId}`);
  }
}

function nativeApiRequestRouteKey(request: NativeApiProviderRequest) {
  const normalizedRequest = request.options.normalizedRequest;
  return [
    normalizedRequest.providerEndpointId ?? '',
    normalizedRequest.modelOrDeployment ?? '',
    normalizedRequest.providerId,
  ].join('::');
}

async function buildNativeApiRoutePolicy(input: {
  sink: AgentRuntimeSink;
  runId: string;
  taskId: string;
  basePolicy: StructuredLlmRoutePolicy;
}): Promise<StructuredLlmRoutePolicy> {
  if (
    process.env.NODE_ENV === 'test' &&
    process.env.NIGHTWORKERS_NATIVE_API_READINESS_PROBE !== '1'
  ) {
    return input.basePolicy;
  }
  const settings = readStructuredLlmProviderSettings();
  const endpoints = settings.providerEndpoints ?? [];
  const endpointReadiness: NonNullable<StructuredLlmRoutePolicy['endpointReadiness']> = {};
  await Promise.all(
    endpoints.filter(shouldProbeNativeApiEndpointReadiness).map(async (endpoint) => {
      const result = await getCachedStructuredLlmProviderHealth(endpoint, {
        timeoutMs: 1000,
        cacheTtlMs: 30_000,
      });
      endpointReadiness[endpoint.id] = {
        reachable: result.reachable,
        ok: result.ok,
        checkedAt: result.checkedAt,
        message: result.message,
      };
      if (result.reachable === false) {
        await input.sink.emit({
          type: 'tool_call_progress',
          message: `[NativeApiRunner] provider endpoint skipped by readiness: ${endpoint.id}.`,
          payload: {
            runtime: 'native_api_runner',
            action: 'provider_readiness_skip',
            runId: input.runId,
            taskId: input.taskId,
            providerEndpointId: endpoint.id,
            providerKind: endpoint.kind,
            message: result.message,
          },
        });
      }
    })
  );
  return {
    ...input.basePolicy,
    skipUnreachableEndpoints: true,
    endpointReadiness,
  };
}

function shouldProbeNativeApiEndpointReadiness(endpoint: StructuredLlmProviderEndpoint) {
  return (
    endpoint.enabled &&
    (endpoint.kind === 'local' || endpoint.kind === 'openai-compatible') &&
    Boolean(endpoint.baseUrl?.trim())
  );
}

function classifyNativeApiProviderError(
  error: unknown,
  input: { attemptTimedOut: boolean; attemptTimeoutMs?: number }
) {
  if (input.attemptTimedOut) {
    const timeoutMs = input.attemptTimeoutMs ?? 0;
    return {
      reason: 'provider_route_attempt_timeout',
      message: `Provider route attempt timed out after ${timeoutMs}ms.`,
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/required_tool_call_missing/i.test(message)) {
    return { reason: 'tool_required_missing', message };
  }
  if (
    /ECONNREFUSED|Unable to connect|ENOTFOUND|EHOSTUNREACH|network error|fetch failed/i.test(
      message
    )
  ) {
    return { reason: 'endpoint_unreachable', message };
  }
  if (/loading model|unavailable_error|temporarily unavailable/i.test(message)) {
    return { reason: 'transient_model_loading', message };
  }
  if (/abort/i.test(message)) {
    return { reason: 'provider_aborted', message };
  }
  return { reason: 'provider_error', message };
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

type NativeApiRuntimeTodoSnapshot = {
  seq: number;
  title: string;
  taskType: string;
  status: string;
  procedureId?: string | null;
};

async function buildTodoSnapshotHistory(runId: string): Promise<{
  snapshotItem: Extract<NativeApiHistoryItem, { type: 'user' }> | null;
  currentTodoItem: Extract<NativeApiHistoryItem, { type: 'user' }> | null;
  currentTodo: NativeApiRuntimeTodoSnapshot | null;
} | null> {
  try {
    const todos = await repo.listTaskRunTodosForRun(runId);
    if (todos.length === 0) return null;
    const lines = todos
      .sort((a, b) => a.seq - b.seq)
      .map((todo) => {
        const title = todo.title.replace(/\s+/g, ' ').trim();
        return `seq=${todo.seq} status=${todo.status} taskType=${todo.taskType} procedureId=${todo.procedureId ?? 'none'} title=${title}`;
      });
    const currentTodo =
      todos
        .filter((todo) => todo.status === 'running')
        .sort((a, b) => a.seq - b.seq)
        .map((todo) => ({
          seq: todo.seq,
          title: todo.title,
          taskType: todo.taskType,
          status: todo.status,
          procedureId: todo.procedureId,
        }))[0] ?? null;
    return {
      snapshotItem: {
        type: 'user',
        source: 'todo',
        content: ['[Native API Runner Todo Snapshot]', ...lines].join('\n'),
      },
      currentTodoItem: currentTodo
        ? {
            type: 'user',
            source: 'todo',
            content: renderRuntimeTodoContext(currentTodo),
          }
        : null,
      currentTodo,
    };
  } catch {
    return null;
  }
}

function renderRuntimeTodoContext(currentTodo: NativeApiRuntimeTodoSnapshot) {
  return [
    '[Current Native API Runner Todo]',
    `seq=${currentTodo.seq}`,
    `title=${currentTodo.title}`,
    `taskType=${currentTodo.taskType}`,
    `procedureId=${currentTodo.procedureId ?? 'none'}`,
    `status=${currentTodo.status}`,
  ].join('\n');
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

function createAttemptTimeoutSignal(parent: AbortSignal, timeoutMs?: number) {
  const controller = new AbortController();
  let timedOut = false;
  const effectiveTimeoutMs =
    Number.isFinite(timeoutMs) && (timeoutMs ?? 0) > 0 ? Math.floor(timeoutMs ?? 0) : 0;
  const timeout =
    effectiveTimeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          controller.abort(
            new Error(
              `NativeApiRunner provider route attempt timed out after ${effectiveTimeoutMs}ms`
            )
          );
        }, effectiveTimeoutMs)
      : null;
  const abortFromParent = () => controller.abort(parent.reason);
  if (parent.aborted) {
    abortFromParent();
  } else {
    parent.addEventListener('abort', abortFromParent, { once: true });
  }
  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    dispose: () => {
      if (timeout) clearTimeout(timeout);
      parent.removeEventListener('abort', abortFromParent);
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
