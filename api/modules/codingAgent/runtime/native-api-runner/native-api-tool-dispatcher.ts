import { mcpClientManager } from "../../../../services/mcp/mcp-client-manager";
import type { ProviderToolCall } from "../../../../services/structured-llm/tool-calls";
import { executeWorkerTool } from "../../../../services/worker-tools/dispatcher";
import {
	loadCodingAgentContextPacket,
	requiresCurrentTodo,
} from "../../context";
import { todoListTool } from "../../tools";
import type { AgentRunContext, AgentRuntimeSink } from "../types";
import { dispatchContextStillTool } from "./native-api-context-still";
import { continueWith, failedToolResult } from "./native-api-dispatch-results";
import type {
	NativeApiDispatchResult,
	NativeApiDispatchState,
} from "./native-api-dispatch-types";
import {
	type NativeApiToolResult,
	readProjectExplorationCatalogPin,
} from "./native-api-tool-history";
import { getNativeApiToolRegistration } from "./native-api-tool-registry";
import {
	capNativeApiToolResultContent,
	projectWorkerResultToNativeApiToolResult,
} from "./native-api-tool-result-projector";

export type {
	NativeApiDispatchResult,
	NativeApiDispatchState,
	NativeApiPostImportState,
} from "./native-api-dispatch-types";

export async function dispatchNativeApiToolCall(input: {
	toolCall: ProviderToolCall;
	context: AgentRunContext;
	sink: AgentRuntimeSink;
	state: NativeApiDispatchState;
}): Promise<NativeApiDispatchResult> {
	const registration = getNativeApiToolRegistration(input.toolCall.name);
	if (!registration) {
		return continueWith(
			failedToolResult("UNKNOWN_TOOL", `Unknown tool: ${input.toolCall.name}`),
			input.state,
		);
	}
	if (registration.kind === "todo_control") {
		return continueWith(await dispatchTodoToolWithLedger(input), input.state);
	}

	if (registration.kind === "context_still") {
		return dispatchContextStillTool(input);
	}

	if (registration.kind === "mcp_catalog") {
		return continueWith(await dispatchMcpCatalog(), input.state);
	}

	const workerToolName = registration.workerToolName;
	if (!workerToolName) {
		return continueWith(
			failedToolResult(
				"TOOL_NOT_DISPATCHABLE",
				`${input.toolCall.name} is not dispatchable.`,
			),
			input.state,
		);
	}
	const todoContext = await loadCodingAgentContextPacket(input.context.runId);
	if (requiresCurrentTodo(todoContext)) {
		return continueWith(
			failedToolResult(
				"CURRENT_TODO_REQUIRED",
				"Todo planが存在するため、workspace toolの実行前にcurrent Todoを開始してください。",
				{ planSummary: todoContext?.planSummary ?? null },
			),
			input.state,
		);
	}
	await input.sink.emit({
		type: "tool_call_started",
		message: `[NativeApiRunner] ${workerToolName} started.`,
		payload: {
			callId: input.toolCall.id,
			toolName: workerToolName,
			arguments: input.toolCall.arguments,
		},
	});
	const dispatch = await executeWorkerTool({
		toolName: workerToolName,
		args: input.toolCall.arguments,
		repoRoot: input.context.repoRoot,
		taskId: input.context.taskId,
		runId: input.context.runId,
		safetyPolicy: input.context.safetyPolicy,
		readFiles: input.state.readFiles,
		projectExplorationCatalogAccess: readProjectExplorationCatalogAccess(
			input.context,
		),
	});
	const result = projectWorkerResultToNativeApiToolResult(dispatch.result);
	await input.sink.emit({
		type: "tool_call_finished",
		message: `[NativeApiRunner] ${workerToolName} ${dispatch.result.ok ? "finished" : "failed"}.`,
		payload: {
			callId: input.toolCall.id,
			toolName: workerToolName,
			arguments: input.toolCall.arguments,
			ok: dispatch.result.ok,
			result: dispatch.result.payload,
			error: dispatch.result.error,
		},
	});
	const nextState = updateDispatchStateAfterWorkerTool({
		state: input.state,
		toolCall: input.toolCall,
		workerToolName,
		dispatch,
	});
	return continueWith(result, nextState);
}

