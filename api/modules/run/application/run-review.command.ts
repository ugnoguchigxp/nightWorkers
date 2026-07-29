import { AppError } from "../../../lib/errors";
import { decideRunOutcome } from "../../../services/run-control/run-outcome-gate";
import * as repo from "../../nightworkers/nightworkers.repository";
import {
	archiveImplementationQueueEntryForRun,
	completeImplementationQueueEntryForRun,
	runSessionQueueForRepository,
	shouldContinueSessionQueue,
} from "../../nightworkers/nightworkers.run-orchestration.service";
import { buildReviewResult } from "../../review/results/build-review-result";
import { collectDefaultReviewEvidence } from "../../review/results/evidence-collector";
import type { ReviewRunRequest } from "../../review/results/types";

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
	if (precondition) {
		if (run.taskId !== precondition.expectedTaskId)
			throw new AppError(
				403,
				"TASK_RESOURCE_OWNERSHIP_MISMATCH",
				"Run does not belong to the requested Task.",
			);
		const task = await repo.getTask(run.taskId);
		if (task?.revision !== precondition.expectedTaskRevision)
			throw new AppError(
				409,
				"TASK_REVISION_CONFLICT",
				"Task revision changed; re-read the Task Operator view.",
				{ currentTaskRevision: task?.revision ?? null },
			);
	}
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
	await repo.createRunEvent(
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
	);
	await repo.updateTaskRun(runId, {
		status: outcome.status,
		summary: request.note || outcome.summary,
	});
	await repo.updateTaskStatus(run.taskId, outcome.status);
	await completeImplementationQueueEntryForRun(runId, outcome.status);
	if (outcome.status === "completed")
		await archiveImplementationQueueEntryForRun(runId);
	if (shouldContinueSessionQueue(outcome.status)) {
		const reviewedTask = run.repositoryId
			? null
			: await repo.getTask(run.taskId);
		const repositoryId = run.repositoryId || reviewedTask?.repositoryId;
		if (repositoryId) void runSessionQueueForRepository(repositoryId);
	}
	await repo.createRunEvent(
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
	);
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
