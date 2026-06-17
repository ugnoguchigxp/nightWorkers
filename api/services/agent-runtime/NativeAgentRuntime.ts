import { toDeepRecord } from '../../../shared/json-record';
import { appendSupervisorTrace } from '../../lib/logger';
import * as repo from '../../modules/nightworkers/nightworkers.repository';
import { runAgentHooks } from '../hooks/hooks-runner';
import type { AgentHookInput, AgentHookRunEvent } from '../hooks/types';
import { type McpToolSummary, mcpClientManager } from '../mcp/mcp-client-manager';
import { normalizeStructuredLlmModelTarget } from '../structured-llm/selection';
import type { StructuredLlmRoutePolicy } from '../structured-llm/types';
import { runSupervisorLoop } from '../supervisor/supervisor-loop';
import { executeWorkerTool } from '../worker-tools/dispatcher';
import type { WorkerToolResult } from '../worker-tools/types';
import { runNativeToolTurnLoop } from './native-tool-runtime/native-tool-turn-loop';
import type {
  AgentRunContext,
  AgentRuntime,
  AgentRuntimeEvent,
  AgentRuntimeResult,
  AgentRuntimeSink,
} from './types';

const DEFAULT_RESULT: AgentRuntimeResult = {
  terminalState: 'failed',
  summary: 'Runtime execution failed.',
  finalReport: '',
  stoppedBy: 'llm_error',
  riskLevel: 'high',
};

type NativeContextStillGate = {
  procedureId: string;
  mcpTool: 'initial_instructions';
  eventToolName: 'context-still.initial_instructions';
  arguments: (context: AgentRunContext) => Record<string, unknown>;
};

const NATIVE_CONTEXT_STILL_GATES: NativeContextStillGate[] = [
  {
    procedureId: 'contextstill.initial_instructions',
    mcpTool: 'initial_instructions',
    eventToolName: 'context-still.initial_instructions',
    arguments: () => ({}),
  },
];

export class NativeAgentRuntime implements AgentRuntime {
  readonly kind = 'native-local' as const;
  private cancelledRunIds = new Set<string>();

