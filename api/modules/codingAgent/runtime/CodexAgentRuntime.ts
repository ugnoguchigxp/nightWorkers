import { randomUUID } from "node:crypto";
import { RuntimeSessionStateStore } from "../../../services/runtime-session-state";
import { digestText } from "../../../services/text-digest";
import type { FinalizeGuardResult } from "../application/run-finalize-controller";
import { runFinalizeController } from "../application/run-finalize-controller";
import { loadCodingAgentContextPacket } from "../context";
import { buildCodingAgentCompletionRecoveryFeedback } from "../context/recovery-guidance";
import {
	buildCompletionAssurancePassedEvent,
	buildCompletionReconciliationTestResults,
} from "./codex-completion-reconciliation";
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

const STREAM_DEADLINE_REACHED = Symbol("codex-stream-deadline-reached");

type OpenProviderItem = {
	id: string;
	type: string;
};

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
	private readonly evaluateCompletionCandidate: (input: {
		runId: string;
		repositoryRoot: string;
		candidateRevision?: number;
		finalCandidate?: string;
	}) => Promise<FinalizeGuardResult>;

	constructor(
		input: {
			threadFactory?: CodexThreadFactory;
			runtimeSessionStore?: RuntimeSessionStateStore;
			persistRuntimeSessionState?: boolean;
			collectWorkspaceDiff?: boolean;
			persistRuntimeUsage?: boolean;
			usageRecorder?: RuntimeUsageRecorder;
			evaluateCompletionCandidate?: CodexAgentRuntime["evaluateCompletionCandidate"];
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
		this.evaluateCompletionCandidate =
			input.evaluateCompletionCandidate ??
			((candidate) => runFinalizeController.evaluateCandidate(candidate));
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
		let resolveStreamDeadline!: (value: typeof STREAM_DEADLINE_REACHED) => void;
		const streamDeadline = new Promise<typeof STREAM_DEADLINE_REACHED>(
			(resolve) => {
				resolveStreamDeadline = resolve;
			},
		);
		const timeout = setTimeout(() => {
			timedOut = true;
			controller.abort(
				new Error(
					`CodexAgentRuntime timed out after ${context.timeoutSeconds}s`,
				),
			);
			resolveStreamDeadline(STREAM_DEADLINE_REACHED);
		}, Math.max(1, context.timeoutSeconds) * 1000);
		const logs: string[] = [];
		let finalReport = "";
		let runtimeErrorReport = "";

		try {
			if (this.isCancelled(context, signal))
				return toCancelled(logs.join("\n"));
			const promptParts = buildCodexRuntimePromptParts(context);
			const thread = await createThread(
				this.closeoutHost(),
				context,
				sink,
				promptParts.developerInstructions,
			);
			let turnInput = buildCodexRuntimeTurnInput(
				context,
				promptParts.prompt,
				false,
			);
			for (
				let completionAttempt = 0;
				completionAttempt < 2;
				completionAttempt += 1
			) {
				finalReport = "";
				runtimeErrorReport = "";
				const requestId = randomUUID();
				await sink.emit({
					type: "model_response_started",
					message: "[Codex] Provider request started.",
					payload: {
						requestId,
						provider: "codex",
						systemContextAudit: promptParts.systemContextAudit,
						developerInstructionsRenderedHash:
							promptParts.systemContextAudit[0]?.manifest.renderedHash ?? null,
						userPromptSha256: digestText(
							typeof turnInput === "string"
								? turnInput
								: JSON.stringify(turnInput),
						),
					},
				});
				const turnStartedAt = Date.now();
				const streamedTurn = await Promise.race([
					thread.runStreamed(turnInput, { signal: controller.signal }),
					streamDeadline,
				]);
				if (streamedTurn === STREAM_DEADLINE_REACHED) {
					await this.emitRuntimeError(sink, logs, {
						code: "CODEX_STREAM_DEADLINE_EXCEEDED",
						message:
							"Codex stream did not start before the host execution deadline.",
					});
					return this.finish(context, sink, logs, {
						terminalState: "timed_out",
						finalReport,
						stoppedBy: "budget",
						riskLevel: "high",
					});
				}
				const { events } = streamedTurn;
				const mapperState = createCodexEventMapperState({
					repoRoot: context.repoRoot,
				});
				let providerSessionKey: string | null = null;
				let turnCompleted = false;
				let runtimeFailed = false;
				const openProviderItems = new Map<string, OpenProviderItem>();
				const eventIterator = events[Symbol.asyncIterator]();

				while (true) {
					const nextEvent = await Promise.race([
						eventIterator.next(),
						streamDeadline,
					]);
					if (nextEvent === STREAM_DEADLINE_REACHED) break;
					if (nextEvent.done) break;
					const providerEvent = nextEvent.value;
					updateOpenProviderItems(openProviderItems, providerEvent);
					for (const event of mapCodexThreadEvent(providerEvent, mapperState)) {
						providerSessionKey = updateCodexSessionKey(
							providerSessionKey,
							event,
						);
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
									sourceSequence: completionAttempt + 1,
								});
							} catch (error) {
								await this.emitSupportWarning(sink, logs, {
									code: "CODEX_USAGE_PERSIST_FAILED",
									message: "Codex usage could not be persisted.",
									error,
								});
							}
						}
						if (event.type === "runtime_error") {
							runtimeFailed = true;
							if (!runtimeErrorReport) runtimeErrorReport = event.message;
						}
					}
					if (turnCompleted || runtimeFailed) {
						closeProviderIteratorWithoutWaiting(eventIterator);
						break;
					}
				}

				if (timedOut) {
					await this.emitRuntimeError(sink, logs, {
						code: "CODEX_STREAM_DEADLINE_EXCEEDED",
						message:
							"Codex event stream did not reach a terminal event before the host execution deadline.",
					});
					closeProviderIteratorWithoutWaiting(eventIterator);
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
							message:
								"Codex event stream ended without a terminal turn event.",
						});
					}
					if (!runtimeFailed && turnCompleted && !finalReport.trim()) {
						await this.emitRuntimeError(sink, logs, {
							code: "PROVIDER_FINAL_RESPONSE_MISSING",
							message:
								"Codex turn completed without a final assistant message.",
						});
					}
					return this.finish(context, sink, logs, {
						terminalState: "failed",
						finalReport: runtimeFailed
							? runtimeErrorReport || finalReport
							: finalReport,
						stoppedBy: "llm_error",
						riskLevel: "high",
					});
				}
				if (openProviderItems.size > 0) {
					const items = [...openProviderItems.values()];
					const message =
						"Codex turn completed while provider items were still open; manual review is required.";
					logs.push(`[Codex] ${message}`);
					await sink.emit({
						type: "runtime_warning",
						message: `[Codex] ${message}`,
						payload: {
							code: "PROVIDER_TERMINAL_WITH_OPEN_ITEMS",
							provider: "codex",
							severity: "warning",
							openItems: items,
						},
					});
					return this.finish(context, sink, logs, {
						terminalState: "needs_review",
						finalReport,
						stoppedBy: "tool_failure",
						riskLevel: "high",
					});
				}
				const completion = await this.evaluateCompletionCandidate({
					runId: context.runId,
					repositoryRoot: context.repoRoot,
					candidateRevision: completionAttempt + 1,
					finalCandidate: finalReport,
				});
				if (completion.allowFinalize) {
					await sink.emit(
						buildCompletionAssurancePassedEvent(completion, completionAttempt),
					);
					return this.finish(context, sink, logs, {
						terminalState: "completed",
						finalReport,
						stoppedBy: "decision",
						riskLevel: "medium",
						testResults: buildCompletionReconciliationTestResults(
							completion,
							completionAttempt,
							true,
						),
					});
				}
				if (completion.code === "RUN_NOT_FOUND") {
					return this.finish(context, sink, logs, {
						terminalState: "needs_review",
						finalReport,
						stoppedBy: "decision",
						riskLevel: "high",
						testResults: { completionReadiness: completion.snapshot },
					});
				}
				if (completion.code === "RUN_NEEDS_HUMAN") {
					return this.finish(context, sink, logs, {
						terminalState: "needs_human",
						finalReport,
						stoppedBy: "decision",
						riskLevel: "medium",
						testResults: { completionReadiness: completion.snapshot },
					});
				}
				if (completionAttempt === 1) {
					await sink.emit({
						type: "runtime_warning",
						message:
							"[Codex] Completion reconciliation limit reached; manual review is required.",
						payload: {
							code: "CODEX_COMPLETION_RECONCILIATION_LIMIT_REACHED",
							provider: "codex",
							severity: "warning",
							reconciliationCount: completionAttempt + 1,
							completion,
						},
					});
					return this.finish(context, sink, logs, {
						terminalState: "needs_review",
						finalReport,
						stoppedBy: "decision",
						riskLevel: "high",
						testResults: buildCompletionReconciliationTestResults(
							completion,
							completionAttempt + 1,
							false,
						),
					});
				}
				const recoveryPacket = await loadCodingAgentContextPacket(
					context.runId,
				);
				turnInput = buildCodingAgentCompletionRecoveryFeedback({
					taskId: context.taskId,
					runId: context.runId,
					repositoryRoot: context.repoRoot,
					latestUserMessage: context.latestUserMessage,
					packet: recoveryPacket,
					finalCandidate: finalReport,
					precondition: {
						code: completion.code,
						message: completion.message,
					},
					currentSnapshot: completion.snapshot,
				});
				await sink.emit({
					type: "runtime_warning",
					message:
						"[Codex] Completion readiness has unresolved discrepancies; continuing the same thread.",
					payload: {
						code: "CODEX_COMPLETION_RECONCILIATION_REQUIRED",
						provider: "codex",
						severity: "warning",
						reconciliationCount: completionAttempt + 1,
						completion,
					},
				});
			}
			return this.finish(context, sink, logs, {
				terminalState: "needs_review",
				finalReport,
				stoppedBy: "decision",
				riskLevel: "high",
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
		sourceSequence: number;
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
			sourceSequence: input.sourceSequence,
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
			testResults?: unknown;
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

function updateOpenProviderItems(
	openItems: Map<string, OpenProviderItem>,
	event: unknown,
) {
	if (!event || typeof event !== "object") return;
	const record = event as Record<string, unknown>;
	if (record.type !== "item.started" && record.type !== "item.completed")
		return;
	if (!record.item || typeof record.item !== "object") return;
	const item = record.item as Record<string, unknown>;
	if (typeof item.id !== "string") return;
	if (record.type === "item.completed") {
		openItems.delete(item.id);
		return;
	}
	openItems.set(item.id, {
		id: item.id,
		type: typeof item.type === "string" ? item.type : "unknown",
	});
}

function closeProviderIteratorWithoutWaiting(iterator: AsyncIterator<unknown>) {
	if (!iterator.return) return;
	try {
		void Promise.resolve(iterator.return()).catch(() => undefined);
	} catch {
		// Provider cleanup is best-effort and must never block Run closeout.
	}
}

const recordCodexLlmUsage: RuntimeUsageRecorder = async (input) => {
	const { recordLlmUsage } = await import(
		"../../../services/llm-usage/repository"
	);
	return recordLlmUsage(input);
};
