import type { McpToolSummary } from "../../mcp/mcp-client-manager";
import { executeWorkerTool } from "../../worker-tools/dispatcher";
import { todoListTool } from "../../worker-tools/todo-list";
import type {
	AgentRunContext,
	AgentRuntimeResult,
	AgentRuntimeSink,
} from "../types";
import { readNativeApiExecutionMode } from "./native-api-mode";
import type { NativeApiSessionStore } from "./native-api-session-store";
import { runFailedRuntimeGate } from "./native-api-startup-failure";
import {
	resolveContextStillTool,
	resolveStartupWorkTodoForRun,
} from "./native-api-startup-resolution";
import {
	buildContextCompileArguments,
	failedToolResult,
	isMissingSpecificationFailure,
	renderContextCompileHistory,
	renderInitialInstructionsHistory,
	renderSpecificationHistory,
	toRecord,
} from "./native-api-startup-support";
import {
	alignTodos,
	completeCodingPreparationTodo,
	completeProcedureTodo,
} from "./native-api-startup-todos";
import type { NativeApiDispatchState } from "./native-api-tool-dispatcher";
import type {
	NativeApiHistoryItem,
	NativeApiToolResult,
} from "./native-api-tool-history";
import { projectWorkerResultToNativeApiToolResult } from "./native-api-tool-result-projector";

type StartupPhase =
	| "startup_specification"
	| "startup_initial_instructions"
	| "startup_context_compile"
	| "startup_todo_alignment";

type StartupGateResult = {
	historyItem: NativeApiHistoryItem;
	toolResult: NativeApiToolResult;
};

export type NativeApiStartupResult =
	| {
			ok: true;
			history: NativeApiHistoryItem[];
			state: NativeApiDispatchState;
	  }
	| {
			ok: false;
			result: AgentRuntimeResult;
			history: NativeApiHistoryItem[];
			state: NativeApiDispatchState;
	  };

export type NativeApiStartupControllerLike = Pick<
	NativeApiStartupController,
	"runStartup"
>;

export class NativeApiStartupController {
	constructor(
		private readonly input: {
			store: NativeApiSessionStore;
			executeTool?: typeof executeWorkerTool;
			listAvailableMcpTools?: () => Promise<McpToolSummary[]>;
			mutateTodos?: typeof todoListTool;
		},
	) {}

