import { type McpToolSummary, mcpClientManager } from '../../mcp/mcp-client-manager';
import {
  executeWorkerTool,
  type WorkerToolDispatchInput,
  type WorkerToolDispatchResult,
} from '../../worker-tools/dispatcher';
import type { WorkerToolResult } from '../../worker-tools/types';
import type { AgentRuntimeSink } from '../types';
import {
  classifyNativeToolRuntimeTool,
  isNativeToolRuntimeToolName,
  type NativeToolRuntimeToolName,
} from './native-tool-definitions';
import { projectWorkerToolResultForProvider } from './native-tool-result-projection';

export type NativeToolRuntimeToolCall = {
  id: string;
  name: string;
  arguments?: Record<string, unknown>;
};

export type NativeToolExecutionContext = Omit<WorkerToolDispatchInput, 'toolName' | 'args'> & {
  sink?: AgentRuntimeSink;
};

export type NativeToolExecutionResult =
  | {
      kind: 'worker';
      callId: string;
      toolName: NativeToolRuntimeToolName;
      dispatch: WorkerToolDispatchResult;
      providerOutput: string;
    }
  | {
      kind: 'todo_control';
      callId: string;
      toolName: 'todo_list';
      arguments: Record<string, unknown>;
      providerOutput: string;
    }
  | {
      kind: 'terminal';
      callId: string;
      toolName: 'finalize_answer';
      message: string;
      providerOutput: string;
    };

export async function executeNativeToolCall(input: {
  toolCall: NativeToolRuntimeToolCall;
  context: NativeToolExecutionContext;
}): Promise<NativeToolExecutionResult> {
  const { toolCall, context } = input;
  if (!isNativeToolRuntimeToolName(toolCall.name)) {
    throw new Error(`Unsupported native tool runtime tool: ${toolCall.name}`);
  }

  const args = toolCall.arguments ?? {};
  const classification = classifyNativeToolRuntimeTool(toolCall.name);

  if (classification.kind === 'terminal') {
    const message = typeof args.message === 'string' ? args.message : '';
    return {
      kind: 'terminal',
      callId: toolCall.id,
      toolName: 'finalize_answer',
      message,
      providerOutput: message || 'finalize_answer received.',
    };
  }

  if (classification.kind === 'todo_control') {
    return {
      kind: 'todo_control',
      callId: toolCall.id,
      toolName: 'todo_list',
      arguments: args,
      providerOutput:
        'todo_list control call received. NativeToolTurnLoop must apply the existing Todo contract before continuing.',
    };
  }

  if (classification.kind === 'context_still') {
    return executeContextStillToolCall({
      callId: toolCall.id,
      args,
      context,
      mcpToolName: classification.mcpToolName,
    });
  }

  await context.sink?.emit({
    type: 'tool_call_started',
    message: `[NativeToolRuntime] ${classification.workerToolName} started.`,
    payload: {
      callId: toolCall.id,
      toolName: classification.workerToolName,
      arguments: args,
    },
  });

  const dispatch = await executeWorkerTool({
    toolName: classification.workerToolName,
    args,
    repoRoot: context.repoRoot,
    taskId: context.taskId,
    safetyPolicy: context.safetyPolicy,
    readFiles: context.readFiles,
    toolContext: context.toolContext,
  });

  await context.sink?.emit({
    type: 'tool_call_finished',
    message: `[NativeToolRuntime] ${classification.workerToolName} ${
      dispatch.result.ok ? 'finished' : 'failed'
    }.`,
    payload: {
      callId: toolCall.id,
      toolName: classification.workerToolName,
      status: dispatch.result.ok ? 'completed' : 'failed',
      ok: dispatch.result.ok,
      result: dispatch.result.payload,
      error: dispatch.result.error,
      readFilesChanged: dispatch.readFilesChanged,
    },
  });

  return {
    kind: 'worker',
    callId: toolCall.id,
    toolName: toolCall.name,
    dispatch,
    providerOutput: formatProviderOutput({
      toolName: classification.workerToolName,
      arguments: args,
      result: dispatch.result,
    }),
  };
}

async function executeContextStillToolCall(input: {
  callId: string;
  args: Record<string, unknown>;
  context: NativeToolExecutionContext;
  mcpToolName: 'context_compile';
}): Promise<NativeToolExecutionResult> {
  const eventToolName = `context-still.${input.mcpToolName}`;
  await input.context.sink?.emit({
    type: 'tool_call_started',
    message: `[NativeToolRuntime] ${eventToolName} started.`,
    payload: {
      callId: input.callId,
      toolName: eventToolName,
      mcpTool: input.mcpToolName,
      arguments: input.args,
    },
  });

  const goal = typeof input.args.goal === 'string' ? input.args.goal.trim() : '';
  const tool = goal ? await resolveContextStillTool(input.mcpToolName) : null;
  const dispatch = !goal
    ? buildInvalidContextCompileArgsDispatch(input.mcpToolName)
    : tool
      ? await executeWorkerTool({
          toolName: 'mcp_call_tool',
          args: {
            serverId: tool.serverId,
            toolName: input.mcpToolName,
            arguments: input.args,
          },
          repoRoot: input.context.repoRoot,
          taskId: input.context.taskId,
          safetyPolicy: input.context.safetyPolicy,
          readFiles: input.context.readFiles,
          toolContext: input.context.toolContext,
        })
      : buildMissingContextStillToolDispatch(input.mcpToolName);

  await input.context.sink?.emit({
    type: 'tool_call_finished',
    message: `[NativeToolRuntime] ${eventToolName} ${dispatch.result.ok ? 'finished' : 'failed'}.`,
    payload: {
      callId: input.callId,
      toolName: eventToolName,
      mcpTool: input.mcpToolName,
      serverId: tool?.serverId,
      status: dispatch.result.ok ? 'completed' : 'failed',
      ok: dispatch.result.ok,
      result: dispatch.result.payload,
      error: dispatch.result.error,
    },
  });

  return {
    kind: 'worker',
    callId: input.callId,
    toolName: input.mcpToolName,
    dispatch,
    providerOutput: formatProviderOutput({
      toolName: eventToolName,
      arguments: input.args,
      result: dispatch.result,
    }),
  };
}

async function resolveContextStillTool(toolName: 'context_compile') {
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

function buildMissingContextStillToolDispatch(
  toolName: 'context_compile'
): WorkerToolDispatchResult {
  const now = new Date().toISOString();
  return {
    result: {
      ok: false,
      toolName: 'mcp_call_tool',
      startedAt: now,
      finishedAt: now,
      payload: {
        serverId: '',
        toolName,
      },
      error: {
        code: 'MCP_TOOL_NOT_FOUND',
        message: `contextStill MCP tool is not available: ${toolName}`,
      },
    },
    readFilesChanged: [],
  };
}

function buildInvalidContextCompileArgsDispatch(
  toolName: 'context_compile'
): WorkerToolDispatchResult {
  const now = new Date().toISOString();
  return {
    result: {
      ok: false,
      toolName: 'mcp_call_tool',
      startedAt: now,
      finishedAt: now,
      payload: {
        serverId: '',
        toolName,
      },
      error: {
        code: 'INVALID_TOOL_ARGS',
        message:
          'context_compile requires a non-empty goal after read_current_specification has been executed.',
      },
    },
    readFilesChanged: [],
  };
}

function formatProviderOutput(input: {
  toolName: string;
  arguments: Record<string, unknown>;
  result: WorkerToolResult<unknown>;
}): string {
  return projectWorkerToolResultForProvider({
    step: 0,
    toolName: input.toolName,
    arguments: input.arguments,
    result: input.result,
  });
}
