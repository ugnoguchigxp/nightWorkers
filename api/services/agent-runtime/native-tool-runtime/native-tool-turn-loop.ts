import * as repo from '../../../modules/nightworkers/nightworkers.repository';
import { estimateTokens } from '../../conversation-context/token-budget';
import { recordLlmUsage } from '../../llm-usage';
import { callProviderToolTurn } from '../../structured-llm/providers';
import {
  buildNormalizedSupervisorLlmRequest,
  providerAdapterKey,
} from '../../structured-llm/request';
import type { StructuredLlmModelTarget } from '../../structured-llm/settings';
import type { ProviderToolMessage, ProviderToolTurnResult } from '../../structured-llm/tool-calls';
import { type TodoListOperation, todoListTool } from '../../worker-tools/todo-list';
import type { WorkerToolResult } from '../../worker-tools/types';
import type { AgentRunContext, AgentRuntimeResult, AgentRuntimeSink } from '../types';
import {
  getProviderNativeToolDefinitions,
  type ProviderNativeToolDefinition,
} from './native-tool-definitions';
import { executeNativeToolCall, type NativeToolRuntimeToolCall } from './native-tool-executor';
import { projectWorkerToolResultForProvider } from './native-tool-result-projection';

const DEFAULT_MAX_NATIVE_TOOL_TURNS = 20;

export type NativeToolTurnLoopResult =
  | {
      type: 'supported';
      result: AgentRuntimeResult;
    }
  | {
      type: 'unsupported';
      reason: string;
    };

export type NativeToolTurnProvider = typeof callProviderToolTurn;