  async start(
    context: AgentRunContext,
    sink: AgentRuntimeSink,
    signal?: AbortSignal
  ): Promise<AgentRuntimeResult> {
    const logs: string[] = [];
    const appendLog = (line: string) => {
      logs.push(line);
    };
    const emit = async (event: Parameters<AgentRuntimeSink['emit']>[0]) => {
      appendLog(event.message);
      const currentTodoData = await readCurrentTodoEventData(context.runId);
      const payload =
        event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
          ? { ...currentTodoData, ...(event.payload as Record<string, unknown>) }
          : { ...currentTodoData, payload: event.payload };
      const enrichedEvent = {
        ...event,
        payload: Object.keys(currentTodoData).length > 0 ? payload : event.payload,
      } as AgentRuntimeEvent;
      await sink.emit(enrichedEvent);
    };
    const emitHookEvent = async (event: AgentHookRunEvent) => {
      await repo.createRunEvent(
        {
          version: 1,
          runId: context.runId,
          taskId: context.taskId,
          timestamp: new Date().toISOString(),
          type: event.type,
          severity: event.severity,
          actor: 'system',
          message: event.message,
          data: event.data,
        },
        { payloadJson: event.data }
      );
    };
    let sessionHookOpened = false;
    let sessionHookClosed = false;
    const runSessionEndHook = async (result?: AgentRuntimeResult) => {
      if (!sessionHookOpened || sessionHookClosed) return;
      sessionHookClosed = true;
      await runAgentHooks({
        input: buildSessionHookInput('SessionEnd', context, result),
        repoRoot: context.repoRoot,
        onEvent: emitHookEvent,
      });
    };

    try {
      if (signal?.aborted || this.cancelledRunIds.has(context.runId)) {
        return this.toCancelled(logs.join('\n'));
      }

      await emit({
        type: 'runtime_started',
        message: `[System] Native Local Worker started execution in workspace: ${context.repoRoot}`,
      });

      await runAgentHooks({
        input: buildSessionHookInput('SessionStart', context),
        repoRoot: context.repoRoot,
        onEvent: emitHookEvent,
      });
      sessionHookOpened = true;

      const promptHook = await runAgentHooks({
        input: {
          ...buildBaseHookInput('UserPromptSubmit', context),
          hook_event_name: 'UserPromptSubmit',
          prompt: context.latestUserMessage || context.compiledPrompt,
        },
        repoRoot: context.repoRoot,
        onEvent: emitHookEvent,
      });
      if (promptHook.decision === 'block') {
        const finalReport = promptHook.reason || 'User prompt was blocked by an agent hook.';
        await runSessionEndHook();
        return {
          terminalState: 'blocked',
          summary: finalReport,
          finalReport,
          stoppedBy: 'hook',
          riskLevel: 'medium',
          logContent: logs.join('\n'),
        };
      }

      const gateFailure = await runNativeContextStillGates(context, emit);
      if (await isRunCancelled(context.runId, this.cancelledRunIds, signal)) {
        const result = this.toCancelled(logs.join('\n'));
        await runSessionEndHook(result);
        return result;
      }
      if (gateFailure) {
        await runSessionEndHook();
        return {
          terminalState: 'needs_human',
          summary: gateFailure.summary,
          finalReport: gateFailure.finalReport,
          stoppedBy: 'tool_failure',
          riskLevel: 'high',
          logContent: logs.join('\n'),
        };
      }

      const llmRouteOverride = readRuntimeLlmRouteOverride(context);
      const llmRoutePolicy = readStructuredLlmRoutePolicy(context);
      if (isExperimentalNativeToolRuntimeEnabled(context)) {
        appendSupervisorTrace('native_tool_runtime_selected', {
          runId: context.runId,
          taskId: context.taskId,
          repoRoot: context.repoRoot,
          routeOverride: llmRouteOverride,
        });
        await emit({
          type: 'runtime_warning',
          message: '[NativeToolRuntime] Experimental native tool runtime selected.',
          payload: {
            code: 'NATIVE_TOOL_RUNTIME_SELECTED',
            severity: 'info',
            message: 'Experimental native tool runtime selected for this native-local run.',
          },
        });
        await emit({
          type: 'turn_started',
          message: '[System] Handing control over to Native Tool Runtime...',
        });
        let nativeToolResult: Awaited<ReturnType<typeof runNativeToolTurnLoop>>;
        try {
          nativeToolResult = await runNativeToolTurnLoop({
            context,
            sink: { emit },
            signal,
            routeOverride: llmRouteOverride,
          });
        } catch (error) {
          if (await isRunCancelled(context.runId, this.cancelledRunIds, signal)) {
            nativeToolResult = {
              type: 'supported',
              result: this.toCancelled(logs.join('\n')),
            };
          } else {
            const reason = error instanceof Error ? error.message : String(error);
            nativeToolResult = {
              type: 'unsupported',
              reason: `Native tool runtime failed before completion: ${reason}`,
            };
          }
        }

        if (nativeToolResult.type === 'supported') {
          const result: AgentRuntimeResult = {
            ...nativeToolResult.result,
            terminalState: this.cancelledRunIds.has(context.runId)
              ? 'cancelled'
              : nativeToolResult.result.terminalState,
            stoppedBy: this.cancelledRunIds.has(context.runId)
              ? 'cancelled'
              : nativeToolResult.result.stoppedBy,
            logContent: logs.join('\n'),
          };

          await emit({
            type: 'runtime_finished',
            message: `[System] Native Local Worker finished with terminalState=${result.terminalState}.`,
            payload: {
              terminalState: result.terminalState,
              finalReport: result.finalReport,
              summary: result.summary,
              stoppedBy: result.stoppedBy,
              runtime: 'native_tool_runtime',
            },
          });

          await runSessionEndHook(result);
          return result;
        }

        if (await isRunCancelled(context.runId, this.cancelledRunIds, signal)) {
          const result = this.toCancelled(logs.join('\n'));
          await emit({
            type: 'runtime_finished',
            message: `[System] Native Local Worker finished with terminalState=${result.terminalState}.`,
            payload: {
              terminalState: result.terminalState,
              finalReport: result.finalReport,
              summary: result.summary,
              stoppedBy: result.stoppedBy,
              runtime: 'native_tool_runtime',
            },
          });
          await runSessionEndHook(result);
          return result;
        }

        appendSupervisorTrace('native_tool_runtime_fallback', {
          runId: context.runId,
          taskId: context.taskId,
          reason: nativeToolResult.reason,
        });
        await emit({
          type: 'runtime_warning',
          message: `[NativeToolRuntime] Falling back to Supervisor Loop: ${nativeToolResult.reason}`,
          payload: {
            code: 'NATIVE_TOOL_RUNTIME_UNSUPPORTED',
            severity: 'warning',
            message: nativeToolResult.reason,
          },
        });
      }

      await emit({
        type: 'turn_started',
        message: '[System] Handing control over to Supervisor Loop...',
      });
      const supervisorResult = await runSupervisorLoop({
        runId: context.runId,
        taskId: context.taskId,
        repositoryId: context.repositoryId,
        repoRoot: context.repoRoot,
        prompt: context.compiledPrompt,
        timeoutSeconds: context.timeoutSeconds,
        latestUserMessage: context.latestUserMessage,
        promptPartTokenEstimates: {
          latestUserMessageTokens:
            context.contextSnapshot.conversationContext?.usage?.latestUserMessageTokens,
          stateCardTokens: context.contextSnapshot.conversationContext?.usage?.stateCardTokens,
          userPromptTokens:
            context.contextSnapshot.conversationContext?.usage?.runtimeUserPromptTokens,
        },
        todoPlan: context.todoPlan,
        currentTodo: context.currentTodo,
        llmRouteOverride,
        llmRoutePolicy,
        safetyPolicy: context.safetyPolicy,
      });

      const terminalState = this.cancelledRunIds.has(context.runId)
        ? 'cancelled'
        : supervisorResult.terminalState;
      const stoppedBy = this.cancelledRunIds.has(context.runId)
        ? 'cancelled'
        : supervisorResult.stoppedBy;
      const result: AgentRuntimeResult = {
        terminalState,
        summary: supervisorResult.summary,
        finalReport: supervisorResult.finalReport,
        stoppedBy,
        riskLevel: supervisorResult.riskLevel,
        logContent: logs.join('\n'),
      };

      await emit({
        type: 'runtime_finished',
        message: `[System] Native Local Worker finished with terminalState=${result.terminalState}.`,
        payload: {
          terminalState: result.terminalState,
          finalReport: result.finalReport,
          summary: result.summary,
          stoppedBy: result.stoppedBy,
        },
      });

      await runSessionEndHook(result);

      return result;
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : String(toDeepRecord(err).message || err);
      const message = `[System Error] Native Local Worker failed: ${errorMessage || 'Unknown error'}`;
      await emit({
        type: 'runtime_error',
        message,
        payload: {
          error: errorMessage,
        },
      });
      try {
        await runSessionEndHook();
      } catch (hookErr) {
        const hookErrorMessage =
          hookErr instanceof Error
            ? hookErr.message
            : String(toDeepRecord(hookErr).message || hookErr);
        appendLog(
          `[System] SessionEnd hook failed while handling runtime error: ${hookErrorMessage}`
        );
      }
      logs.push(message);
      return {
        ...DEFAULT_RESULT,
        summary: errorMessage ? `Runtime failed: ${errorMessage}` : DEFAULT_RESULT.summary,
        logContent: logs.join('\n'),
      };
    }
  }

