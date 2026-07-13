import * as repo from "../nightworkers/nightworkers.repository";
import * as reviewRepo from "./review-mode.repository";

type ReviewSession = NonNullable<
	Awaited<ReturnType<typeof reviewRepo.getReviewSession>>
>;

export async function findExistingReviewTaskRun(session: ReviewSession) {
	const artifact = await reviewRepo.getReviewArtifact(session.id, "review_run");
	const artifactRunId = readRecord(artifact?.artifactJson).reviewRunId;
	if (typeof artifactRunId === "string") {
		const run = await repo.getTaskRun(artifactRunId);
		if (run) return { run, artifact };
	}
	const runs = await repo.listTaskRunsForTask(session.taskId);
	const run = runs.find((candidate) => {
		const reviewRun = readRecord(
			readRecord(candidate.contextSnapshot).reviewRun,
		);
		return reviewRun.reviewSessionId === session.id;
	});
	return run ? { run, artifact: null } : null;
}

export function reviewRunArtifactStatus(status: string) {
	if (["completed", "needs_review"].includes(status)) return "done" as const;
	if (["failed", "timed_out", "cancelled", "blocked"].includes(status))
		return "failed" as const;
	return "running" as const;
}

function readRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}
