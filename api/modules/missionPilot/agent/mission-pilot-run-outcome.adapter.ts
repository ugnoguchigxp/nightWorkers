import { and, eq } from "drizzle-orm";
import { db } from "../../../db/client";
import { taskRuns } from "../../../db/schema";
import { sliceMissionPilotUtf8Page } from "./mission-pilot-content-page";

export async function readMissionPilotRunOutcome(
	taskId: string,
	runId: string,
	options: { cursor?: number; maxChars?: number } = {},
) {
	const [run] = await db
		.select({
			id: taskRuns.id,
			taskId: taskRuns.taskId,
			status: taskRuns.status,
			summary: taskRuns.summary,
			finalReport: taskRuns.finalReport,
			finalJudgment: taskRuns.finalJudgment,
			testResults: taskRuns.testResults,
			startedAt: taskRuns.startedAt,
			finishedAt: taskRuns.finishedAt,
		})
		.from(taskRuns)
		.where(and(eq(taskRuns.id, runId), eq(taskRuns.taskId, taskId)));
	if (!run) return null;
	const report = run.finalReport ?? run.summary ?? "";
	const page = sliceMissionPilotUtf8Page(report, {
		cursor: options.cursor,
		maxChars: options.maxChars ?? 16_000,
		maxBytes: 16_000,
	});
	return {
		runId: run.id,
		taskId: run.taskId,
		status: run.status,
		finalReport: page.content,
		finalReportPage: page.page,
		finalJudgment: run.finalJudgment,
		verificationSummary: run.testResults,
		startedAt: run.startedAt,
		finishedAt: run.finishedAt,
	};
}
export async function readMissionPilotRunChangeSummary(
	taskId: string,
	runId: string,
) {
	const [run] = await db
		.select({
			id: taskRuns.id,
			status: taskRuns.status,
			finalReport: taskRuns.finalReport,
		})
		.from(taskRuns)
		.where(and(eq(taskRuns.id, runId), eq(taskRuns.taskId, taskId)));
	return run
		? { runId: run.id, status: run.status, summary: run.finalReport ?? null }
		: null;
}
export async function readMissionPilotRunVerification(
	taskId: string,
	runId: string,
	options: { cursor?: number; limit?: number } = {},
) {
	const outcome = await readMissionPilotRunOutcome(taskId, runId);
	if (!outcome) return null;
	return {
		runId,
		verificationSummary: outcome.verificationSummary,
		cursor: options.cursor ?? 0,
		limit: options.limit ?? 50,
	};
}
