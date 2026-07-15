import { recordLlmUsage } from "../llm-usage";
import { runStateCardProjector } from "../run-control/context-projector";
import { runFinalizeController } from "../run-control/finalize-controller";
import { runControlService } from "../run-control/run-control-service";
import { readRunControlKernelMode } from "../run-control/settings";
import { auditCodexMappedEvent } from "./codex-runtime-audit";
import {
	canRetryProviderCapacity,
	createThread,
	emitMissingImportVerificationWarningIfNeeded,
	emitProviderCapacityRetry,
	finishRun,
	resolveCodexTerminalPolicy,
	toCancelled,
} from "./codex-runtime-closeout";
import {
	buildCodexFailureReport,
	type CodexObservedFileChange,
	type CodexRuntimeFailureEvidence,
	DEFAULT_PROVIDER_CAPACITY_RETRY_DELAY_MS,
	DEFAULT_PROVIDER_CAPACITY_RETRY_LIMIT,
	DEFAULT_RESULT,
	parseCodexExecExitError,
	readCompletedFileChanges,
	readRuntimeFailureEvidence,
} from "./codex-runtime-failure-report";
import {
	buildCurrentTodoCheckpointPrompt,
	mergeRecoveryReport,
	observeCodexRunControlEvent,
	toRunTerminalReason,
} from "./codex-runtime-loop-support";
import {
	updateCodexSessionKey as k,
	normalizeRetryDelayMs,
	normalizeRetryLimit,
	persistCodexProviderThreadIfPresent,
	readCodexRuntimeExecutionMode,
	readPromptPartObservabilityEnabled,
} from "./codex-runtime-support";
import type { CodexThreadFactory } from "./codex-sdk/codex-sdk-client";
import {
	createCodexEventMapperState,
	mapCodexThreadEvent,
} from "./codex-sdk/codex-sdk-event-adapter";
import {
	buildProjectImportCancelledReport,
	buildProjectImportFailureReport,
	getProjectImportOutcome,
} from "./codex-sdk/codex-sdk-import-policy";
import {
	addContractWarning,
	type CodexRuntimeAuditState,
	createCodexRuntimeAuditState,
} from "./codex-sdk/codex-sdk-mcp-audit";
import {
	buildCodexRuntimePromptParts,
	buildCodexRuntimeTurnInput,
} from "./codex-sdk/codex-sdk-runtime-prompt";
import {
	type RuntimeUsageRecorder,
	recordCodexRuntimeUsageIfPresent,
} from "./codex-sdk/codex-sdk-usage";
import { RuntimeSessionStateStore } from "./runtime-session-state";
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

export class CodexAgentRuntime implements AgentRuntime {
	readonly kind = "codex-agent" as const;
	private cancelledRunIds = new Set<string>();
	private readonly threadFactory?: CodexThreadFactory;
	private readonly runtimeSessionStore: RuntimeSessionStateStore;
	private readonly persistRuntimeSessionState: boolean;
	private readonly collectWorkspaceDiff: boolean;
	private readonly persistRuntimeUsage: boolean;
	private readonly usageRecorder: RuntimeUsageRecorder;
	readonly providerCapacityRetryLimit: number;
	readonly providerCapacityRetryDelayMs: number;