export async function runNativeToolTurnLoop(input: {
  context: AgentRunContext;
  sink: AgentRuntimeSink;
  routeOverride?: StructuredLlmModelTarget | null;
  signal?: AbortSignal;
  providerTurn?: NativeToolTurnProvider;
  maxTurns?: number;
}): Promise<NativeToolTurnLoopResult> {
  const { context, sink } = input;
  const systemPrompt = buildNativeToolRuntimeSystemPrompt(context);
  const userPrompt = context.compiledPrompt;
  const normalizedRequest = buildNormalizedSupervisorLlmRequest({
    systemPrompt,
    userPrompt,
    label: 'native_tool_runtime',
    role: 'implementation',
    routeOverride: input.routeOverride,
  });
  const provider = providerAdapterKey(normalizedRequest.providerId);
  const tools = getProviderNativeToolDefinitions().map(toProviderToolDefinition);
  const messages: ProviderToolMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
  let readFiles: string[] = [];
  const providerTurn = input.providerTurn ?? callProviderToolTurn;
  const timeout = createTimeoutSignal(input.signal, context.timeoutSeconds);
  let specificationRead = false;

  try {
    for (let turn = 1; turn <= (input.maxTurns ?? DEFAULT_MAX_NATIVE_TOOL_TURNS); turn += 1) {
      if (await isRunCancelled(context.runId, input.signal)) {
        return buildCancelledResult();
      }
      const currentTodo = await readCurrentTodoSummary(context.runId);
      await sink.emit({
        type: 'model_response_started',
        message: `[NativeToolRuntime] provider-native tool turn ${turn} started.`,
        payload: {
          provider,
          providerEndpointId: normalizedRequest.providerEndpointId ?? null,
          model: normalizedRequest.modelOrDeployment ?? null,
          toolCount: tools.length,
          currentTodo,
        },
      });

      let providerDebug: Record<string, unknown> = {};
      const turnStartedAt = Date.now();
      let providerResult: ProviderToolTurnResult;
      try {
        const turnMessages = currentTodo
          ? [
              ...messages,
              {
                role: 'user' as const,
                content: renderCurrentTodoUserMessage(currentTodo),
              },
            ]
          : messages;
        providerResult = await providerTurn({
          provider,
          messages: turnMessages,
          tools,
          systemPrompt,
          userPrompt,
          options: {
            label: 'native_tool_runtime',
            role: 'implementation',
            routeOverride: input.routeOverride,
            timeoutMs: context.timeoutSeconds * 1000,
            taskId: context.taskId,
            runId: context.runId,
            workingDirectory: context.repoRoot,
            promptPartTokenEstimates: {
              latestUserMessageTokens:
                context.contextSnapshot.conversationContext?.usage?.latestUserMessageTokens,
              stateCardTokens: context.contextSnapshot.conversationContext?.usage?.stateCardTokens,
              userPromptTokens:
                context.contextSnapshot.conversationContext?.usage?.runtimeUserPromptTokens,
            },
            normalizedRequest,
          },
          signal: timeout.signal,
          setProviderDebug: (value) => {
            providerDebug = value;
          },
        });
      } catch (error) {
        if (await isRunCancelled(context.runId, input.signal)) {
          return buildCancelledResult();
        }
        const reason = error instanceof Error ? error.message : String(error);
        await sink.emit({
          type: 'runtime_warning',
          message: `[NativeToolRuntime] provider-native tool turn ${turn} failed: ${reason}`,
          payload: {
            code: 'NATIVE_TOOL_RUNTIME_PROVIDER_FAILED',
            severity: 'warning',
            message: reason,
          },
        });
        throw error;
      }

      if (await isRunCancelled(context.runId, input.signal)) {
        return buildCancelledResult();
      }

      if (providerResult.type === 'unsupported') {
        return {
          type: 'unsupported',
          reason: providerResult.reason,
        };
      }

      await recordNativeToolTurnUsage({
        context,
        providerResult,
        providerDebug,
        systemPrompt,
        userPrompt,
        turn,
        normalizedProvider: normalizedRequest.providerId,
        model: providerResult.model ?? normalizedRequest.modelOrDeployment ?? null,
        durationMs: Date.now() - turnStartedAt,
      });

      await sink.emit({
        type: 'model_response_finished',
        message: `[NativeToolRuntime] provider-native tool turn ${turn} finished with ${providerResult.toolCalls.length} tool call(s).`,
        payload: {
          provider,
          toolCallCount: providerResult.toolCalls.length,
          model: providerResult.model ?? normalizedRequest.modelOrDeployment ?? null,
          providerDebug,
        },
      });

      if (providerResult.toolCalls.length === 0) {
        if (turn === 1) {
          return {
            type: 'unsupported',
            reason: 'Provider returned no native tool calls on the first native tool runtime turn.',
          };
        }
        return buildTextOnlyResult(providerResult.content);
      }

      messages.push({
        role: 'assistant',
        content: providerResult.content,
        toolCalls: providerResult.toolCalls,
      });

      for (const toolCall of providerResult.toolCalls) {
        if (await isRunCancelled(context.runId, input.signal)) {
          return buildCancelledResult();
        }
        if (toolCall.name === 'context_compile' && !specificationRead) {
          const blockedResult = buildContextCompileBeforeSpecResult();
          await sink.emit({
            type: 'tool_call_started',
            message: '[NativeToolRuntime] context-still.context_compile started.',
            payload: {
              callId: toolCall.id,
              toolName: 'context-still.context_compile',
              mcpTool: 'context_compile',
              arguments: toolCall.arguments ?? {},
            },
          });
          await sink.emit({
            type: 'tool_call_finished',
            message: '[NativeToolRuntime] context-still.context_compile failed.',
            payload: {
              callId: toolCall.id,
              toolName: 'context-still.context_compile',
              mcpTool: 'context_compile',
              status: 'failed',
              ok: false,
              result: blockedResult.payload,
              error: blockedResult.error,
            },
          });
          messages.push({
            role: 'tool',
            toolCallId: toolCall.id,
            content: projectWorkerToolResultForProvider({
              step: turn,
              toolName: 'context-still.context_compile',
              arguments: toolCall.arguments ?? {},
              result: blockedResult,
            }),
          });
          continue;
        }
        const execution = await executeNativeToolCall({
          toolCall,
          context: {
            repoRoot: context.repoRoot,
            taskId: context.taskId,
            safetyPolicy: context.safetyPolicy,
            readFiles,
            sink,
          },
        });

        if (execution.kind === 'worker') {
          if (toolCall.name === 'read_current_specification' && execution.dispatch.result.ok) {
            specificationRead = true;
          }
          readFiles = [...new Set([...readFiles, ...(execution.dispatch.readFilesChanged ?? [])])];
          messages.push({
            role: 'tool',
            toolCallId: execution.callId,
            content: execution.providerOutput,
          });
          if (await isRunCancelled(context.runId, input.signal)) {
            return buildCancelledResult();
          }
          continue;
        }

        if (execution.kind === 'todo_control') {
          const todoResult = await applyNativeTodoControl({
            context,
            sink,
            callId: execution.callId,
            args: execution.arguments,
          });
          messages.push({
            role: 'tool',
            toolCallId: execution.callId,
            content: projectWorkerToolResultForProvider({
              step: turn,
              toolName: 'todo_list',
              arguments: execution.arguments,
              result: todoResult,
            }),
          });
          if (await isRunCancelled(context.runId, input.signal)) {
            return buildCancelledResult();
          }
          continue;
        }

        const openTodos = await listOpenTodos(context.runId);
        if (openTodos.length > 0) {
          messages.push({
            role: 'tool',
            toolCallId: execution.callId,
            content: JSON.stringify({
              ok: false,
              toolName: 'finalize_answer',
              error: {
                code: 'OPEN_TODOS_REMAIN',
                message:
                  'finalize_answer is blocked because pending or running Todos remain. Close Todo progress with todo_list before finalizing.',
                openTodoSeqs: openTodos.map((todo) => todo.seq),
              },
            }),
          });
          continue;
        }

        const finalReport = execution.message || 'Native tool runtime completed.';
        return {
          type: 'supported',
          result: {
            terminalState: 'completed',
            summary: firstLine(finalReport),
            finalReport,
            stoppedBy: 'decision',
            riskLevel: 'medium',
          },
        };
      }
    }
  } finally {
    timeout.dispose();
  }

  return {
    type: 'supported',
    result: {
      terminalState: 'needs_human',
      summary: 'Native tool runtime reached its maximum provider-native tool turns.',
      finalReport:
        'Native tool runtime が最大 tool turn 数に到達しました。未完了の作業または停止条件を確認してください。',
      stoppedBy: 'budget',
      riskLevel: 'high',
    },
  };
}

