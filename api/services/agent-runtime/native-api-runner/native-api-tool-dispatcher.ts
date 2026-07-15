import { mcpClientManager } from "../../mcp/mcp-client-manager";
import { runControlService } from "../../run-control/run-control-service";
import type { ProviderToolCall } from "../../structured-llm/tool-calls";
import { executeWorkerTool } from "../../worker-tools/dispatcher";
import {
	type TodoListOperation,
	todoListTool,
} from "../../worker-tools/todo-list";
import type { AgentRunContext, AgentRuntimeSink } from "../types";
import {
	normalizeVerificationCommand,
	verificationCommandsMatch,
} from "../verification-command";
import {
	dispatchContextStillTool,
	nextStateFromContextStillToolResult,
} from "./native-api-context-still";
import { continueWith, failedToolResult } from "./native-api-dispatch-results";
import type {
	NativeApiDispatchResult,
	NativeApiDispatchState,
} from "./native-api-dispatch-types";
import { finalizeAnswer } from "./native-api-finalize";
import { readNativeApiExecutionMode } from "./native-api-mode";
import {
	type NativeApiToolResult,
	readProjectExplorationCatalogPin,
} from "./native-api-tool-history";
import {
	getNativeApiToolRegistration,
	isNativeApiToolAllowedForMode,
} from "./native-api-tool-registry";
import {
	capNativeApiToolResultContent,
	projectWorkerResultToMcpStructuredPayload,
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
	const executionMode = readNativeApiExecutionMode(input.context);
	const registration = getNativeApiToolRegistration(input.toolCall.name);
	if (!registration) {
		return continueWith(
			failedToolResult("UNKNOWN_TOOL", `Unknown tool: ${input.toolCall.name}`),
			input.state,
		);
	}
	if (!isNativeApiToolAllowedForMode(input.toolCall.name, executionMode)) {
		return continueWith(
			failedToolResult(
				"TOOL_NOT_ALLOWED_FOR_MODE",
				`${input.toolCall.name} is not allowed in native/API ${executionMode} mode.`,
			),
			input.state,
		);
	}

	if (registration.kind === "terminal") {
		return finalizeAnswer(input);
	}

	if (registration.kind === "todo_control") {
		return continueWith(await dispatchTodoTool(input), input.state);
	}

	if (registration.kind === "context_still") {
		return dispatchContextStillTool(input);
	}

	if (registration.kind === "mcp_catalog") {
		return continueWith(await dispatchMcpCatalog(), input.state);
	}

	if (registration.kind === "context_window") {
		await runControlService.rotateContext(input.context.runId);
		return continueWith(successfulNewContextWindow(), {
			...input.state,
			newContextWindowRequested: true,
		});
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
	const prepared = await runControlService.prepare({
		runId: input.context.runId,
		toolName: workerToolName,
		arguments: input.toolCall.arguments,
		workspaceIdentity: input.context.repoRoot,
	});
	if (prepared.kind === "terminal") {
		return continueWith(
			failedToolResult(
				"RUN_ALREADY_TERMINAL",
				`Run is already terminal (${prepared.state.terminalReason ?? "unknown"}).`,
			),
			input.state,
		);
	}
	if (prepared.kind === "reuse") {
		return continueWith(
			capNativeApiToolResultContent({
				ok: prepared.action.domainOutcome === "succeeded",
				content: JSON.stringify({
					control: "reused_result",
					domainOutcome: prepared.action.domainOutcome,
					progressRevision: prepared.state.progressRevision,
					phase: prepared.state.phase,
					recoveryRequirement:
						prepared.state.phase === "recovery"
							? "新しい観測、workspace/workflow変更、新しい証跡、またはblocker提示のいずれかを一つ行う"
							: null,
					payload: prepared.action.modelView,
				}),
				payload: prepared.action.modelView,
			}),
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
		projectExplorationCatalogAccess: projectExplorationAccess(input.context),
	});
	const modelView = projectWorkerResultToMcpStructuredPayload(dispatch.result);
	const outcome = await runControlService.completeWorkerAction({
		prepared: {
			state: prepared.state,
			action: prepared.action,
			persisted: prepared.persisted,
		},
		result: dispatch.result,
		modelView,
		evidenceRefs:
			prepared.action.effect === "verification"
				? [`verification:${input.context.runId}:${prepared.action.id}`]
				: [],
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
			outcome: {
				transportStatus: outcome.transportStatus,
				domainOutcome: outcome.domainOutcome,
				effect: outcome.effect,
				progressRevisionBefore: outcome.progressRevisionBefore,
				progressRevisionAfter: outcome.progressRevisionAfter,
			},
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

function projectExplorationAccess(context: AgentRunContext) {
	const availability = readProjectExplorationCatalogPin(context);
	return availability?.version === 2 && availability.available
		? { serverId: availability.serverId }
		: undefined;
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
		specificationRead:
			input.state.specificationRead ||
			(input.workerToolName === "read_current_specification" && result.ok),
	};

	if (input.workerToolName === "read_file" && input.state.postImport) {
		const filePath =
			typeof input.toolCall.arguments.filePath === "string"
				? input.toolCall.arguments.filePath
				: "";
		if (isProjectManifestPath(filePath)) {
			nextState.manifestReadAfterImport = true;
		}
	}

	if (input.workerToolName === "import_project" && result.ok) {
		const payload = toRecord(result.payload);
		const postImport = toRecord(payload?.postImport);
		const manifest = postImport?.manifest;
		const mode = payload?.mode === "git" ? "git" : "template";
		nextState.importProjectSucceeded = true;
		nextState.importProjectFailed = false;
		nextState.successfulVerificationCommands = [];
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
			verifiedCommand: null,
		};
		nextState.manifestReadAfterImport = Boolean(manifest);
	}

	if (input.workerToolName === "import_project" && !result.ok) {
		nextState.importProjectFailed = true;
	}

	if (input.workerToolName === "copy_directory" && result.ok) {
		nextState.copyDirectorySucceeded = true;
	}

	if (input.workerToolName === "run_verification" && result.ok) {
		const command =
			typeof input.toolCall.arguments.command === "string"
				? input.toolCall.arguments.command
				: null;
		const normalizedCommand = normalizeVerificationCommand(command);
		nextState.successfulVerificationCommands = [
			...(input.state.successfulVerificationCommands ?? []),
			...(normalizedCommand ? [normalizedCommand] : []),
		];
		if (nextState.postImport && normalizedCommand) {
			const recommendedCommands =
				nextState.postImport.recommendedVerificationCommands
					.map((item) => normalizeVerificationCommand(item))
					.filter((item): item is string => item !== null);
			if (
				recommendedCommands.length === 0 ||
				recommendedCommands.some((recommended) =>
					verificationCommandsMatch(normalizedCommand, recommended),
				)
			) {
				nextState.postImport = {
					...nextState.postImport,
					verifiedCommand: normalizedCommand,
				};
			}
		}
	}

	if (input.workerToolName === "mcp_call_tool" && result.ok) {
		const args = toRecord(input.toolCall.arguments);
		nextStateFromContextStillToolResult(nextState, args?.toolName, result.ok);
	}

	return nextState;
}

async function dispatchTodoTool(input: {
	toolCall: ProviderToolCall;
	context: AgentRunContext;
	sink: AgentRuntimeSink;
	state: NativeApiDispatchState;
}) {
	const operation = input.toolCall.arguments.operation;
	if (!isTodoMutationOperation(operation)) {
		return failedToolResult(
			"INVALID_TOOL_ARGS",
			"todo_list operation must be one of todo_list operation=replace, todo_list operation=start, todo_list operation=done, todo_list operation=block, or todo_list operation=fail.",
		);
	}
	const result = await todoListTool({
		runId: input.context.runId,
		operation,
		seq:
			typeof input.toolCall.arguments.seq === "number"
				? input.toolCall.arguments.seq
				: undefined,
		todos: Array.isArray(input.toolCall.arguments.todos)
			? (input.toolCall.arguments.todos as never)
			: undefined,
		startFirst:
			typeof input.toolCall.arguments.startFirst === "boolean"
				? input.toolCall.arguments.startFirst
				: undefined,
		todoListReplaceReason:
			typeof input.toolCall.arguments.todoListReplaceReason === "string"
				? (input.toolCall.arguments.todoListReplaceReason as never)
				: undefined,
		evidenceRefs: Array.isArray(input.toolCall.arguments.evidenceRefs)
			? input.toolCall.arguments.evidenceRefs.filter(
					(value): value is string => typeof value === "string",
				)
			: undefined,
	});
	return projectWorkerResultToNativeApiToolResult(result);
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

function successfulNewContextWindow(): NativeApiToolResult {
	const message =
		"A new context window will start without summarizing conversation history.";
	return capNativeApiToolResultContent({
		ok: true,
		content: message,
		payload: {
			newContextWindowRequested: true,
			message,
		},
	});
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

function isProjectManifestPath(filePath: string) {
	return /(^|\/)(package\.json|pyproject\.toml)$/.test(filePath.trim());
}

function toRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function isTodoMutationOperation(
	value: unknown,
): value is Exclude<TodoListOperation, "list"> {
	return (
		value === "replace" ||
		value === "start" ||
		value === "done" ||
		value === "block" ||
		value === "fail"
	);
}
