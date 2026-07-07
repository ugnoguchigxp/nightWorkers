import { recordLlmUsage } from "../llm-usage";
import { gitDiffTool } from "../worker-tools/git";
import { auditCodexMappedEvent } from "./codex-runtime-audit";
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
	changedFilesFromDiff,
	hasTodoProgressWarning,
	normalizeRetryDelayMs,
	normalizeRetryLimit,
	persistCodexProviderThreadIfPresent,
	readCodexRuntimeExecutionMode,
	readPromptPartObservabilityEnabled,
	sleep,
	toContractWarningEvent,
	todoPayload,
} from "./codex-runtime-support";
import {
	type CodexThreadFactory,
	createCodexRuntimeThread,
} from "./codex-sdk/codex-sdk-client";
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
	buildCodexRuntimeContractSnapshot,
	type CodexRuntimeAuditState,
	createCodexRuntimeAuditState,
} from "./codex-sdk/codex-sdk-mcp-audit";
import { buildCodexRuntimePromptParts } from "./codex-sdk/codex-sdk-runtime-prompt";
import {
	type RuntimeUsageRecorder,
	recordCodexRuntimeUsageIfPresent,
} from "./codex-sdk/codex-sdk-usage";
import { RuntimeSessionStateStore } from "./runtime-session-state";
import { summarizeRuntimeContractWarnings } from "./shared";
import type {
	AgentRunContext,
	AgentRuntime,
	AgentRuntimeResult,
	AgentRuntimeSink,
} from "./types";
import {
	normalizeVerificationCommand,
	verificationCommandsMatch,
} from "./verification-command";

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
	private readonly providerCapacityRetryLimit: number;
	private readonly providerCapacityRetryDelayMs: number;

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

		try {
			for (let attemptIndex = 0; ; attemptIndex += 1) {
				let finalText = "";
				let terminalState: AgentRuntimeResult["terminalState"] = "completed";
				let stoppedBy: AgentRuntimeResult["stoppedBy"] = "decision";
				let lastRuntimeError: CodexRuntimeFailureEvidence | null = null;
				const mapperState = createCodexEventMapperState();
				const attemptStartedAt = Date.now();

				if (signal?.aborted || this.cancelledRunIds.has(context.runId)) {
					controller.abort();
					return this.toCancelled(attemptIndex === 0 ? "" : logs.join("\n"));
				}

				try {
					const thread = await this.createThread(context, sink);
					const runtimePromptParts = buildCodexRuntimePromptParts(context);
					const promptPartObservabilityEnabled =
						readPromptPartObservabilityEnabled(context);
					const { events } = await thread.runStreamed(
						runtimePromptParts.prompt,
						{
							signal: controller.signal,
						},
					);

					for await (const event of events) {
						if (this.cancelledRunIds.has(context.runId)) {
							controller.abort();
							return this.toCancelled(logs.join("\n"));
						}
						const mappedEvents = mapCodexThreadEvent(event, mapperState);
						for (const mapped of mappedEvents) {
							const auditedEvents = await auditCodexMappedEvent(
								context,
								auditState,
								mapped,
							);
							for (const audited of auditedEvents) {
								logs.push(audited.message);
								await sink.emit(audited);
								if (this.persistRuntimeSessionState) {
									await persistCodexProviderThreadIfPresent(
										this.runtimeSessionStore,
										context,
										audited,
									);
								}
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
									finalReport: buildProjectImportCancelledReport(importOutcome),
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
								if (typeof payload?.text === "string") finalText = payload.text;
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
								completedFileChanges.push(...readCompletedFileChanges(mapped));
							}
						}
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
							return this.toCancelled(logs.join("\n"));
						}
						continue;
					}

					await this.emitMissingImportVerificationWarningIfNeeded(
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
						return this.toCancelled(logs.join("\n"));
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
							return this.toCancelled(logs.join("\n"));
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
		return attemptIndex < this.providerCapacityRetryLimit;
	}

	private async emitProviderCapacityRetry(
		sink: AgentRuntimeSink,
		logs: string[],
		attemptIndex: number,
		signal: AbortSignal,
	) {
		const retryNumber = attemptIndex + 1;
		const retryPayload = {
			provider: "codex",
			reason: "provider_capacity",
			retryNumber,
			maxRetries: this.providerCapacityRetryLimit,
			retryDelayMs: this.providerCapacityRetryDelayMs,
		};
		const scheduled = {
			type: "model_retry_scheduled" as const,
			message: `[Codex] Provider capacity reached; retry ${retryNumber}/${this.providerCapacityRetryLimit} scheduled.`,
			payload: retryPayload,
		};
		logs.push(scheduled.message);
		await sink.emit(scheduled);
		await sleep(this.providerCapacityRetryDelayMs, signal);
		const started = {
			type: "model_retry_started" as const,
			message: `[Codex] Provider capacity retry ${retryNumber}/${this.providerCapacityRetryLimit} started.`,
			payload: retryPayload,
		};
		logs.push(started.message);
		await sink.emit(started);
	}

	async stop(runId: string): Promise<void> {
		this.cancelledRunIds.add(runId);
	}

	private async emitMissingImportVerificationWarningIfNeeded(
		sink: AgentRuntimeSink,
		logs: string[],
		auditState: CodexRuntimeAuditState,
	) {
		if (!auditState.sawNightworkersImportProjectSuccess) return;
		if (auditState.recommendedVerificationCommands.length === 0) return;
		const postImportSuccessfulVerificationEvidence =
			auditState.verificationEvidence.filter(
				(evidence) =>
					evidence.exitCode === 0 &&
					auditState.importProjectSuccessSequence !== null &&
					evidence.sequence > auditState.importProjectSuccessSequence,
			);
		const recommendedCommands = auditState.recommendedVerificationCommands
			.map((command) => normalizeVerificationCommand(command))
			.filter((command): command is string => command !== null);
		const hasRecommendedMatch = postImportSuccessfulVerificationEvidence.some(
			(evidence) =>
				recommendedCommands.some((recommended) =>
					verificationCommandsMatch(evidence.normalizedCommand, recommended),
				),
		);
		if (hasRecommendedMatch) return;
		if (postImportSuccessfulVerificationEvidence.length > 0) {
			const firstEvidence = postImportSuccessfulVerificationEvidence[0];
			const warning = toContractWarningEvent(auditState, {
				code: "codex_import_project_recommended_verification_mismatch",
				severity: "warning",
				message:
					"nightworkers.import_project recommended verification commands were present, but successful post-import verification did not match a recommended command.",
				providerItemId: auditState.importProjectProviderItemId,
				toolName: "nightworkers.import_project",
				command: firstEvidence.command,
			});
			if (warning) {
				logs.push(warning.message);
				await sink.emit(warning);
			}
			return;
		}
		const warning = toContractWarningEvent(auditState, {
			code: "codex_import_project_verification_missing",
			severity: "warning",
			message:
				"nightworkers.import_project succeeded with recommended verification commands, but no successful verification command evidence was observed.",
			providerItemId: auditState.importProjectProviderItemId,
			toolName: "nightworkers.import_project",
		});
		if (warning) {
			logs.push(warning.message);
			await sink.emit(warning);
		}
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
	): Promise<typeof input> {
		if (input.terminalState !== "completed") {
			return input;
		}
		const planModeViolation = auditState.contractWarnings.find(
			(warning) =>
				warning.code === "codex_plan_mode_file_change" ||
				warning.code === "codex_plan_mode_mutating_tool",
		);
		if (planModeViolation) {
			const finalReportSuffix =
				"Codex planning mode mutation was observed; stopping for human review.";
			const finalReport = input.finalReport
				? `${input.finalReport}\n\n${finalReportSuffix}`
				: finalReportSuffix;
			return {
				terminalState: "needs_human",
				finalReport,
				stoppedBy: "tool_failure",
				riskLevel: "high",
			};
		}
		if (
			!auditState.sawHighRiskNativeImportCommand ||
			auditState.sawNightworkersImportProjectSuccess
		) {
			return input;
		}
		const warning = toContractWarningEvent(auditState, {
			code: "codex_native_import_without_import_project",
			severity: "error",
			message:
				"Codex native project import command completed without nightworkers.import_project success. Human review is required before treating the run as complete.",
			providerItemId: auditState.highRiskNativeImportProviderItemId,
			toolName: "command_execution",
			command: auditState.highRiskNativeImportCommand,
		});
		if (warning) {
			logs.push(warning.message);
			await sink.emit(warning);
		}
		const finalReportSuffix =
			"Codex native project import command was observed without nightworkers.import_project success; stopping for human review.";
		const finalReport = input.finalReport
			? `${input.finalReport}\n\n${finalReportSuffix}`
			: finalReportSuffix;
		return {
			terminalState: "needs_human",
			finalReport,
			stoppedBy: "tool_failure",
			riskLevel: "high",
		};
	}

	private async createThread(context: AgentRunContext, sink: AgentRuntimeSink) {
		return createCodexRuntimeThread({
			context,
			threadFactory: this.threadFactory,
			onResumeEvent: async (event) => {
				if (event.status === "reused") {
					await sink.emit({
						type: "runtime_started",
						message: "[Codex] Runtime session resume state reused.",
						payload: {
							provider: "codex",
							action: "runtime.resume_state_reused",
							resumeState: "reused",
							providerThreadId: event.providerThreadId,
							stateId: event.stateId ?? null,
						},
					});
					return;
				}
				if (event.status === "fallback_started_fresh") {
					if (event.stateId) {
						await this.runtimeSessionStore.markRuntimeSessionStateResumeFailed({
							id: event.stateId,
							error: event.error,
						});
					}
					await sink.emit({
						type: "runtime_warning",
						message:
							"[Codex] Runtime session resume failed; started a fresh thread.",
						payload: {
							code: "codex_runtime_resume_failed",
							severity: "warning",
							message:
								"Codex runtime session resume failed; started a fresh thread.",
							providerItemId: event.providerThreadId,
						},
					});
					return;
				}
				await sink.emit({
					type: "runtime_started",
					message:
						"[Codex] Runtime session resume state unavailable; starting fresh.",
					payload: {
						provider: "codex",
						action: "runtime.resume_state_missing",
						resumeState: "unavailable",
					},
				});
			},
		});
	}

	private toCancelled(logContent: string): AgentRuntimeResult {
		return {
			terminalState: "cancelled",
			summary: "Codex Agent Runtime cancelled.",
			finalReport: "Codex Agent Runtime cancelled.",
			stoppedBy: "cancelled",
			riskLevel: "medium",
			logContent,
		};
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
	): Promise<AgentRuntimeResult> {
		const diffPatch =
			input.collectDiff === false
				? ""
				: await this.collectDiff(context, sink, logs, input.auditState);
		const contractWarnings = [...input.auditState.contractWarnings];
		const contractWarningSummary =
			summarizeRuntimeContractWarnings(contractWarnings);
		const result: AgentRuntimeResult = {
			terminalState: input.terminalState,
			summary:
				input.finalReport ||
				(input.terminalState === "completed"
					? "Codex Agent Runtime completed."
					: DEFAULT_RESULT.summary),
			finalReport: input.finalReport,
			stoppedBy: input.stoppedBy,
			riskLevel: input.riskLevel,
			logContent: logs.join("\n"),
			diffPatch,
			contractWarnings,
			testResults: input.testResults,
		};
		await sink.emit({
			type: "runtime_finished",
			message: `[System] Codex Agent Runtime finished with terminalState=${result.terminalState}.`,
			payload: {
				provider: "codex",
				terminalState: result.terminalState,
				stoppedBy: result.stoppedBy,
				finalReport: result.finalReport,
				summary: result.summary,
				contractWarningSummary,
				contractWarnings,
				runtimeContract: buildCodexRuntimeContractSnapshot(input.auditState),
			},
		});
		return result;
	}

	private async collectDiff(
		context: AgentRunContext,
		sink: AgentRuntimeSink,
		logs: string[],
		auditState: CodexRuntimeAuditState,
	): Promise<string> {
		if (!this.collectWorkspaceDiff) return "";
		const result = await gitDiffTool({ repoRoot: context.repoRoot });
		if (!result.ok || !result.payload.hasChanges) return "";
		const changedFiles = changedFilesFromDiff(result.payload.diff);
		if (
			!auditState.sawNightworkersTodoMutation &&
			!hasTodoProgressWarning(auditState)
		) {
			const warning = toContractWarningEvent(
				auditState,
				auditState.sawNightworkersTodoList
					? {
							code: "codex_todo_progress_list_only",
							severity: "warning",
							message:
								"Codex completed with workspace changes after nightworkers.todo_list operation=list only; list is not progress.",
							toolName: "nightworkers.todo_list",
							changedFiles,
						}
					: {
							code: "codex_todo_progress_missing",
							severity: "warning",
							message:
								"Codex completed with workspace changes before any nightworkers.todo_list progress mutation.",
							toolName: "nightworkers.todo_list",
							changedFiles,
						},
			);
			if (warning) {
				logs.push(warning.message);
				await sink.emit(warning);
			}
		}
		const message = `[Codex] Workspace diff collected: ${changedFiles.length || "unknown"} file(s).`;
		logs.push(message);
		await sink.emit({
			type: "diff_collected",
			message,
			payload: {
				provider: "codex",
				source: "post_run_git_diff",
				changedFiles,
				...todoPayload(auditState.lastCurrentTodo),
				diff: result.payload.diff,
				diffStat: result.payload.diffStat,
				hasChanges: result.payload.hasChanges,
			},
		});
		return result.payload.diff;
	}
}
