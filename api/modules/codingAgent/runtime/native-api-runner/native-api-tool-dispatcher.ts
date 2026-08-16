import { mcpClientManager } from "../../../../services/mcp/mcp-client-manager";
import type { ProviderToolCall } from "../../../../services/structured-llm/tool-calls";
import { executeWorkerTool } from "../../../../services/worker-tools/dispatcher";
import { assertRequestedRunWorkspaceRoot } from "../../../../services/workspace/run-workspace-authority.service";
import {
	loadCodingAgentContextPacket,
	requiresCurrentTodo,
} from "../../context";
import { todoListTool } from "../../tools";
import type { AgentRunContext, AgentRuntimeSink } from "../types";
import { normalizeCompatibleEditToolArguments } from "./native-api-compatible-tool-profile";
import { dispatchContextStillTool } from "./native-api-context-still";
import { continueWith, failedToolResult } from "./native-api-dispatch-results";
import type {
	NativeApiDispatchResult,
	NativeApiDispatchState,
} from "./native-api-dispatch-types";
import { hasRegisteredIsolatedNativeApiFixture } from "./native-api-e2e-fixture-isolation";
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
	const workspaceAuthority = await assertRequestedRunWorkspaceRoot({
		runId: input.context.runId,
		taskId: input.context.taskId,
		requestedRoot: input.context.repoRoot,
	});
	if (!workspaceAuthority.ok) {
		return continueWith(
			failedToolResult(workspaceAuthority.code, workspaceAuthority.message),
			input.state,
		);
	}
	const normalizedArguments = normalizeCompatibleEditToolArguments(
		workerToolName,
		input.toolCall.arguments,
	);
	if (!normalizedArguments.ok) {
		return continueWith(
			failedToolResult("INVALID_TOOL_ARGS", normalizedArguments.message),
			input.state,
		);
	}
	const toolCall = {
		...input.toolCall,
		arguments: normalizedArguments.arguments,
	};
	await input.sink.emit({
		type: "tool_call_started",
		message: `[NativeApiRunner] ${workerToolName} started.`,
		payload: {
			callId: toolCall.id,
			toolName: workerToolName,
			arguments: toolCall.arguments,
		},
	});
	const dispatch = await executeWorkerTool({
		toolName: workerToolName,
		args: toolCall.arguments,
		repoRoot: input.context.repoRoot,
		taskId: input.context.taskId,
		runId: input.context.runId,
		safetyPolicy: input.context.safetyPolicy,
		readFiles: input.state.readFiles,
		projectExplorationCatalogAccess: readProjectExplorationCatalogAccess(
			input.context,
		),
		runtimeEnvironment: readWorkspaceRuntimeEnvironment(input.context),
		// The isolated fixture environment owns a disposable workspace and strips
		// provider credentials. It is the only test capability that may execute a
		// scripted verification command without an OS sandbox, because current
		// macOS hosts can lack sandbox-exec while production must fail closed.
		confinementRequired: !hasRegisteredIsolatedNativeApiFixture(input.context),
	});
	const result = projectWorkerResultToNativeApiToolResult(dispatch.result);
	await input.sink.emit({
		type: "tool_call_finished",
		message: `[NativeApiRunner] ${workerToolName} ${dispatch.result.ok ? "finished" : "failed"}.`,
		payload: {
			callId: toolCall.id,
			toolName: workerToolName,
			arguments: toolCall.arguments,
			ok: dispatch.result.ok,
			result: dispatch.result.payload,
			error: dispatch.result.error,
		},
	});
	const nextState = updateDispatchStateAfterWorkerTool({
		state: input.state,
		toolCall,
		workerToolName,
		dispatch,
	});
	return continueWith(result, nextState);
}

function readWorkspaceRuntimeEnvironment(context: AgentRunContext) {
	const value = context.runtimeOptions?.workspaceRuntimeEnvironment;
	if (!value || typeof value !== "object" || Array.isArray(value))
		return undefined;
	return Object.fromEntries(
		Object.entries(value).filter(
			(entry): entry is [string, string] => typeof entry[1] === "string",
		),
	);
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
	const command = normalizeTodoToolCommand(input.toolCall.arguments);
	if (!command || typeof command !== "object" || Array.isArray(command)) {
		return failedToolResult(
			"INVALID_TOOL_ARGS",
			"todo_list requires command fields.",
		);
	}
	const result = await todoListTool({
		runId: input.context.runId,
		command,
	});
	return projectWorkerResultToNativeApiToolResult(result);
}

function normalizeTodoToolCommand(args: Record<string, unknown>) {
	const legacyCommand = args.command;
	if (
		legacyCommand &&
		typeof legacyCommand === "object" &&
		!Array.isArray(legacyCommand)
	) {
		return legacyCommand;
	}
	if (args.op === "plan" || args.op === "replace_remaining") {
		if (Array.isArray(args.steps)) return args;
		if (args.title !== undefined || args.systemContext !== undefined) {
			return {
				op: args.op,
				steps: [
					{
						title: args.title,
						systemContext: args.systemContext,
					},
				],
			};
		}
	}
	if (args.op === "block_current") {
		if (
			args.humanBlocker &&
			typeof args.humanBlocker === "object" &&
			!Array.isArray(args.humanBlocker)
		) {
			return args;
		}
		const basis =
			args.basisKind === "tool_failure"
				? {
						kind: "tool_failure",
						toolName: args.toolName,
						failureCode: args.failureCode,
						recoveryDisposition: "human_input",
					}
				: { kind: "task_context" };
		return {
			op: args.op,
			humanBlocker: {
				question: args.question,
				requiredInput: args.requiredInput,
				basis,
			},
		};
	}
	return args;
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
