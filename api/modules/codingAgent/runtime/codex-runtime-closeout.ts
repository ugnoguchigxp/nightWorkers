import type { RuntimeSessionStateStore } from "../../../services/runtime-session-state";
import { gitDiffTool } from "../../../services/worker-tools/git";
import { changedFilesFromDiff } from "./codex-runtime-support";
import type { CodexThreadFactory } from "./codex-sdk/codex-sdk-client";
import { createCodexRuntimeThread } from "./codex-sdk/codex-sdk-client";
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
) {
	return createCodexRuntimeThread({
		context,
		threadFactory: runtime.threadFactory,
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
						rawError: event.error,
						providerStateId: event.stateId ?? null,
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
		testResults?: unknown;
	},
): Promise<AgentRuntimeResult> {
	const diffPatch =
		input.collectDiff === false
			? ""
			: await collectDiff(runtime, context, sink, logs);
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
		},
	});
	return result;
}

export async function collectDiff(
	runtime: CodexRuntimeHost,
	context: AgentRunContext,
	sink: AgentRuntimeSink,
	logs: string[],
): Promise<string> {
	if (!runtime.collectWorkspaceDiff) return "";
	let result: Awaited<ReturnType<typeof gitDiffTool>>;
	try {
		result = await gitDiffTool({ repoRoot: context.repoRoot });
	} catch (error) {
		await emitDiffCollectionWarning(sink, logs, error);
		return "";
	}
	if (!result.ok) {
		await emitDiffCollectionWarning(sink, logs, result.error?.message);
		return "";
	}
	if (!result.payload.hasChanges) return "";
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
			diff: result.payload.diff,
			diffStat: result.payload.diffStat,
			hasChanges: result.payload.hasChanges,
		},
	});
	return result.payload.diff;
}

async function emitDiffCollectionWarning(
	sink: AgentRuntimeSink,
	logs: string[],
	error: unknown,
) {
	const message = "[Codex] Workspace diff could not be collected.";
	logs.push(message);
	await sink.emit({
		type: "runtime_warning",
		message,
		payload: {
			code: "CODEX_WORKSPACE_DIFF_COLLECTION_FAILED",
			provider: "codex",
			severity: "warning",
			error:
				error instanceof Error ? error.message : String(error || "unknown"),
		},
	});
}