	async runStartup(input: {
		context: AgentRunContext;
		sink: AgentRuntimeSink;
		history: NativeApiHistoryItem[];
		state: NativeApiDispatchState;
		resumeHistoryRestored?: boolean;
		signal?: AbortSignal;
	}): Promise<NativeApiStartupResult> {
		let history = input.history;
		let state = input.state;
		const turn = await this.input.store.createTurn({
			runId: input.context.runId,
			taskId: input.context.taskId,
			agentModeSessionId: input.context.agentModeSessionId,
			turnIndex: 0,
			history,
			provider: "runtime_gate",
			model: null,
			executionMode: readNativeApiExecutionMode(input.context),
		});

		await input.sink.emit({
			type: "turn_started",
			message: "[NativeApiRunner] startup gates started.",
			payload: {
				runtime: "native_api_runner",
				phase: "startup",
				turnId: turn.id,
				turnIndex: 0,
			},
		});

		const fail = async (
			gateHistory: NativeApiHistoryItem[],
			gateState: NativeApiDispatchState,
			summary: string,
			finalReport: string,
			error?: unknown,
		): Promise<NativeApiStartupResult> => {
			await this.input.store.finishTurn({
				turnId: turn.id,
				status: input.signal?.aborted ? "cancelled" : "failed",
				history: gateHistory,
				error,
			});
			return {
				ok: false,
				history: gateHistory,
				state: gateState,
				result: {
					terminalState: input.signal?.aborted ? "cancelled" : "needs_human",
					summary,
					finalReport,
					stoppedBy: input.signal?.aborted ? "cancelled" : "tool_failure",
					riskLevel: "high",
				},
			};
		};

		if (input.signal?.aborted) {
			return fail(
				history,
				state,
				"Native API startup was cancelled.",
				"Native API startup was cancelled.",
			);
		}

		const specification = await this.runSpecificationGate({
			context: input.context,
			sink: input.sink,
			turnId: turn.id,
			state,
		});
		history = [...history, specification.historyItem];
		const specificationResumeFallback =
			!specification.toolResult.ok &&
			input.resumeHistoryRestored === true &&
			isMissingSpecificationFailure(specification.toolResult);
		state = {
			...state,
			specificationRead:
				specification.toolResult.ok || specificationResumeFallback,
			...(specificationResumeFallback
				? { specificationReadFromResumeFallback: true }
				: {}),
		};

		if (!specification.toolResult.ok && !specificationResumeFallback) {
			return fail(
				history,
				state,
				"Native API startup failed while reading the current specification.",
				specification.toolResult.error?.message ||
					"Draft specification was not found or could not be read.",
				specification.toolResult.error,
			);
		}
		if (specificationResumeFallback) {
			await input.sink.emit({
				type: "runtime_started",
				message:
					"[NativeApiRunner] current specification was missing; continuing with restored native/API resume history.",
				payload: {
					runtime: "native_api_runner",
					action: "runtime.resume_specification_missing_waived",
					resumeState: "reused",
					phase: "startup_specification",
					executionMode: readNativeApiExecutionMode(input.context),
					error: specification.toolResult.error,
				},
			});
		}

		const initialInstructions = await this.runMcpGate({
			phase: "startup_initial_instructions",
			mcpTool: "initial_instructions",
			modelToolName: "context-still.initial_instructions",
			arguments: {},
			context: input.context,
			sink: input.sink,
			turnId: turn.id,
			state,
		});
		history = [...history, initialInstructions.historyItem];
		state = {
			...state,
			initialInstructionsCompleted: initialInstructions.toolResult.ok,
		};

		if (!initialInstructions.toolResult.ok) {
			return fail(
				history,
				state,
				"Native API startup failed while running contextStill initial_instructions.",
				initialInstructions.toolResult.error?.message ||
					"contextStill initial_instructions failed before provider turn.",
				initialInstructions.toolResult.error,
			);
		}
		await this.completeProcedureTodo(
			input.context.runId,
			"contextstill.initial_instructions",
		);
		const workTodo = await this.resolveStartupWorkTodo(input.context.runId);

		const contextCompileArgs = buildContextCompileArguments(
			input.context,
			specification.toolResult.payload,
			workTodo,
		);
		const contextCompile = await this.runMcpGate({
			phase: "startup_context_compile",
			mcpTool: "context_compile",
			modelToolName: "context-still.context_compile",
			arguments: contextCompileArgs,
			context: input.context,
			sink: input.sink,
			turnId: turn.id,
			state,
		});
		history = [...history, contextCompile.historyItem];
		state = { ...state, contextCompiled: contextCompile.toolResult.ok };

		if (!contextCompile.toolResult.ok) {
			return fail(
				history,
				state,
				"Native API startup failed while running contextStill context_compile.",
				contextCompile.toolResult.error?.message ||
					"contextStill context_compile failed before provider turn.",
				contextCompile.toolResult.error,
			);
		}
		await this.completeProcedureTodo(
			input.context.runId,
			"contextstill.context_compile",
		);
		await this.completeCodingPreparationTodo(input.context.runId);

		const alignment = await this.alignTodos({
			context: input.context,
			sink: input.sink,
			turnId: turn.id,
			state,
		});
		history = [...history, alignment.historyItem];
		state = {
			...state,
			todoAligned: alignment.toolResult.ok,
			startupCompleted: alignment.toolResult.ok,
		};

		if (!alignment.toolResult.ok) {
			return fail(
				history,
				state,
				"Native API startup Todo alignment failed.",
				alignment.toolResult.error?.message ||
					"Todo alignment failed before provider turn.",
				alignment.toolResult.error,
			);
		}

		await this.input.store.finishTurn({
			turnId: turn.id,
			status: "completed",
			history,
		});
		return { ok: true, history, state };
	}

