import { NotFoundError } from "../../lib/errors";
import * as repo from "../nightworkers/nightworkers.repository";
import { buildRecommendationFromEvidence } from "./review-mode.evidence";
import { rowRecommendation } from "./review-mode.model";
import * as reviewRepo from "./review-mode.repository";
import { buildReviewEvidencePackFromRun } from "./rubrics/evidence-pack";

async function buildPackForRun(runId: string) {
	const run = await repo.getTaskRun(runId);
	if (!run) throw new NotFoundError("Run not found");
	const events = await repo.listTaskEventsForRun(runId);
	const todos = await repo.listTaskRunTodosForRun(runId);
	const pack = buildReviewEvidencePackFromRun(run, events);
	return { run, todos, pack };
}

export async function getOrCreateReviewRecommendation(runId: string) {
	const existing = await reviewRepo.getReviewRecommendationByRun(runId);
	if (existing) return rowRecommendation(existing);
	const { run, todos, pack } = await buildPackForRun(runId);
	const task = await repo.getTask(run.taskId);
	const repositoryId = run.repositoryId || task?.repositoryId;
	if (!repositoryId) throw new NotFoundError("Repository not found for run");
	const openTodoCount = todos.filter((todo) =>
		["pending", "running"].includes(todo.status),
	).length;
	const recommendation = buildRecommendationFromEvidence({
		runId,
		taskId: run.taskId,
		repositoryId,
		pack,
		openTodoCount,
	});
	const row = await reviewRepo.upsertReviewRecommendation({
		runId,
		taskId: run.taskId,
		repositoryId,
		level: recommendation.level,
		defaultAction: recommendation.defaultAction,
		reasonsJson: recommendation.reasons,
	});
	return rowRecommendation(row);
}