  async stop(runId: string): Promise<void> {
    this.cancelledRunIds.add(runId);
  }

  private toCancelled(logContent: string): AgentRuntimeResult {
    return {
      terminalState: 'cancelled',
      summary: 'Runtime execution cancelled.',
      finalReport: 'Runtime execution cancelled.',
      stoppedBy: 'cancelled',
      riskLevel: 'medium',
      logContent,
    };
  }
}

async function runNativeContextStillGates(
  context: AgentRunContext,
  emit: (event: AgentRuntimeEvent) => Promise<void>
): Promise<{ summary: string; finalReport: string } | null> {
  if (!hasContextStillGate(context)) return null;

  for (const gate of NATIVE_CONTEXT_STILL_GATES) {
    const currentTodo = await readCurrentTodo(context.runId);
    if (!currentTodo || currentTodo.procedureId !== gate.procedureId) continue;

    const tool = await resolveContextStillTool(gate.mcpTool);
    if (!tool) {
      return {
        summary: `contextStill MCP tool is not available: ${gate.mcpTool}`,
        finalReport: `contextStill MCP gate を実行できません。MCP server に ${gate.mcpTool} が見つかりません。`,
      };
    }

    await emit({
      type: 'tool_call_started',
      message: `[MCP] ${gate.eventToolName} started.`,
      payload: {
        toolName: gate.eventToolName,
        mcpServer: tool.serverName,
        mcpTool: gate.mcpTool,
        serverId: tool.serverId,
        todoId: currentTodo.id,
        todoSeq: currentTodo.seq,
      },
    });

    const dispatch = await executeWorkerTool({
      toolName: 'mcp_call_tool',
      args: {
        serverId: tool.serverId,
        toolName: gate.mcpTool,
        arguments: gate.arguments(context),
      },
      repoRoot: context.repoRoot,
      taskId: context.taskId,
      safetyPolicy: context.safetyPolicy,
      readFiles: [],
    });
    const result = dispatch.result as WorkerToolResult<unknown>;
    await emit({
      type: 'tool_call_finished',
      message: `[MCP] ${gate.eventToolName} ${result.ok ? 'finished' : 'failed'}.`,
      payload: {
        toolName: gate.eventToolName,
        mcpServer: tool.serverName,
        mcpTool: gate.mcpTool,
        serverId: tool.serverId,
        status: result.ok ? 'completed' : 'failed',
        ok: result.ok,
        todoId: currentTodo.id,
        todoSeq: currentTodo.seq,
        result: result.payload,
        error: result.error,
      },
    });

    if (!result.ok) {
      const message =
        result.error?.message || `contextStill MCP tool failed: ${gate.eventToolName}`;
      return {
        summary: message,
        finalReport: `contextStill MCP gate の実行に失敗しました: ${message}`,
      };
    }
  }

  return null;
}

