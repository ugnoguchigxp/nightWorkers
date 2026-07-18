import type { RuntimeSessionStateStore } from "../../../services/runtime-session-state";
import { gitDiffTool } from "../../../services/worker-tools/git";
import { changedFilesFromDiff, todoPayload } from "./codex-runtime-support";
import type { CodexThreadFactory } from "./codex-sdk/codex-sdk-client";
import { createCodexRuntimeThread } from "./codex-sdk/codex-sdk-client";
import {
	buildCodexRuntimeContractSnapshot,
	type CodexRuntimeAuditState,
} from "./codex-sdk/codex-sdk-mcp-audit";
import { summarizeRuntimeContractWarnings } from "./shared";
import type {
	AgentRunContext,
	AgentRuntimeResult,
	AgentRuntimeSink,
} from "./types";

type CodexRuntimeHost = {
	threadFactory?: CodexThreadFactory;
	runtimeSessionStore: RuntimeSessionStateStore;
	collectWorkspaceDiff: boolean;
};

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
			if (event.status === "resume_failed") {
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
					message: "[Codex] Runtime session resume failed.",
					payload: {
						code: "codex_runtime_resume_failed",
						severity: "warning",
						message: "Codex runtime session resume failed.",
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
				: "Codex Agent Runtime failed."),
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
