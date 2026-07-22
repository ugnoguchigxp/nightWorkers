import { RuntimeSessionStateStore } from "../../../services/runtime-session-state";
import { createThread, finishRun, toCancelled } from "./codex-runtime-closeout";
import {
	persistCodexProviderThreadIfPresent,
	readPromptPartObservabilityEnabled,
	updateCodexSessionKey,
} from "./codex-runtime-support";
import type { CodexThreadFactory } from "./codex-sdk/codex-sdk-client";
import {
	createCodexEventMapperState,
	mapCodexThreadEvent,
} from "./codex-sdk/codex-sdk-event-adapter";
import {
	buildCodexRuntimePromptParts,
	buildCodexRuntimeTurnInput,
} from "./codex-sdk/codex-sdk-runtime-prompt";
import {
	type RuntimeUsageRecorder,
	recordCodexRuntimeUsageIfPresent,
} from "./codex-sdk/codex-sdk-usage";
import type {
	AgentRunContext,
	AgentRuntime,
	AgentRuntimeResult,
	AgentRuntimeSink,
} from "./types";

export type { CodexThreadFactory } from "./codex-sdk/codex-sdk-client";
export {
	buildCodexRuntimePrompt,
	buildCodexRuntimePromptParts,
} from "./codex-sdk/codex-sdk-runtime-prompt";

/**
 * Codex SDKの一つのturnをNightWorkersのRunへ接続する薄いadapter。
 * Task解釈、Todo、tool選択、検証、完了判断はCodexに委ね、hostは
 * workspace・停止・timeout・trace・usageだけを扱う。
 */
export class CodexAgentRuntime implements AgentRuntime {
	readonly kind = "codex-agent" as const;
	private readonly cancelledRunIds = new Set<string>();
	private readonly activeRunControllers = new Map<string, AbortController>();
	private readonly threadFactory?: CodexThreadFactory;
	private readonly runtimeSessionStore: RuntimeSessionStateStore;
	private readonly persistRuntimeSessionState: boolean;
	private readonly collectWorkspaceDiff: boolean;
	private readonly persistRuntimeUsage: boolean;
	private readonly usageRecorder: RuntimeUsageRecorder;

	constructor(
		input: {
			threadFactory?: CodexThreadFactory;
			runtimeSessionStore?: RuntimeSessionStateStore;
			persistRuntimeSessionState?: boolean;
			collectWorkspaceDiff?: boolean;
			persistRuntimeUsage?: boolean;
			usageRecorder?: RuntimeUsageRecorder;
		} = {},
	) {
		this.threadFactory = input.threadFactory;
		this.runtimeSessionStore =
			input.runtimeSessionStore ?? new RuntimeSessionStateStore();
		this.persistRuntimeSessionState =
			input.persistRuntimeSessionState ?? !input.threadFactory;
		this.collectWorkspaceDiff =
			input.collectWorkspaceDiff ?? !input.threadFactory;
		this.persistRuntimeUsage =
			input.persistRuntimeUsage ?? !input.threadFactory;
		this.usageRecorder = input.usageRecorder ?? recordCodexLlmUsage;
	}