function buildNativeToolRuntimeSystemPrompt(context: AgentRunContext) {
  return [
    'あなたは NightWorkers の native/API lane runtime です。',
    'provider-native tool calls を使って、リポジトリ作業を worker tool 経由で実行してください。',
    '説明だけで tool 実行の代替にしないでください。必要な確認、編集、検証は必ず tool call として行います。',
    '進捗 Todo が必要な場合は todo_list を使い、作業完了時は open Todo を残さず finalize_answer を呼びます。',
    'リポジトリの読み書きは登録済み Project の repo root を基準にしてください。',
    'initial_instructions gate Todo は runtime が自動実行します。context_compile Todo は provider-native tool の context_compile で実行します。',
    'context_compile は必ず read_current_specification で仕様書を読んで、作業対象・非対象・実装方針を理解した後に呼びます。空 {} や空 goal では呼びません。',
    'context_compile の goal には仕様タイトル/要約、実装対象、非対象、次に確認すべきリポジトリ領域を具体的に含めます。',
    'ファイル構成確認は list_dir/read_file/search_files を使い、run_verification は typecheck/build/test など検証専用にしてください。',
    'ファイル作成・編集は apply_patch または replace_content だけで行います。run_verification や shell の cat/heredoc/mkdir/redirection で作成しないでください。',
    '新規ファイルを apply_patch で作る場合は `*** Begin Patch`、`*** Add File: path`、各内容行の `+`、`*** End Patch` 形式を使ってください。',
    'apply_patch が失敗したら stderr と evidence を読み、同じ patch や shell write を繰り返さず corrected apply_patch を作ってください。',
    `repoRoot: ${context.repoRoot}`,
  ].join('\n');
}

function toProviderToolDefinition(tool: ProviderNativeToolDefinition) {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  };
}

async function applyNativeTodoControl(input: {
  context: AgentRunContext;
  sink: AgentRuntimeSink;
  callId: string;
  args: Record<string, unknown>;
}): Promise<WorkerToolResult<unknown>> {
  const operation = input.args.operation;
  await input.sink.emit({
    type: 'tool_call_started',
    message: '[NativeToolRuntime] todo_list started.',
    payload: {
      callId: input.callId,
      toolName: 'todo_list',
      arguments: input.args,
    },
  });

  const result = isNativeTodoMutationOperation(operation)
    ? await todoListTool({
        runId: input.context.runId,
        operation,
        seq: typeof input.args.seq === 'number' ? input.args.seq : undefined,
        todos: Array.isArray(input.args.todos) ? (input.args.todos as never) : undefined,
        startFirst: typeof input.args.startFirst === 'boolean' ? input.args.startFirst : undefined,
      })
    : buildInvalidTodoControlResult(operation);

  await input.sink.emit({
    type: 'tool_call_finished',
    message: `[NativeToolRuntime] todo_list ${result.ok ? 'finished' : 'failed'}.`,
    payload: {
      callId: input.callId,
      toolName: 'todo_list',
      status: result.ok ? 'completed' : 'failed',
      ok: result.ok,
      result: result.payload,
      error: result.error,
    },
  });

  return result as WorkerToolResult<unknown>;
}

function isNativeTodoMutationOperation(
  value: unknown
): value is Exclude<TodoListOperation, 'list'> {
  return (
    value === 'replace' ||
    value === 'start' ||
    value === 'done' ||
    value === 'block' ||
    value === 'fail'
  );
}

function buildInvalidTodoControlResult(operation: unknown): WorkerToolResult<unknown> {
  const now = new Date().toISOString();
  return {
    ok: false,
    toolName: 'todo_list',
    startedAt: now,
    finishedAt: now,
    payload: {
      operation,
    },
    error: {
      code: 'INVALID_TOOL_ARGS',
      message:
        'todo_list operation must be one of replace/start/done/block/fail in native tool runtime.',
    },
  };
}