	constructor(
		input: {
			threadFactory?: CodexThreadFactory;
			runtimeSessionStore?: RuntimeSessionStateStore;
			persistRuntimeSessionState?: boolean;
			collectWorkspaceDiff?: boolean;
			persistRuntimeUsage?: boolean;
			usageRecorder?: RuntimeUsageRecorder;
			providerCapacityRetryLimit?: number;
			providerCapacityRetryDelayMs?: number;
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
		this.usageRecorder = input.usageRecorder ?? recordLlmUsage;
		this.providerCapacityRetryLimit = normalizeRetryLimit(
			input.providerCapacityRetryLimit,
			DEFAULT_PROVIDER_CAPACITY_RETRY_LIMIT,
		);
		this.providerCapacityRetryDelayMs = normalizeRetryDelayMs(
			input.providerCapacityRetryDelayMs,
			input.threadFactory ? 0 : DEFAULT_PROVIDER_CAPACITY_RETRY_DELAY_MS,
		);
	}

	async start(
		context: AgentRunContext,
		sink: AgentRuntimeSink,
		signal?: AbortSignal,
	): Promise<AgentRuntimeResult> {
		const controller = new AbortController();
		const abort = () => controller.abort();
		signal?.addEventListener("abort", abort, { once: true });
		const logs: string[] = [];
		const auditState = createCodexRuntimeAuditState({
			executionMode: readCodexRuntimeExecutionMode(context),
		});
		const completedFileChanges: CodexObservedFileChange[] = [];
		let providerTurnSequence = 0;
		try {
			for (let attemptIndex = 0; ; attemptIndex += 1) {
				let finalText = "";
				let preRecoveryFinalText: string | null = null;
				let terminalState = "completed" as AgentRuntimeResult["terminalState"];
				let stoppedBy: AgentRuntimeResult["stoppedBy"] = "decision";
				let lastRuntimeError: CodexRuntimeFailureEvidence | null = null;
				const mapperState = createCodexEventMapperState({
					repoRoot: context.repoRoot,
				});
				const attemptStartedAt = Date.now();
				if (signal?.aborted || this.cancelledRunIds.has(context.runId)) {
					controller.abort();
					return toCancelled(attemptIndex === 0 ? "" : logs.join("\n"));
				}

				try {
					let thread = await this.createThread(context, sink);
					const runtimePromptParts = buildCodexRuntimePromptParts(context);
					const promptPartObservabilityEnabled =
						readPromptPartObservabilityEnabled(context);
					let nextPrompt = runtimePromptParts.prompt;
					let checkpointPromptsSent = 0;
					let finalizeRecoveryPromptsSent = 0;
					let isCheckpointPrompt = false;
					let imageInputSent = false;
					let providerSessionKey: string | null = null;
					for (;;) {
						const turnInput = buildCodexRuntimeTurnInput(
							context,
							nextPrompt,
							imageInputSent,
						);
						imageInputSent ||= typeof turnInput !== "string";
						const sourceSequence = ++providerTurnSequence;
						const { events } = await thread.runStreamed(turnInput, {
							signal: controller.signal,
						});
						for await (const event of events) {
							if (this.cancelledRunIds.has(context.runId)) {
								controller.abort();
								return toCancelled(logs.join("\n"));
							}
							const mappedEvents = mapCodexThreadEvent(event, mapperState);
							for (const mapped of mappedEvents) {
								const auditedEvents = await auditCodexMappedEvent(
									context,
									auditState,
									mapped,
								);
								for (const audited of auditedEvents) {
									providerSessionKey = k(providerSessionKey, audited);
									logs.push(audited.message);
									await sink.emit(audited);
									if (this.persistRuntimeSessionState) {
										await persistCodexProviderThreadIfPresent(
											this.runtimeSessionStore,
											context,
											audited,
										);
									}
									await observeCodexRunControlEvent(
										context,
										audited,
										auditState.eventSequence,
									);
								}
								const importOutcome = getProjectImportOutcome(mapped);
								if (importOutcome?.kind === "cancelled") {
									addContractWarning(auditState, {
										code: "codex_import_project_cancelled",
										severity: "error",
										message:
											"nightworkers.import_project was cancelled. Fallback implementation is forbidden.",
										providerItemId: importOutcome.providerItemId,
										toolName: importOutcome.toolName,
									});
									return this.finishRun(context, sink, logs, {
										terminalState: "cancelled",
										finalReport:
											buildProjectImportCancelledReport(importOutcome),
										stoppedBy: "cancelled",
										riskLevel: "medium",
										collectDiff: false,
										auditState,
									});
								}
								if (importOutcome?.kind === "failed") {
									addContractWarning(auditState, {
										code: "codex_import_project_failed",
										severity: "error",
										message:
											"nightworkers.import_project failed. Fallback implementation is forbidden.",
										providerItemId: importOutcome.providerItemId,
										toolName: importOutcome.toolName,
									});
									if (importOutcome.retryableTransportCancel) {
										const diagnosticMessage =
											"[System] nightworkers.import_project was cancelled before the MCP server returned a tool result. Automatic retry is disabled.";
										logs.push(diagnosticMessage);
										await sink.emit({
											type: "runtime_error",
											message: diagnosticMessage,
											payload: {
												provider: "codex",
												toolName: importOutcome.toolName,
												error: importOutcome.error,
												reason: "project_import_transport_cancelled",
												providerItemId: importOutcome.providerItemId,
											},
										});
									}
									finalText = buildProjectImportFailureReport(importOutcome);
									return this.finishRun(context, sink, logs, {
										terminalState: "needs_human",
										finalReport: finalText,
										stoppedBy: "tool_failure",
										riskLevel: "high",
										collectDiff: false,
										auditState,
									});
								}
								if (mapped.type === "model_response_finished") {
									const payload = mapped.payload as
										| { text?: unknown }
										| undefined;
									if (
										!isCheckpointPrompt &&
										typeof payload?.text === "string"
									) {
										finalText = preRecoveryFinalText
											? mergeRecoveryReport(preRecoveryFinalText, payload.text)
											: payload.text;
									}
									await recordCodexRuntimeUsageIfPresent({
										context,
										payload: mapped.payload,
										persistRuntimeUsage: this.persistRuntimeUsage,
										usageRecorder: this.usageRecorder,
										durationMs: Date.now() - attemptStartedAt,
										promptPartObservabilityEnabled,
										promptPartTokenEstimates: promptPartObservabilityEnabled
											? {
													latestUserMessageTokens:
														context.contextSnapshot.conversationContext?.usage
															?.latestUserMessageTokens,
													stateCardTokens:
														context.contextSnapshot.conversationContext?.usage
															?.stateCardTokens,
													userPromptTokens:
														runtimePromptParts.estimates.requestTokens,
													systemPromptTokens:
														runtimePromptParts.estimates.runtimeContractTokens,
												}
											: undefined,
										providerSessionKey,
										sourceSequence,
									});
								}
								if (mapped.type === "runtime_error") {
									terminalState = "failed";
									stoppedBy = "llm_error";
									lastRuntimeError = readRuntimeFailureEvidence(mapped);
									finalText = buildCodexFailureReport({
										terminalError: lastRuntimeError,
										execExitError: null,
										completedFileChanges,
									}).summary;
								}
								if (mapped.type === "diff_collected") {
									completedFileChanges.push(
										...readCompletedFileChanges(mapped),
									);
								}
							}
						}
						if (terminalState !== "completed") break;
						if (
							readRunControlKernelMode(context) === "enforce" &&
							finalText.trim()
						) {
							const finalizeGuard =
								await runFinalizeController.evaluateCandidate({
									runId: context.runId,
									allowedOpenTodoProcedureIds: ["final_completion_report"],
								});
							if (!finalizeGuard.allowFinalize) {
								if (
									finalizeRecoveryPromptsSent === 0 &&
									finalizeGuard.recoveryCard
								) {
									finalizeRecoveryPromptsSent += 1;
									isCheckpointPrompt = false;
									preRecoveryFinalText = finalText.trim() || null;
									const stateCard = await runStateCardProjector
										.build(context)
										.catch(() => null);
									nextPrompt = [
										finalizeGuard.recoveryCard,
										"[NightWorkers リカバリ報告契約]\nこれはRun全体の最終報告を作り直すターンではありません。不足条件の解消と、このリカバリで新しく得た事実だけを短く報告してください。既存の最終報告候補はruntime側で保持されます。",
										stateCard?.content
											? `[Current Run State Card]\n${stateCard.content}`
											: null,
									]
										.filter(Boolean)
										.join("\n\n");
									const rotatedState = await runControlService.rotateContext(
										context.runId,
									);
									thread = await this.createThread(context, sink, {
										forceFresh: true,
									});
									const message =
										"[System] Run Control finalize recovery prompt queued.";
									logs.push(message);
									await sink.emit({
										type: "supervisor_decision",
										message,
										payload: {
											provider: "codex",
											reason: "run_control_finalize_recovery",
											code: finalizeGuard.code,
											missingConditions: finalizeGuard.missingConditions,
											contextEpoch: rotatedState?.contextEpoch ?? null,
											providerSession: "fresh",
										},
									});
									continue;
								}
								terminalState = "needs_human";
								stoppedBy = "tool_failure";
								finalText = [
									finalText,
									finalizeGuard.message,
									finalizeGuard.recoveryCard,
								]
									.filter(Boolean)
									.join("\n\n");
								break;
							}
						}
						const checkpointPrompt = await buildCurrentTodoCheckpointPrompt(
							context,
							auditState,
							checkpointPromptsSent,
						);
						if (!checkpointPrompt) break;
						checkpointPromptsSent += 1;
						isCheckpointPrompt = true;
						nextPrompt = checkpointPrompt;
						const message =
							"[System] Codex current Todo checkpoint prompt queued.";
						logs.push(message);
						await sink.emit({
							type: "supervisor_decision",
							message,
							payload: {
								provider: "codex",
								reason: "current_todo_checkpoint",
								prompt: checkpointPrompt,
							},
						});
					}

					if (
						terminalState === "failed" &&
						lastRuntimeError?.reason === "provider_capacity" &&
						this.canRetryProviderCapacity(attemptIndex)
					) {
						await this.emitProviderCapacityRetry(
							sink,
							logs,
							attemptIndex,
							controller.signal,
						);
						if (
							controller.signal.aborted ||
							this.cancelledRunIds.has(context.runId)
						) {
							return toCancelled(logs.join("\n"));
						}
						continue;
					}
					await emitMissingImportVerificationWarningIfNeeded(
						sink,
						logs,
						auditState,
					);
					const terminalPolicy = await this.resolveCodexTerminalPolicy(
						sink,
						logs,
						auditState,
						{
							terminalState,
							finalReport: finalText,
							stoppedBy,
							riskLevel: terminalState === "completed" ? "medium" : "high",
						},
					);
					if (readRunControlKernelMode(context) === "enforce") {
						await runFinalizeController.terminalize(
							context.runId,
							toRunTerminalReason(terminalPolicy.terminalState),
						);
					}
					return this.finishRun(context, sink, logs, {
						terminalState: terminalPolicy.terminalState,
						finalReport: terminalPolicy.finalReport,
						stoppedBy: terminalPolicy.stoppedBy,
						riskLevel: terminalPolicy.riskLevel,
						auditState,
					});
				} catch (err) {
					if (
						controller.signal.aborted ||
						this.cancelledRunIds.has(context.runId)
					) {
						return toCancelled(logs.join("\n"));
					}
					const message = err instanceof Error ? err.message : String(err);
					const execExitError = parseCodexExecExitError(message);
					const failureReport = buildCodexFailureReport({
						terminalError: lastRuntimeError,
						execExitError,
						unknownErrorMessage: execExitError ? null : message,
						completedFileChanges,
					});
					if (
						failureReport.reason === "provider_capacity" &&
						this.canRetryProviderCapacity(attemptIndex)
					) {
						await this.emitProviderCapacityRetry(
							sink,
							logs,
							attemptIndex,
							controller.signal,
						);
						if (
							controller.signal.aborted ||
							this.cancelledRunIds.has(context.runId)
						) {
							return toCancelled(logs.join("\n"));
						}
						continue;
					}
					for (const diagnostic of failureReport.recoveredToolFailures) {
						await sink.emit({
							type: "runtime_warning",
							message: `[Codex Diagnostic] ${diagnostic.message}`,
							payload: {
								code: "recovered_tool_failure",
								severity: "warning",
								message: diagnostic.message,
								toolName: "apply_patch",
								changedFiles: diagnostic.filePath ? [diagnostic.filePath] : [],
							},
						});
					}
					await sink.emit({
						type: "runtime_error",
						message: `[System Error] ${failureReport.summary}`,
						payload: {
							provider: "codex",
							error: failureReport.summary,
							rawError: message,
							terminalReason: failureReport.reason,
							diagnosticKind: execExitError
								? "codex_exec_nonzero"
								: "runtime_error",
							recoveredToolFailures: failureReport.recoveredToolFailures,
							unrecoveredToolFailures: failureReport.unrecoveredToolFailures,
						},
					});
					return {
						...DEFAULT_RESULT,
						summary: failureReport.summary,
						finalReport: failureReport.summary,
						logContent: [...logs, ...failureReport.diagnostics].join("\n"),
						contractWarnings: auditState.contractWarnings,
						testResults: {
							codexFailure: {
								terminalReason: failureReport.reason,
								execExitDetail: failureReport.execExitError?.detail ?? null,
								recoveredToolFailures: failureReport.recoveredToolFailures,
								unrecoveredToolFailures: failureReport.unrecoveredToolFailures,
							},
						},
					};
				}
			}
		} finally {
			signal?.removeEventListener("abort", abort);
		}
	}

	private canRetryProviderCapacity(attemptIndex: number) {
		return canRetryProviderCapacity(this.closeoutHost(), attemptIndex);
	}

	private async emitProviderCapacityRetry(
		sink: AgentRuntimeSink,
		logs: string[],
		attemptIndex: number,
		signal: AbortSignal,
	) {
		return emitProviderCapacityRetry(
			this.closeoutHost(),
			sink,
			logs,
			attemptIndex,
			signal,
		);
	}

	private async resolveCodexTerminalPolicy(
		sink: AgentRuntimeSink,
		logs: string[],
		auditState: CodexRuntimeAuditState,
		input: {
			terminalState: AgentRuntimeResult["terminalState"];
			finalReport: string;
			stoppedBy: AgentRuntimeResult["stoppedBy"];
			riskLevel: AgentRuntimeResult["riskLevel"];
		},
	) {
		return resolveCodexTerminalPolicy(sink, logs, auditState, input);
	}

	private async createThread(
		context: AgentRunContext,
		sink: AgentRuntimeSink,
		options: { forceFresh?: boolean } = {},
	) {
		return createThread(this.closeoutHost(), context, sink, options);
	}

	private async finishRun(
		context: AgentRunContext,
		sink: AgentRuntimeSink,
		logs: string[],
		input: {
			terminalState: AgentRuntimeResult["terminalState"];
			finalReport: string;
			stoppedBy: AgentRuntimeResult["stoppedBy"];
			riskLevel: AgentRuntimeResult["riskLevel"];
			collectDiff?: boolean;
			auditState: CodexRuntimeAuditState;
			testResults?: unknown;
		},
	) {
		return finishRun(this.closeoutHost(), context, sink, logs, input);
	}

	private closeoutHost() {
		return {
			providerCapacityRetryLimit: this.providerCapacityRetryLimit,
			providerCapacityRetryDelayMs: this.providerCapacityRetryDelayMs,
			threadFactory: this.threadFactory,
			runtimeSessionStore: this.runtimeSessionStore,
			collectWorkspaceDiff: this.collectWorkspaceDiff,
		};
	}

	async stop(runId: string): Promise<void> {
		this.cancelledRunIds.add(runId);
	}
}
