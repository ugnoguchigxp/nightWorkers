import { gitDiffTool } from "../worker-tools/git";
import {
	changedFilesFromDiff,
	hasTodoProgressWarning,
	sleep,
	toContractWarningEvent,
	todoPayload,
} from "./codex-runtime-support";
import type { CodexThreadFactory } from "./codex-sdk/codex-sdk-client";
import { createCodexRuntimeThread } from "./codex-sdk/codex-sdk-client";
import {
	buildCodexRuntimeContractSnapshot,
	type CodexRuntimeAuditState,
} from "./codex-sdk/codex-sdk-mcp-audit";
import type { RuntimeSessionStateStore } from "./runtime-session-state";
import { summarizeRuntimeContractWarnings } from "./shared";
import type {
	AgentRunContext,
	AgentRuntimeResult,
	AgentRuntimeSink,
} from "./types";
import {
	normalizeVerificationCommand,
	verificationCommandsMatch,
} from "./verification-command";

type CodexRuntimeHost = {
	providerCapacityRetryLimit: number;
	providerCapacityRetryDelayMs: number;
	threadFactory?: CodexThreadFactory;
	runtimeSessionStore: RuntimeSessionStateStore;
	collectWorkspaceDiff: boolean;
};

export function canRetryProviderCapacity(
	runtime: CodexRuntimeHost,
	attemptIndex: number,
) {
	return attemptIndex < runtime.providerCapacityRetryLimit;
}

export async function emitProviderCapacityRetry(
	runtime: CodexRuntimeHost,
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
		maxRetries: runtime.providerCapacityRetryLimit,
		retryDelayMs: runtime.providerCapacityRetryDelayMs,
	};
	const scheduled = {
		type: "model_retry_scheduled" as const,
		message: `[Codex] Provider capacity reached; retry ${retryNumber}/${runtime.providerCapacityRetryLimit} scheduled.`,
		payload: retryPayload,
	};
	logs.push(scheduled.message);
	await sink.emit(scheduled);
	await sleep(runtime.providerCapacityRetryDelayMs, signal);
	const started = {
		type: "model_retry_started" as const,
		message: `[Codex] Provider capacity retry ${retryNumber}/${runtime.providerCapacityRetryLimit} started.`,
		payload: retryPayload,
	};
	logs.push(started.message);
	await sink.emit(started);
}

export async function emitMissingImportVerificationWarningIfNeeded(
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

export async function resolveCodexTerminalPolicy(
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

export async function createThread(
	runtime: CodexRuntimeHost,
	context: AgentRunContext,
	sink: AgentRuntimeSink,
	options: { forceFresh?: boolean } = {},
) {
	return createCodexRuntimeThread({
		context,
		threadFactory: runtime.threadFactory,
		forceFresh: options.forceFresh,
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
					await runtime.runtimeSessionStore.markRuntimeSessionStateResumeFailed(
						{
							id: event.stateId,
							error: event.error,
						},
					);
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

export function toCancelled(logContent: string): AgentRuntimeResult {
	return {
		terminalState: "cancelled",
		summary: "Codex Agent Runtime cancelled.",
		finalReport: "Codex Agent Runtime cancelled.",
		stoppedBy: "cancelled",
		riskLevel: "medium",
		logContent,
	};
}

export async function finishRun(
	runtime: CodexRuntimeHost,
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
			: await collectDiff(runtime, context, sink, logs, input.auditState);
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

export async function collectDiff(
	runtime: CodexRuntimeHost,
	context: AgentRunContext,
	sink: AgentRuntimeSink,
	logs: string[],
	auditState: CodexRuntimeAuditState,
): Promise<string> {
	if (!runtime.collectWorkspaceDiff) return "";
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
