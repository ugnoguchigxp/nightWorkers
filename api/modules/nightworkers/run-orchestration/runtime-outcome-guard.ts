import type { TaskRunStatus } from "../../../db/schema";
import type { AgentRuntimeResult } from "../../../services/agent-runtime/types";
import * as repo from "../nightworkers.repository";
import { resolveGuardedRunOutcomeStatus } from "./status";

export type RuntimePauseSnapshot = {
	version: 1;
	kind: "host_limit";
	stoppedBy: "budget";
	resumableRunningTodo: true;
};

export function buildRuntimePauseSnapshot(
	result: AgentRuntimeResult,
): RuntimePauseSnapshot | null {
	if (result.terminalState !== "needs_human" || result.stoppedBy !== "budget") {
		return null;
	}
	return {
		version: 1,
		kind: "host_limit",
		stoppedBy: result.stoppedBy,
		resumableRunningTodo: true,
	};
}

export function carryRuntimePauseSnapshot(
	nextSnapshot: Record<string, unknown>,
	previousSnapshot: unknown,
) {
	const runtimePause = readRuntimePauseSnapshot(previousSnapshot);
	return runtimePause ? { ...nextSnapshot, runtimePause } : nextSnapshot;
}

export function readRuntimePauseSnapshot(
	value: unknown,
): RuntimePauseSnapshot | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const snapshot = value as Record<string, unknown>;
	const pause = snapshot.runtimePause;
	if (!pause || typeof pause !== "object" || Array.isArray(pause)) return null;
	const record = pause as Record<string, unknown>;
	if (
		record.version !== 1 ||
		record.kind !== "host_limit" ||
		record.resumableRunningTodo !== true ||
		record.stoppedBy !== "budget"
	) {
		return null;
	}
	return record as RuntimePauseSnapshot;
}

export function resolveRuntimeOutcomeGuard(input: {
	currentStatus: TaskRunStatus;
	outcomeStatus: TaskRunStatus;
	todoFinalizationBlocked: boolean;
	securityFinalizationBlocked: boolean;
	openTodoSummary: string;
	securityGateMessage?: string | null;
}) {
	const externallyHeldStatus = !(
		["running", "finalizing"] as TaskRunStatus[]
	).includes(input.currentStatus)
		? input.currentStatus
		: null;
	const status = resolveGuardedRunOutcomeStatus({
		currentStatus: input.currentStatus,
		outcomeStatus: input.outcomeStatus,
		finalizationBlocked:
			input.todoFinalizationBlocked || input.securityFinalizationBlocked,
	});
	const reportNotes = [
		externallyHeldStatus
			? `Run status changed to ${externallyHeldStatus} while runtime was active; the runtime result was recorded without overriding that state.`
			: null,
		input.todoFinalizationBlocked
			? `Todo closeout incomplete: ${input.openTodoSummary}`
			: null,
		input.todoFinalizationBlocked
			? "Codex contract warning: codex_open_todos_before_completion."
			: null,
		input.securityFinalizationBlocked
			? `Security Oracle gate blocked finalization: ${input.securityGateMessage ?? "gate result unavailable"}`
			: null,
	].filter((note): note is string => Boolean(note));
	const summary = externallyHeldStatus
		? `Runtime result was recorded after the run entered ${externallyHeldStatus}.`
		: input.todoFinalizationBlocked
			? "Runtime finished without explicitly closing all open Todos."
			: input.securityFinalizationBlocked
				? "Security Oracle gate did not allow implementation finalization."
				: null;
	return { status, externallyHeldStatus, reportNotes, summary };
}

export async function recordPreservedNeedsHumanOutcome(input: {
	runId: string;
	taskId: string;
	previousStatus: string;
	runtimeOutcomeStatus: string;
	nextStatus: string;
}) {
	await repo.createRunEvent({
		version: 1,
		runId: input.runId,
		taskId: input.taskId,
		timestamp: new Date().toISOString(),
		type: "run.outcome_decided",
		severity: "warning",
		actor: "system",
		message:
			"Runtime completed after the run entered needs_human; preserved needs_human status.",
		data: {
			previousStatus: input.previousStatus,
			runtimeOutcomeStatus: input.runtimeOutcomeStatus,
			nextStatus: input.nextStatus,
		},
	});
}
