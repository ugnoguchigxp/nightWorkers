import { AppError } from "../../../lib/errors";
import { stopBackgroundProcessesForRun } from "../../../services/background-processes";
import { decideRunOutcome } from "../../../services/run-control/run-outcome-gate";
import { recordManualConditionConfirmationsForReview } from "../../codingAgent";
import * as repo from "../../nightworkers/nightworkers.repository";
import {
	archiveImplementationQueueEntryForRun,
	runSessionQueueForRepository,
	shouldContinueSessionQueue,
} from "../../nightworkers/nightworkers.run-orchestration.service";
import { createRunEventInTransaction } from "../../nightworkers/nightworkers.runs-event.repository";
import { buildReviewResult } from "../../review/results/build-review-result";
import { collectDefaultReviewEvidence } from "../../review/results/evidence-collector";
import type { ReviewRunRequest } from "../../review/results/types";
import { applyRunOutcomeTransition } from "./run-outcome-transition.command";

type RuntimeTerminalState =
	| "completed"
	| "needs_review"
	| "needs_human"
	| "failed"
	| "timed_out"
	| "blocked";

export async function reviewTaskRunCommand(
	runId: string,
	request: ReviewRunRequest,
	precondition?: {
		expectedTaskId: string;
		expectedTaskRevision: number;
	},
) {
	const run = await repo.getTaskRun(runId);
	if (!run) throw new Error("Run not found");
	let task = null;
	if (precondition) {
		if (run.taskId !== precondition.expectedTaskId)
			throw new AppError(
				403,
				"TASK_RESOURCE_OWNERSHIP_MISMATCH",
				"Run does not belong to the requested Task.",
			);
		task = await repo.getTask(run.taskId);
		if (task?.revision !== precondition.expectedTaskRevision)
			throw new AppError(
				409,
				"TASK_REVISION_CONFLICT",
				"Task revision changed; re-read the Task Operator view.",
				{ currentTaskRevision: task?.revision ?? null },
			);
	}
	task ??= await repo.getTask(run.taskId);
	if (!task) throw new AppError(404, "TASK_NOT_FOUND", "Task not found");
	const events = await repo.listTaskEventsForRun(runId);
	const outcome = decideRunOutcome({
		runtime: {
			finalReport: run.finalReport || "",
			terminalState: toRuntimeTerminalState(run.status),
			summary: run.summary || `Review action: ${request.action}`,
			stoppedBy: "decision",
			riskLevel: "medium",
		},
		humanAction: request.action,
	});
	const reviewResult = buildReviewResult({
		run: {
			id: run.id,
			taskId: run.taskId,
			status: run.status,
			summary: run.summary,
		},
		request,
		outcome,
		evidenceRefs: request.evidenceRefs?.length
			? request.evidenceRefs
			: collectDefaultReviewEvidence(run, events),
	});
	const transition = await applyRunOutcomeTransition({
		run: {
			id: run.id,
			expectedStatuses: [run.status],
			expectedUpdatedAt: run.updatedAt,
			targetStatus: outcome.status,
			patch: { summary: request.note || outcome.summary },
		},
		task: {
			id: task.id,
			expectedStatus: task.status,
			expectedUpdatedAt: task.updatedAt,
			targetStatus: outcome.status,
		},
		afterApply: async (_transition, database) => {
			await createRunEventInTransaction(
				{
					version: 1,
					runId,
					taskId: run.taskId,
					timestamp: new Date().toISOString(),
					type: "human.review_submitted",
					severity: "info",
					actor: "human",
					message: `Human review completed. Action: ${request.action}. Note: ${request.note || "None"}`,
					data: { action: request.action, reviewResultId: reviewResult.id },
				},
				{ payloadJson: { reviewResult } },
				database,
			);
			if (outcome.status === "completed") {
				await recordManualConditionConfirmationsForReview(
					{
						taskId: run.taskId,
						runId,
						actorKind: "human_reviewer",
						actorId: reviewResult.id,
						evidenceRef: `review-result:${reviewResult.id}`,
					},
					database,
				);
			}
			await createRunEventInTransaction(
				{
					version: 1,
					runId,
					taskId: run.taskId,
					timestamp: new Date().toISOString(),
					type: "run.outcome_decided",
					severity: "info",
					actor: "human",
					message: `Run outcome decided: ${outcome.status} (${outcome.reason})`,
					data: { ...outcome, reviewResultId: reviewResult.id },
				},
				{
					legacyPayload: outcome,
					payloadJson: { reviewResultId: reviewResult.id },
				},
				database,
			);
		},
	});
	await repo.publishTaskRunUpdate(transition.run);
	if (
		["completed", "cancelled", "failed", "timed_out"].includes(outcome.status)
	) {
		await stopBackgroundProcessesForRun(runId, `run_${outcome.status}`).catch(
			() => {
				// The outcome transaction has already committed. Cleanup failures stay
				// observable on their process records and never roll the Run back.
			},
		);
	}
	if (outcome.status === "completed")
		await archiveImplementationQueueEntryForRun(runId);
	if (shouldContinueSessionQueue(outcome.status)) {
		const repositoryId = run.repositoryId || transition.task.repositoryId;
		if (repositoryId) void runSessionQueueForRepository(repositoryId);
	}
	return {
		ok: true,
		status: outcome.status,
		outcome,
		reviewResult,
	};
}

function toRuntimeTerminalState(value: string): RuntimeTerminalState {
	const allowed: RuntimeTerminalState[] = [
		"completed",
		"needs_review",
		"needs_human",
		"failed",
		"timed_out",
		"blocked",
	];
	return allowed.includes(value as RuntimeTerminalState)
		? (value as RuntimeTerminalState)
		: "needs_review";
}