	async start(
		context: AgentRunContext,
		sink: AgentRuntimeSink,
		signal?: AbortSignal,
	): Promise<AgentRuntimeResult> {
		const controller = new AbortController();
		this.activeRunControllers.set(context.runId, controller);
		const abort = () => controller.abort(signal?.reason);
		signal?.addEventListener("abort", abort, { once: true });
		let timedOut = false;
		const timeout = setTimeout(() => {
			timedOut = true;
			controller.abort(
				new Error(
					`CodexAgentRuntime timed out after ${context.timeoutSeconds}s`,
				),
			);
		}, Math.max(1, context.timeoutSeconds) * 1000);
		const logs: string[] = [];
		let finalReport = "";

		try {
			if (this.isCancelled(context, signal))
				return toCancelled(logs.join("\n"));
			const thread = await createThread(this.closeoutHost(), context, sink);
			const promptParts = buildCodexRuntimePromptParts(context);
			const turnInput = buildCodexRuntimeTurnInput(
				context,
				promptParts.prompt,
				false,
			);
			const turnStartedAt = Date.now();
			const { events } = await thread.runStreamed(turnInput, {
				signal: controller.signal,
			});
			const mapperState = createCodexEventMapperState({
				repoRoot: context.repoRoot,
			});
			let providerSessionKey: string | null = null;
			let turnCompleted = false;
			let runtimeFailed = false;

			for await (const providerEvent of events) {
				for (const event of mapCodexThreadEvent(providerEvent, mapperState)) {
					providerSessionKey = updateCodexSessionKey(providerSessionKey, event);
					logs.push(event.message);
					await sink.emit(event);
					if (this.persistRuntimeSessionState) {
						try {
							await persistCodexProviderThreadIfPresent(
								this.runtimeSessionStore,
								context,
								event,
							);
						} catch (error) {
							await this.emitSupportWarning(sink, logs, {
								code: "CODEX_SESSION_STATE_PERSIST_FAILED",
								message: "Codex session state could not be persisted.",
								error,
							});
						}
					}
					if (event.type === "model_response_finished") {
						const payload = event.payload as { text?: unknown } | undefined;
						if (typeof payload?.text === "string") finalReport = payload.text;
					}
					if (event.type === "turn_finished") {
						turnCompleted = true;
						try {
							await this.recordUsage({
								context,
								payload: event.payload,
								durationMs: Date.now() - turnStartedAt,
								promptParts,
								providerSessionKey,
							});
						} catch (error) {
							await this.emitSupportWarning(sink, logs, {
								code: "CODEX_USAGE_PERSIST_FAILED",
								message: "Codex usage could not be persisted.",
								error,
							});
						}
					}
					if (event.type === "runtime_error") runtimeFailed = true;
				}
			}

			if (timedOut) {
				return this.finish(context, sink, logs, {
					terminalState: "timed_out",
					finalReport,
					stoppedBy: "budget",
					riskLevel: "high",
				});
			}
			if (this.isCancelled(context, signal))
				return toCancelled(logs.join("\n"));
			if (runtimeFailed || !turnCompleted || !finalReport.trim()) {
				if (!runtimeFailed && !turnCompleted) {
					await this.emitRuntimeError(sink, logs, {
						code: "PROVIDER_TURN_TERMINAL_EVENT_MISSING",
						message: "Codex event stream ended without a terminal turn event.",
					});
				}
				if (!runtimeFailed && turnCompleted && !finalReport.trim()) {
					await this.emitRuntimeError(sink, logs, {
						code: "PROVIDER_FINAL_RESPONSE_MISSING",
						message: "Codex turn completed without a final assistant message.",
					});
				}
				return this.finish(context, sink, logs, {
					terminalState: "failed",
					finalReport,
					stoppedBy: "llm_error",
					riskLevel: "high",
				});
			}
			return this.finish(context, sink, logs, {
				terminalState: "completed",
				finalReport,
				stoppedBy: "decision",
				riskLevel: "medium",
			});
		} catch (error) {
			if (timedOut) {
				return this.finish(context, sink, logs, {
					terminalState: "timed_out",
					finalReport,
					stoppedBy: "budget",
					riskLevel: "high",
				});
			}
			if (this.isCancelled(context, signal))
				return toCancelled(logs.join("\n"));
			const errorMessage = `[System Error] ${
				error instanceof Error ? error.message : String(error)
			}`;
			logs.push(errorMessage);
			await sink.emit({
				type: "runtime_error",
				message: errorMessage,
				payload: { rawError: error },
			});
			return this.finish(context, sink, logs, {
				terminalState: "failed",
				finalReport: finalReport || errorMessage,
				stoppedBy: "llm_error",
				riskLevel: "high",
			});
		} finally {
			clearTimeout(timeout);
			signal?.removeEventListener("abort", abort);
			if (this.activeRunControllers.get(context.runId) === controller) {
				this.activeRunControllers.delete(context.runId);
			}
			this.cancelledRunIds.delete(context.runId);
		}
	}

	private async emitRuntimeError(
		sink: AgentRuntimeSink,
		logs: string[],
		input: { code: string; message: string },
	) {
		const message = `[Codex] ${input.message}`;
		logs.push(message);
		await sink.emit({
			type: "runtime_error",
			message,
			payload: { code: input.code, provider: "codex" },
		});
	}

	private async emitSupportWarning(
		sink: AgentRuntimeSink,
		logs: string[],
		input: { code: string; message: string; error: unknown },
	) {
		const message = `[Codex] ${input.message}`;
		logs.push(message);
		await sink.emit({
			type: "runtime_warning",
			message,
			payload: {
				code: input.code,
				provider: "codex",
				severity: "warning",
				error:
					input.error instanceof Error
						? input.error.message
						: String(input.error),
			},
		});
	}

	private isCancelled(context: AgentRunContext, signal?: AbortSignal) {
		return signal?.aborted || this.cancelledRunIds.has(context.runId);
	}

	private async recordUsage(input: {
		context: AgentRunContext;
		payload: unknown;
		durationMs: number;
		promptParts: ReturnType<typeof buildCodexRuntimePromptParts>;
		providerSessionKey: string | null;
	}) {
		const enabled = readPromptPartObservabilityEnabled(input.context);
		await recordCodexRuntimeUsageIfPresent({
			context: input.context,
			payload: input.payload,
			persistRuntimeUsage: this.persistRuntimeUsage,
			usageRecorder: this.usageRecorder,
			durationMs: input.durationMs,
			promptPartObservabilityEnabled: enabled,
			promptPartTokenEstimates: enabled
				? {
						userPromptTokens: input.promptParts.estimates.fullPromptTokens,
						systemPromptTokens:
							input.promptParts.estimates.developerInstructionsTokens,
					}
				: undefined,
			providerSessionKey: input.providerSessionKey,
			sourceSequence: 1,
		});
	}

	private finish(
		context: AgentRunContext,
		sink: AgentRuntimeSink,
		logs: string[],
		input: {
			terminalState: AgentRuntimeResult["terminalState"];
			finalReport: string;
			stoppedBy: AgentRuntimeResult["stoppedBy"];
			riskLevel: AgentRuntimeResult["riskLevel"];
		},
	) {
		return finishRun(this.closeoutHost(), context, sink, logs, input);
	}

	private closeoutHost() {
		return {
			threadFactory: this.threadFactory,
			runtimeSessionStore: this.runtimeSessionStore,
			collectWorkspaceDiff: this.collectWorkspaceDiff,
		};
	}

	async stop(runId: string): Promise<void> {
		this.cancelledRunIds.add(runId);
		this.activeRunControllers
			.get(runId)
			?.abort(new Error("CodexAgentRuntime stop requested."));
	}

	isRunning(runId: string): boolean {
		return this.activeRunControllers.has(runId);
	}
}

const recordCodexLlmUsage: RuntimeUsageRecorder = async (input) => {
	const { recordLlmUsage } = await import(
		"../../../services/llm-usage/repository"
	);
	return recordLlmUsage(input);
};