	private async runSpecificationGate(input: {
		context: AgentRunContext;
		sink: AgentRuntimeSink;
		turnId: string;
		state: NativeApiDispatchState;
	}): Promise<StartupGateResult> {
		const args = { phase: "startup_specification", includeDesignContext: true };
		const result = await this.runRuntimeToolGate({
			phase: "startup_specification",
			toolName: "read_current_specification",
			workerToolName: "read_current_specification",
			arguments: args,
			executeArgs: { includeDesignContext: true },
			context: input.context,
			sink: input.sink,
			turnId: input.turnId,
			state: input.state,
			validateResult: (toolResult) => {
				const payload = toRecord(toolResult.payload);
				if (
					toolResult.ok &&
					payload.found === true &&
					typeof payload.content === "string" &&
					payload.content.trim().length > 0
				) {
					return toolResult;
				}
				return failedToolResult(
					"SPECIFICATION_NOT_FOUND",
					"Draft specification was not found or was empty.",
					toolResult.payload,
				);
			},
		});
		const payload = toRecord(result.toolResult.payload);
		if (!result.toolResult.ok) return result;
		return {
			...result,
			historyItem: {
				type: "user",
				source: "runtime",
				content: renderSpecificationHistory(payload),
			},
		};
	}

	private async runMcpGate(input: {
		phase: StartupPhase;
		mcpTool: "initial_instructions" | "context_compile";
		modelToolName:
			| "context-still.initial_instructions"
			| "context-still.context_compile";
		arguments: Record<string, unknown>;
		context: AgentRunContext;
		sink: AgentRuntimeSink;
		turnId: string;
		state: NativeApiDispatchState;
	}): Promise<StartupGateResult> {
		const tool = await this.resolveContextStillTool(input.mcpTool);
		if (!tool) {
			const result = await this.runFailedRuntimeGate({
				phase: input.phase,
				toolName: input.modelToolName,
				arguments: input.arguments,
				context: input.context,
				sink: input.sink,
				turnId: input.turnId,
				error: failedToolResult(
					"MCP_TOOL_UNAVAILABLE",
					`contextStill ${input.mcpTool} is unavailable.`,
				),
				eventPayload: {
					mcpTool: input.mcpTool,
				},
			});
			return {
				...result,
				historyItem: {
					type: "user",
					source: "runtime",
					content: `[Startup ${input.mcpTool}]\nMCP tool unavailable.`,
				},
			};
		}
		const result = await this.runRuntimeToolGate({
			phase: input.phase,
			toolName: input.modelToolName,
			workerToolName: "mcp_call_tool",
			arguments: {
				serverId: tool.serverId,
				toolName: input.mcpTool,
				arguments: input.arguments,
			},
			executeArgs: {
				serverId: tool.serverId,
				toolName: input.mcpTool,
				arguments: input.arguments,
			},
			context: input.context,
			sink: input.sink,
			turnId: input.turnId,
			state: input.state,
			eventPayload: {
				mcpServer: tool.serverName,
				mcpTool: input.mcpTool,
				serverId: tool.serverId,
			},
		});
		return {
			...result,
			historyItem: {
				type: "user",
				source: "runtime",
				content:
					input.mcpTool === "context_compile"
						? renderContextCompileHistory(input.arguments, result.toolResult)
						: renderInitialInstructionsHistory(result.toolResult),
			},
		};
	}

