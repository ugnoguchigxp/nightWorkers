import { NotFoundError } from "../../../lib/errors";
import { resolveAgentRuntime } from "../../../services/agent-runtime/registry";
import { stopIsolatedTaskRun } from "../../../services/execution/worker-process-manager";
import * as repo from "../nightworkers.repository";
import { completeImplementationQueueEntryForRun } from "./queues";
import { assertRunStatusTransition } from "./status";
import { closeOpenTodosForCancelledRun } from "./todo-closeout";
import { normalizeAgentRuntimeKind } from "./utils";

export async function stopTaskRun(runId: string) {
	const run = await repo.getTaskRun(runId);
	if (!run) {
		throw new NotFoundError("Run not found");
	}
	if (
		![
			"running",
			"context_compiling",
			"compiling_context",
			"finalizing",
		].includes(run.status)
	) {
		return run;
	}
	if (await stopIsolatedTaskRun(runId)) {
		return (await repo.getTaskRun(runId)) ?? run;
	}

	const runtime = resolveAgentRuntime(
		normalizeAgentRuntimeKind(run.workerKind),
	);
	await runtime.stop(runId);
	await repo.createRunEvent({
		version: 1,
		runId,
		taskId: run.taskId,
		timestamp: new Date().toISOString(),
		type: "run.stop_requested",
		severity: "warning",
		actor: "human",
		message: "User requested run stop from the composer.",
		data: {
			workerKind: run.workerKind,
			previousStatus: run.status,
		},
	});
	const todosBeforeCancelCloseout = await repo.listTaskRunTodosForRun(runId);
	await closeOpenTodosForCancelledRun({
		runId,
		taskId: run.taskId,
		todos: todosBeforeCancelCloseout,
		evidence: "user_stop_requested",
	});
	assertRunStatusTransition(run.status, "cancelled");
	const stoppedRun = await repo.updateTaskRun(runId, {
		status: "cancelled",
		endedAt: new Date(),
		finishedAt: new Date(),
		summary: run.summary || "Run stop requested by user.",
		finalReport: run.finalReport || "Run stop requested by user.",
	});
	await repo.updateTaskStatus(run.taskId, "ready");
	await completeImplementationQueueEntryForRun(runId, "cancelled");
	return stoppedRun ?? run;
}