async function listOpenTodos(runId: string) {
  const todos = await repo.listTaskRunTodosForRun(runId);
  return todos.filter((todo) => todo.status === 'pending' || todo.status === 'running');
}

async function readCurrentTodoSummary(runId: string) {
  const todos = await repo.listTaskRunTodosForRun(runId);
  const currentTodo = todos
    .filter((todo) => todo.status === 'running')
    .sort((a, b) => a.seq - b.seq)[0];
  if (!currentTodo) return null;
  return {
    seq: currentTodo.seq,
    title: currentTodo.title,
    taskType: currentTodo.taskType,
    procedureId: currentTodo.procedureId ?? null,
    status: currentTodo.status,
  };
}

function renderCurrentTodoUserMessage(
  currentTodo: NonNullable<Awaited<ReturnType<typeof readCurrentTodoSummary>>>
) {
  return [
    '[Current Native Runtime Todo]',
    `seq=${currentTodo.seq}`,
    `title=${currentTodo.title}`,
    `taskType=${currentTodo.taskType}`,
    `procedureId=${currentTodo.procedureId ?? 'none'}`,
    `status=${currentTodo.status}`,
    currentTodo.procedureId === 'contextstill.context_compile'
      ? 'この Todo では、仕様未読ならまず read_current_specification を呼び、仕様を理解した後に具体的な goal 付きで context_compile を呼びます。context_compile を空入力で呼ばないでください。'
      : 'この Todo に対応する tool action だけを実行してください。実装 Todo では apply_patch/replace_content、確認では list_dir/read_file、検証 Todo では run_verification を使います。',
  ].join('\n');
}

async function isRunCancelled(runId: string, signal?: AbortSignal) {
  if (signal?.aborted) return true;
  try {
    const run = await repo.getTaskRun(runId);
    return run?.status === 'cancelled';
  } catch {
    return false;
  }
}

function buildCancelledResult(): NativeToolTurnLoopResult {
  return {
    type: 'supported',
    result: {
      terminalState: 'cancelled',
      summary: 'Run stop requested by user.',
      finalReport: 'Run stop requested by user.',
      stoppedBy: 'cancelled',
      riskLevel: 'medium',
    },
  };
}

function buildContextCompileBeforeSpecResult(): WorkerToolResult<unknown> {
  const now = new Date().toISOString();
  return {
    ok: false,
    toolName: 'context_compile',
    startedAt: now,
    finishedAt: now,
    payload: {
      requiredFirstTool: 'read_current_specification',
    },
    error: {
      code: 'SPECIFICATION_REQUIRED',
      message:
        'context_compile is blocked until read_current_specification has succeeded in this native tool runtime run.',
    },
  };
}

function buildTextOnlyResult(content: string): NativeToolTurnLoopResult {
  const finalReport = content.trim();
  if (!finalReport) {
    return {
      type: 'supported',
      result: {
        terminalState: 'needs_human',
        summary: 'Provider returned no native tool calls and no final text.',
        finalReport: 'Provider returned no native tool calls and no final text.',
        stoppedBy: 'missing_tool_call',
        riskLevel: 'high',
      },
    };
  }
  return {
    type: 'supported',
    result: {
      terminalState: 'completed',
      summary: firstLine(finalReport),
      finalReport,
      stoppedBy: 'decision',
      riskLevel: 'medium',
    },
  };
}

async function recordNativeToolTurnUsage(input: {
  context: AgentRunContext;
  providerResult: Extract<ProviderToolTurnResult, { type: 'supported' }>;
  providerDebug: Record<string, unknown>;
  systemPrompt: string;
  userPrompt: string;
  turn: number;
  normalizedProvider: string;
  model: string | null;
  durationMs: number;
}) {
  await recordLlmUsage({
    taskId: input.context.taskId,
    runId: input.context.runId,
    callId: `${input.context.runId}:native-tool-turn:${input.turn}`,
    provider: input.normalizedProvider,
    model: input.model,
    label: 'native_tool_runtime',
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
      mode: 'provider_native_tools',
      toolCallCount: input.providerResult.toolCalls.length,
      providerDebug: input.providerDebug,
    },
  });
}

function firstLine(value: string) {
  return (
    value
      .split(/\r?\n/)
      .find((line) => line.trim())
      ?.trim() || value.trim()
  );
}

function createTimeoutSignal(parent: AbortSignal | undefined, timeoutSeconds: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error(`Native tool runtime timed out after ${timeoutSeconds}s`));
  }, Math.max(1, timeoutSeconds) * 1000);
  const abortFromParent = () => controller.abort(parent?.reason);
  if (parent?.aborted) {
    abortFromParent();
  } else {
    parent?.addEventListener('abort', abortFromParent, { once: true });
  }
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timeout);
      parent?.removeEventListener('abort', abortFromParent);
    },
  };
}

export type { NativeToolRuntimeToolCall };
