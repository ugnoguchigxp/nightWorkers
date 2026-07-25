import type { TaskRunStatus } from "../../db/schema";
import { logger } from "../../lib/logger";
import * as repo from "../nightworkers/nightworkers.repository";
import { autoStartReviewSessionForRun } from "./review-mode.service";
import { startReviewRunForSession } from "./review-run.service";

export type ReviewCorrectionState = {
	phase?: "implementation" | "review";
	reviewSessionId?: string;
	sourceReviewRunId?: string;
	commitChanges?: boolean;
	applyFixes?: boolean;
	cycle?: number;
};

export async function continueReviewCorrectionAfterRun(input: {
	taskId: string;
	runId: string;
	status: TaskRunStatus;
	contextSnapshot: unknown;
}) {
	const correction = readReviewCorrectionState(input.contextSnapshot);
	if (!correction || !isSuccessfulCorrectionStep(input.status)) return false;
	if (correction.phase !== "implementation") return false;
	const reviewSession = await autoStartReviewSessionForRun(input.runId);
	const reviewResult = await startReviewRunForSession(
		reviewSession.session.id,
		{
			codeReview: true,
			securityReview: true,
			applyFixes: correction.applyFixes === true && (correction.cycle ?? 0) < 2,
			commitChanges: correction.commitChanges === true,
		},
		{
			targetRunIds: [input.runId],
			reviewCorrection: { ...correction, phase: "review" },
		},
	);
	await recordCorrectionTransition({
		runId: input.runId,
		taskId: input.taskId,
		phase: "review",
		nextRunId: reviewResult.reviewRun?.id ?? null,
	});
	return true;
}

export async function safelyContinueReviewCorrectionAfterRun(input: {
	taskId: string;
	runId: string;
	status: TaskRunStatus;
	contextSnapshot: unknown;
}) {
	try {
		return await continueReviewCorrectionAfterRun(input);
	} catch (error) {
		logger.error(
			{ error, runId: input.runId },
			"Review correction continuation failed after the run was finalized",
		);
		return false;
	}
}

function readReviewCorrectionState(
	value: unknown,
): ReviewCorrectionState | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const correction = (value as Record<string, unknown>).reviewCorrection;
	if (
		!correction ||
		typeof correction !== "object" ||
		Array.isArray(correction)
	) {
		return null;
	}
	return correction as ReviewCorrectionState;
}

function isSuccessfulCorrectionStep(status: TaskRunStatus) {
	return status === "completed" || status === "needs_review";
}

async function recordCorrectionTransition(input: {
	runId: string;
	taskId: string;
	phase: "review";
	nextRunId: string | null;
}) {
	await repo.createRunEvent({
		version: 1,
		runId: input.runId,
		taskId: input.taskId,
		timestamp: new Date().toISOString(),
		type: "review.correction_requested",
		severity: "info",
		actor: "system",
		message: `Review correction continued into ${input.phase} mode.`,
		data: {
			phase: input.phase,
			nextRunId: input.nextRunId,
		},
	});
}
