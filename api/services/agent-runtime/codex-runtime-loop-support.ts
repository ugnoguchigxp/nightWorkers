import { runControlService } from "../run-control/run-control-service";
import { readRunControlKernelMode } from "../run-control/settings";
import { readCurrentTodoEvidence } from "./codex-runtime-support";
import type { CodexRuntimeAuditState } from "./codex-sdk/codex-sdk-mcp-audit";
import type {
	AgentRunContext,
	AgentRuntimeResult,
	AgentRuntimeSink,
} from "./types";

export function mergeRecoveryReport(candidate: string, recoveryUpdate: string) {
	const base = candidate.trim();
	const update = recoveryUpdate.trim();
	if (!base) return update;
	if (!update || update === base) return base;
	return `${base}\n\nリカバリ追記:\n${update}`;
}

export async function observeCodexRunControlEvent(
	context: AgentRunContext,
	event: Parameters<AgentRuntimeSink["emit"]>[0],
	sequence: number,
) {
	if (readRunControlKernelMode(context) === "disabled") return;
	const payload =
		event.payload &&
		typeof event.payload === "object" &&
		!Array.isArray(event.payload)
			? (event.payload as Record<string, unknown>)
			: {};
	if (event.type === "diff_collected" && Array.isArray(payload.changedFiles)) {
		await runControlService.observeProgress({
			runId: context.runId,
			effect: "workspace_mutation",
			sequence,
		});
		return;
	}
	if (
		event.type === "tool_call_finished" &&
		payload.toolName === "command_execution" &&
		(payload.commandClass === "verification" ||
			payload.commandClass === "broad_verification")
	) {
		await runControlService.observeProgress({
			runId: context.runId,
			effect: "verification",
			sequence,
		});
	}
}

export function toRunTerminalReason(
	state: AgentRuntimeResult["terminalState"],
): "completed" | "blocked" | "cancelled" | "needs_human" | "runtime_failed" {
	if (state === "completed") return "completed";
	if (state === "cancelled") return "cancelled";
	if (state === "needs_human") return "needs_human";
	if (state === "blocked" || state === "timed_out") return "blocked";
	return "runtime_failed";
}

export async function buildCurrentTodoCheckpointPrompt(
	context: AgentRunContext,
	auditState: CodexRuntimeAuditState,
	checkpointPromptsSent: number,
) {
	if (checkpointPromptsSent > 0) return null;
	if (auditState.lastFileChangeSequence === null) return null;
	if (
		auditState.lastProgressValidSequence !== null &&
		auditState.lastProgressValidSequence >= auditState.lastFileChangeSequence
	) {
		return null;
	}
	const staleBroadVerification = auditState.verificationEvidence.some(
		(evidence) =>
			evidence.commandClass === "broad_verification" &&
			evidence.sequence > (auditState.lastFileChangeSequence ?? 0),
	);
	if (!staleBroadVerification) return null;
	const todoEvidence = await readCurrentTodoEvidence(context);
	const currentTodo = todoEvidence.todo;
	if (!currentTodo) return null;
	return [
		"[NightWorkers Current Todo Checkpoint]",
		`Current Todo #${currentTodo.seq}: ${currentTodo.title}`,
		`この Todo は完了済みですか？完了済みなら nightworkers.todo_list operation=done seq=${currentTodo.seq}。未完了なら作業を続けてください。`,
	].join("\n");
}