function hasContextStillGate(context: AgentRunContext) {
  const procedureIds = new Set(NATIVE_CONTEXT_STILL_GATES.map((gate) => gate.procedureId));
  if (context.currentTodo?.procedureId && procedureIds.has(context.currentTodo.procedureId)) {
    return true;
  }
  return Boolean(context.todoPlan?.some((todo) => procedureIds.has(todo.procedureId ?? '')));
}

async function readCurrentTodo(runId: string) {
  const todos = await repo.listTaskRunTodosForRun(runId);
  return todos.filter((todo) => todo.status === 'running').sort((a, b) => a.seq - b.seq)[0];
}

async function readCurrentTodoEventData(runId: string) {
  let currentTodo: Awaited<ReturnType<typeof readCurrentTodo>>;
  try {
    currentTodo = await readCurrentTodo(runId);
  } catch {
    return {};
  }
  return currentTodo
    ? {
        todoId: currentTodo.id,
        todoSeq: currentTodo.seq,
        todoTitle: currentTodo.title,
        taskType: currentTodo.taskType,
        procedureId: currentTodo.procedureId,
      }
    : {};
}

async function resolveContextStillTool(toolName: NativeContextStillGate['mcpTool']) {
  const tools = await mcpClientManager.listAvailableTools();
  return (
    tools.find((tool) => tool.name === toolName && isContextStillTool(tool)) ??
    tools.find((tool) => tool.name === toolName) ??
    null
  );
}

function isContextStillTool(tool: McpToolSummary) {
  const serverName = tool.serverName.toLowerCase();
  const prefix = tool.toolPrefix.toLowerCase();
  return (
    serverName === 'context-still' ||
    serverName === 'contextstill' ||
    prefix === 'context_still' ||
    prefix === 'contextstill'
  );
}

async function isRunCancelled(
  runId: string,
  cancelledRunIds: ReadonlySet<string>,
  signal?: AbortSignal
) {
  if (signal?.aborted || cancelledRunIds.has(runId)) return true;
  try {
    const run = await repo.getTaskRun(runId);
    return run?.status === 'cancelled';
  } catch {
    return false;
  }
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

function readStructuredLlmRoutePolicy(
  context: AgentRunContext
): StructuredLlmRoutePolicy | undefined {
  const raw = context.runtimeOptions?.structuredLlmRoutePolicy;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const disallowedProviderIds = Array.isArray(record.disallowedProviderIds)
    ? record.disallowedProviderIds.filter((value): value is 'codex' => value === 'codex')
    : undefined;
  const synthesizeFallbacksFromEnabledEndpoints =
    record.synthesizeFallbacksFromEnabledEndpoints === true;
  if (!disallowedProviderIds?.length && !synthesizeFallbacksFromEnabledEndpoints) {
    return undefined;
  }
  return {
    ...(disallowedProviderIds?.length ? { disallowedProviderIds } : {}),
    ...(synthesizeFallbacksFromEnabledEndpoints ? { synthesizeFallbacksFromEnabledEndpoints } : {}),
  };
}

function isExperimentalNativeToolRuntimeEnabled(context: AgentRunContext) {
  if (context.runtimeOptions?.experimentalNativeToolRuntime === true) return true;
  const raw = process.env.NIGHTWORKERS_EXPERIMENTAL_NATIVE_TOOL_RUNTIME;
  return raw === '1' || raw === 'true';
}

function buildBaseHookInput(
  event: AgentHookInput['hook_event_name'],
  context: AgentRunContext
): Omit<AgentHookInput, 'hook_event_name'> & {
  hook_event_name: AgentHookInput['hook_event_name'];
} {
  return {
    hook_event_name: event,
    session_id: context.taskId,
    run_id: context.runId,
    task_id: context.taskId,
    repository_id: context.repositoryId,
    cwd: context.repoRoot,
    timestamp: new Date().toISOString(),
  } as AgentHookInput;
}

function buildSessionHookInput(
  event: 'SessionStart' | 'SessionEnd',
  context: AgentRunContext,
  result?: AgentRuntimeResult
): AgentHookInput {
  return {
    ...buildBaseHookInput(event, context),
    hook_event_name: event,
    source: event === 'SessionStart' ? 'run_start' : 'run_end',
    ...(result
      ? {
          payload: {
            run_id: context.runId,
            task_id: context.taskId,
            terminal_state: result.terminalState,
            stopped_by: result.stoppedBy,
            risk_level: result.riskLevel,
            summary: result.summary,
            final_report: result.finalReport,
          },
        }
      : {}),
  };
}
