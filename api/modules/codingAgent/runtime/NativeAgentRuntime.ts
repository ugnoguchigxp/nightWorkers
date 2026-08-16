import { toDeepRecord } from "../../../../shared/json-record";
import { runAgentHooks } from "../../../services/hooks/hooks-runner";
import type {
	AgentHookInput,
	AgentHookRunEvent,
} from "../../../services/hooks/types";
import { requireCodingAgentHost } from "../ports/coding-agent-host.binding";
import { NativeApiRunner } from "./native-api-runner/native-api-runner";
import type {
	AgentRunContext,
	AgentRuntime,
	AgentRuntimeEvent,
	AgentRuntimeResult,
	AgentRuntimeSink,
} from "./types";

const DEFAULT_RESULT: AgentRuntimeResult = {
	terminalState: "failed",
	summary: "Runtime execution failed.",
	finalReport: "",
	stoppedBy: "llm_error",
	riskLevel: "high",
};

type NativeApiRunnerLike = Pick<
	NativeApiRunner,
	"run" | "stop" | "suspendForHostShutdown"
>;
type AgentHooksRunner = typeof runAgentHooks;

export class NativeAgentRuntime implements AgentRuntime {
	readonly kind = "native-local" as const;
	private readonly runner: NativeApiRunnerLike;
	private readonly runHooks: AgentHooksRunner;

	constructor(
		input: { runner?: NativeApiRunnerLike; runHooks?: AgentHooksRunner } = {},
	) {
		this.runner = input.runner ?? new NativeApiRunner();
		this.runHooks = input.runHooks ?? runAgentHooks;
	}

	async start(
		context: AgentRunContext,
		sink: AgentRuntimeSink,
		signal?: AbortSignal,
	): Promise<AgentRuntimeResult> {
		const logs: string[] = [];
		const appendLog = (line: string) => {
			logs.push(line);
		};
		const emit = async (event: Parameters<AgentRuntimeSink["emit"]>[0]) => {
			appendLog(event.message);
			const currentTodoData = await readCurrentTodoEventData(context.runId);
			const payload =
				event.payload &&
				typeof event.payload === "object" &&
				!Array.isArray(event.payload)
					? {
							...currentTodoData,
							...(event.payload as Record<string, unknown>),
						}
					: { ...currentTodoData, payload: event.payload };
			const enrichedEvent = {
				...event,
				payload:
					Object.keys(currentTodoData).length > 0 ? payload : event.payload,
			} as AgentRuntimeEvent;
			await sink.emit(enrichedEvent);
		};
		const emitHookEvent = async (event: AgentHookRunEvent) => {
			await requireCodingAgentHost().runJournal.appendRunEvent({
				version: 1,
				runId: context.runId,
				taskId: context.taskId,
				timestamp: new Date().toISOString(),
				type: event.type,
				severity: event.severity,
				actor: "system",
				message: event.message,
				data: event.data,
			});
		};
		let sessionHookOpened = false;
		let sessionHookClosed = false;
		const runSessionEndHook = async (result?: AgentRuntimeResult) => {
			if (!sessionHookOpened || sessionHookClosed) return;
			sessionHookClosed = true;
			await this.runHooks({
				input: buildSessionHookInput("SessionEnd", context, result),
				repoRoot: context.repoRoot,
				onEvent: emitHookEvent,
			});
		};

		try {
			if (signal?.aborted) {
				return this.toCancelled(logs.join("\n"));
			}

			await emit({
				type: "runtime_started",
				message: `[System] Native API Runner started execution in workspace: ${context.repoRoot}`,
			});

			await this.runHooks({
				input: buildSessionHookInput("SessionStart", context),
				repoRoot: context.repoRoot,
				onEvent: emitHookEvent,
			});
			sessionHookOpened = true;

			const promptHook = await this.runHooks({
				input: {
					...buildBaseHookInput("UserPromptSubmit", context),
					hook_event_name: "UserPromptSubmit",
					prompt: context.latestUserMessage || context.compiledPrompt,
				},
				repoRoot: context.repoRoot,
				onEvent: emitHookEvent,
			});
			if (promptHook.decision === "block") {
				const finalReport =
					promptHook.reason || "User prompt was blocked by an agent hook.";
				const result: AgentRuntimeResult = {
					terminalState: "blocked",
					summary: finalReport,
					finalReport,
					stoppedBy: "hook",
					riskLevel: "medium",
					logContent: logs.join("\n"),
				};
				await runSessionEndHook(result);
				return result;
			}

			const runnerResult = await this.runner.run(context, { emit }, signal);
			const result: AgentRuntimeResult = {
				...runnerResult,
				logContent: logs.join("\n"),
			};

			await emit({
				type: "runtime_finished",
				message: `[System] Native API Runner finished with terminalState=${result.terminalState}.`,
				payload: {
					terminalState: result.terminalState,
					finalReport: result.finalReport,
					summary: result.summary,
					stoppedBy: result.stoppedBy,
					runtime: "native_api_runner",
				},
			});

			await runSessionEndHook(result);
			return result;
		} catch (err) {
			const errorMessage =
				err instanceof Error
					? err.message
					: String(toDeepRecord(err).message || err);
			const message = `[System Error] Native API Runner failed: ${errorMessage || "Unknown error"}`;
			await emit({
				type: "runtime_error",
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
					`[System] SessionEnd hook failed while handling runtime error: ${hookErrorMessage}`,
				);
			}
			logs.push(message);
			return {
				...DEFAULT_RESULT,
				summary: errorMessage
					? `Runtime failed: ${errorMessage}`
					: DEFAULT_RESULT.summary,
				logContent: logs.join("\n"),
			};
		}
	}

	async stop(runId: string): Promise<void> {
		await this.runner.stop(runId);
	}

	async suspendForHostShutdown(runId: string): Promise<void> {
		await this.runner.suspendForHostShutdown(runId);
	}

	private toCancelled(logContent: string): AgentRuntimeResult {
		return {
			terminalState: "cancelled",
			summary: "Runtime execution cancelled.",
			finalReport: "Runtime execution cancelled.",
			stoppedBy: "cancelled",
			riskLevel: "medium",
			logContent,
		};
	}
}

async function readCurrentTodo(runId: string) {
	const todos = await requireCodingAgentHost().runReader.listRunTodos(runId);
	return todos
		.filter((todo) => todo.status === "running")
		.sort((a, b) => a.seq - b.seq)[0];
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

function buildBaseHookInput(
	event: AgentHookInput["hook_event_name"],
	context: AgentRunContext,
): Omit<AgentHookInput, "hook_event_name"> & {
	hook_event_name: AgentHookInput["hook_event_name"];
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
	event: "SessionStart" | "SessionEnd",
	context: AgentRunContext,
	result?: AgentRuntimeResult,
): AgentHookInput {
	return {
		...buildBaseHookInput(event, context),
		hook_event_name: event,
		source: event === "SessionStart" ? "run_start" : "run_end",
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