	private async runRuntimeToolGate(input: {
		phase: StartupPhase;
		toolName: string;
		workerToolName: Parameters<typeof executeWorkerTool>[0]["toolName"];
		arguments: Record<string, unknown>;
		executeArgs: Record<string, unknown>;
		context: AgentRunContext;
		sink: AgentRuntimeSink;
		turnId: string;
		state: NativeApiDispatchState;
		eventPayload?: Record<string, unknown>;
		validateResult?: (result: NativeApiToolResult) => NativeApiToolResult;
	}): Promise<StartupGateResult> {
		const toolCall = {
			id: `runtime-gate-${input.phase}-${crypto.randomUUID()}`,
			name: input.toolName,
			arguments: {
				...input.arguments,
				phase: input.phase,
			},
		};
		const record = await this.input.store.recordToolCallPending({
			runId: input.context.runId,
			taskId: input.context.taskId,
			turnId: input.turnId,
			toolCall,
			todoSeq: input.context.currentTodo?.seq ?? null,
			source: "runtime_gate",
		});

		await this.input.store.markToolCallRunning({ id: record.id });
		await input.sink.emit({
			type: "tool_call_started",
			message: `[NativeApiRunner] ${input.toolName} startup gate started.`,
			payload: {
				callId: toolCall.id,
				toolName: input.toolName,
				phase: input.phase,
				arguments: input.arguments,
				...input.eventPayload,
			},
		});

		const dispatch = await this.executeTool({
			toolName: input.workerToolName,
			args: input.executeArgs,
			repoRoot: input.context.repoRoot,
			taskId: input.context.taskId,
			safetyPolicy: input.context.safetyPolicy,
			readFiles: input.state.readFiles,
		});
		const toolResult = input.validateResult
			? input.validateResult(
					projectWorkerResultToNativeApiToolResult(dispatch.result),
				)
			: projectWorkerResultToNativeApiToolResult(dispatch.result);
		await this.input.store.finishToolCall({
			id: record.id,
			status: toolResult.ok ? "completed" : "failed",
			result: toolResult,
			error: toolResult.error,
			modelVisibleOutput: toolResult.content,
		});
		await input.sink.emit({
			type: "tool_call_finished",
			message: `[NativeApiRunner] ${input.toolName} startup gate ${
				toolResult.ok ? "finished" : "failed"
			}.`,
			payload: {
				callId: toolCall.id,
				toolName: input.toolName,
				phase: input.phase,
				status: toolResult.ok ? "completed" : "failed",
				ok: toolResult.ok,
				result: dispatch.result.payload,
				error: toolResult.error ?? dispatch.result.error,
				...input.eventPayload,
			},
		});

		return {
			historyItem: {
				type: "tool_result",
				toolCallId: toolCall.id,
				toolName: input.toolName,
				result: toolResult,
			},
			toolResult,
		};
	}

	private async runFailedRuntimeGate(input: {
		phase: StartupPhase;
		toolName: string;
		arguments: Record<string, unknown>;
		context: AgentRunContext;
		sink: AgentRuntimeSink;
		turnId: string;
		error: NativeApiToolResult;
		eventPayload?: Record<string, unknown>;
	}): Promise<StartupGateResult> {
		return runFailedRuntimeGate({ store: this.input.store }, input);
	}

	private async alignTodos(input: {
		context: AgentRunContext;
		sink: AgentRuntimeSink;
		turnId: string;
		state: NativeApiDispatchState;
	}) {
		return alignTodos(
			{
				store: this.input.store,
				mutateTodos: (value) => this.mutateTodos(value),
			},
			input,
		);
	}

	private async completeProcedureTodo(runId: string, procedureId: string) {
		return completeProcedureTodo(
			{
				store: this.input.store,
				mutateTodos: (value) => this.mutateTodos(value),
			},
			runId,
			procedureId,
		);
	}

	private async completeCodingPreparationTodo(runId: string) {
		return completeCodingPreparationTodo(
			{
				store: this.input.store,
				mutateTodos: (value) => this.mutateTodos(value),
			},
			runId,
		);
	}

	private async resolveStartupWorkTodo(runId: string) {
		return resolveStartupWorkTodoForRun(runId);
	}

	private executeTool(input: Parameters<typeof executeWorkerTool>[0]) {
		return (this.input.executeTool ?? executeWorkerTool)(input);
	}

	private mutateTodos(input: Parameters<typeof todoListTool>[0]) {
		return (this.input.mutateTodos ?? todoListTool)(input);
	}

	private async resolveContextStillTool(
		toolName: "initial_instructions" | "context_compile",
	) {
		return resolveContextStillTool(this.input, toolName);
	}
}
