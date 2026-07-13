import {
	type MissionPilotPlanProgress,
	missionPilotPlanProgressSchema,
} from "../../../shared/schemas/mission-pilot-plan-progress.schema";
import {
	isMissionPilotConceptArtifactKind,
	missionPilotArtifactScoreThreshold,
} from "../../../shared/schemas/mission-pilot-plan-review.schema";
import * as missionPilotRepo from "./mission-pilot.repository";
import * as planRepo from "./mission-pilot-plan.repository";

function iso(value: Date | null) {
	return value ? value.toISOString() : null;
}

export async function getMissionPilotPlanProgress(
	taskId: string,
): Promise<MissionPilotPlanProgress | null> {
	const session = await missionPilotRepo.getSessionByTaskId(taskId);
	if (!session) return null;
	const [steps, review, corrections] = await Promise.all([
		planRepo.listPlanSteps(session.id),
		planRepo.getLatestPlanReview(session.id),
		planRepo.listArtifactCorrectionRuns(session.id),
	]);
	const activeCorrection = corrections.find((run) =>
		[
			"pending",
			"dispatching",
			"running",
			"result_received",
			"validating",
		].includes(run.status),
	);
	const reviewPassed = Boolean(
		review?.verdict === "pass" &&
			review.contextRevision === session.contextRevision &&
			review.contextDigest === session.contextDigest,
	);
	const updatedAt = new Date(
		Math.max(
			session.updatedAt.getTime(),
			...steps.map((step) => step.updatedAt.getTime()),
			...corrections.map((run) => run.updatedAt.getTime()),
			...(review ? [review.createdAt.getTime()] : []),
		),
	);
	return missionPilotPlanProgressSchema.parse({
		taskId: session.taskId,
		sessionId: session.id,
		phase: session.phase,
		desiredState: session.desiredState,
		version: session.version,
		contextRevision: session.contextRevision,
		currentStepKey:
			steps.find((step) => step.status === "running")?.stepKey ?? null,
		steps: steps.map((step) => ({
			key: step.stepKey,
			ordinal: step.ordinal,
			kind: step.evidenceJson.kind,
			view:
				typeof step.evidenceJson.view === "string"
					? step.evidenceJson.view
					: null,
			status: step.status,
			attempt: step.attempt,
			artifactMessageId: step.artifactMessageId ?? null,
			lastError: step.lastError ?? null,
			startedAt: iso(step.startedAt),
			finishedAt: iso(step.finishedAt),
		})),
		review: {
			status: reviewPassed
				? "passed"
				: session.phase === "reviewing_plan"
					? "running"
					: review?.verdict === "revise"
						? "revision_required"
						: review?.verdict === "reject"
							? "failed"
							: "pending",
			attempt: review?.attempt ?? 0,
			reviewId: review?.id ?? null,
			advisories: (review?.reviewJson.artifactScores ?? [])
				.filter(
					(score) =>
						isMissionPilotConceptArtifactKind(score.artifactKind) &&
						score.score <
							missionPilotArtifactScoreThreshold(score.artifactKind),
				)
				.map((score) => ({
					artifactKind: score.artifactKind,
					score: score.score,
					threshold: missionPilotArtifactScoreThreshold(score.artifactKind),
					rationale: score.rationale,
				})),
		},
		activeCorrection: activeCorrection
			? {
					id: activeCorrection.id,
					target: activeCorrection.target,
					focus: activeCorrection.focusJson,
					status: activeCorrection.status,
					instruction: activeCorrection.instruction,
					sourceMessageId: activeCorrection.sourceMessageId,
				}
			: null,
		queueAdmission: {
			status:
				session.phase === "queued"
					? "admitted"
					: session.phase === "queueing"
						? "admitting"
						: reviewPassed
							? "ready"
							: "blocked",
		},
		lastError: session.lastErrorMessage ?? null,
		updatedAt: updatedAt.toISOString(),
	});
}