export function readProjectExplorationCatalogAccess(context: AgentRunContext) {
	const availability = readProjectExplorationCatalogPin(context);
	if (availability?.version !== 2 || !availability.available) return undefined;
	const request = toRecord(
		(context.contextSnapshot as Record<string, unknown>).request,
	);
	const projectPath = request?.registeredRepositoryPath;
	if (typeof projectPath !== "string" || !projectPath.trim()) return undefined;
	return {
		serverId: availability.serverId,
		projectPath,
		expectedHead: availability.freshness.sourceRevisionValue,
	};
}

function updateDispatchStateAfterWorkerTool(input: {
	state: NativeApiDispatchState;
	toolCall: ProviderToolCall;
	workerToolName: string;
	dispatch: Awaited<ReturnType<typeof executeWorkerTool>>;
}): NativeApiDispatchState {
	const result = input.dispatch.result;
	const nextState: NativeApiDispatchState = {
		...input.state,
		readFiles: input.dispatch.readFilesChanged ?? input.state.readFiles,
	};

	if (input.workerToolName === "import_project" && result.ok) {
		const payload = toRecord(result.payload);
		const postImport = toRecord(payload?.postImport);
		const manifest = postImport?.manifest;
		const mode = payload?.mode === "git" ? "git" : "template";
		nextState.postImport = {
			toolCallId: input.toolCall.id,
			mode,
			templateId:
				typeof input.toolCall.arguments.templateId === "string"
					? input.toolCall.arguments.templateId
					: typeof input.toolCall.arguments.stack === "string"
						? input.toolCall.arguments.stack
						: null,
			variant:
				typeof input.toolCall.arguments.variant === "string"
					? input.toolCall.arguments.variant
					: null,
			manifest,
			llmContext: postImport?.llmContext,
			recommendedVerificationCommands:
				readRecommendedVerificationCommands(manifest),
		};
	}

	return nextState;
}

async function dispatchTodoTool(input: {
	toolCall: ProviderToolCall;
	context: AgentRunContext;
	sink: AgentRuntimeSink;
	state: NativeApiDispatchState;
}) {
	const command = input.toolCall.arguments.command;
	if (!command || typeof command !== "object" || Array.isArray(command)) {
		return failedToolResult(
			"INVALID_TOOL_ARGS",
			"todo_list requires a command object.",
		);
	}
	const result = await todoListTool({
		runId: input.context.runId,
		command: command as never,
	});
	return projectWorkerResultToNativeApiToolResult(result);
}

async function dispatchTodoToolWithLedger(input: {
	toolCall: ProviderToolCall;
	context: AgentRunContext;
	sink: AgentRuntimeSink;
	state: NativeApiDispatchState;
}) {
	await input.sink.emit({
		type: "tool_call_started",
		message: "[NativeApiRunner] todo_list started.",
		payload: {
			callId: input.toolCall.id,
			toolName: "todo_list",
			arguments: input.toolCall.arguments,
		},
	});
	const result = await dispatchTodoTool(input);
	await input.sink.emit({
		type: "tool_call_finished",
		message: `[NativeApiRunner] todo_list ${result.ok ? "finished" : "failed"}.`,
		payload: {
			callId: input.toolCall.id,
			toolName: "todo_list",
			arguments: input.toolCall.arguments,
			ok: result.ok,
			error: result.error,
		},
	});
	return result;
}

async function dispatchMcpCatalog(): Promise<NativeApiToolResult> {
	try {
		const tools = await mcpClientManager.listAvailableTools();
		return capNativeApiToolResultContent({
			ok: true,
			content: JSON.stringify({ ok: true, tools }),
			payload: { tools },
		});
	} catch (error) {
		return failedToolResult(
			"MCP_TOOL_LIST_FAILED",
			error instanceof Error ? error.message : String(error),
		);
	}
}

function readRecommendedVerificationCommands(manifest: unknown): string[] {
	const record = toRecord(manifest);
	const commands = Array.isArray(record?.recommendedVerificationCommands)
		? record.recommendedVerificationCommands
		: [];
	return commands.filter(
		(command): command is string =>
			typeof command === "string" && command.trim().length > 0,
	);
}

function toRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}
