import type { TaskRunStatus } from "../../../db/schema";
import { AppError } from "../../../lib/errors";

export const runStatusTransitionTable = {
	ready: ["queued", "running"],
	queued: ["running", "ready", "cancelled"],
	context_compiling: [
		"running",
		"needs_human",
		"failed",
		"cancelled",
		"timed_out",
	],
	running: [
		"finalizing",
		"blocked",
		"needs_human",
		"failed",
		"cancelled",
		"timed_out",
	],
	finalizing: [
		"needs_review",
		"completed",
		"blocked",
		"failed",
		"needs_human",
		"cancelled",
		"timed_out",
	],
	needs_review: ["completed", "failed", "needs_human"],
	completed: [],
	failed: [],
	needs_human: ["queued", "running", "failed", "cancelled"],
	cancelled: ["queued", "running"],
	timed_out: ["queued", "running", "failed"],
	blocked: ["queued", "running", "failed", "cancelled"],
} as const satisfies Record<string, readonly string[]>;

export function assertRunStatusTransition(from: string, to: string) {
	if (from === to) return;
	const transitionTable: Record<string, readonly string[]> =
		runStatusTransitionTable;
	const allowed = transitionTable[from];
	if (!allowed?.includes(to)) {
		throw new AppError(
			409,
			"INVALID_RUN_STATUS_TRANSITION",
			`Invalid run status transition: ${from} -> ${to}`,
		);
	}
}

export function resolveGuardedRunOutcomeStatus(input: {
	currentStatus: TaskRunStatus;
	outcomeStatus: TaskRunStatus;
	finalizationBlocked: boolean;
}): TaskRunStatus {
	if (
		!(["running", "finalizing"] as TaskRunStatus[]).includes(
			input.currentStatus,
		)
	)
		return input.currentStatus;
	return input.finalizationBlocked ? "blocked" : input.outcomeStatus;
}
