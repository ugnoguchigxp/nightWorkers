import { and, eq } from "drizzle-orm";
import { db } from "../../../db/client";
import {
	taskRunActionRecords,
	taskRunCommitRecords,
	taskRuns,
} from "../../../db/schema";
import {
	missionPilotDigest,
	sliceMissionPilotUtf8Page,
} from "./mission-pilot-content-page";

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
			contextSnapshot: taskRuns.contextSnapshot,
			startedAt: taskRuns.startedAt,
			finishedAt: taskRuns.finishedAt,
			updatedAt: taskRuns.updatedAt,
		})
		.from(taskRuns)
		.where(and(eq(taskRuns.id, runId), eq(taskRuns.taskId, taskId)));
	if (!run) return null;
	const report = run.finalReport ?? run.summary ?? "";
	const [commitRecord, actionRecords] = await Promise.all([
		db
			.select({
				ownedCandidatePaths: taskRunCommitRecords.ownedCandidatePathsJson,
				stageableOwnedPaths: taskRunCommitRecords.stageableOwnedPathsJson,
				commitSha: taskRunCommitRecords.commitSha,
			})
			.from(taskRunCommitRecords)
			.where(eq(taskRunCommitRecords.runId, run.id))
			.limit(1)
			.then((rows) => rows[0] ?? null),
		db
			.select({ artifactRefs: taskRunActionRecords.artifactRefsJson })
			.from(taskRunActionRecords)
			.where(eq(taskRunActionRecords.runId, run.id)),
	]);
	const changedPaths = Array.from(
		new Set([
			...(commitRecord?.ownedCandidatePaths ?? []),
			...(commitRecord?.stageableOwnedPaths ?? []),
		]),
	);
	const artifactRefs = Array.from(
		new Set(
			actionRecords.flatMap((record) =>
				Array.isArray(record.artifactRefs)
					? record.artifactRefs.filter(
							(ref): ref is string => typeof ref === "string",
						)
					: [],
			),
		),
	).map((id) => ({ type: "artifact", id }));
	const page = sliceMissionPilotUtf8Page(report, {
		cursor: options.cursor,
		maxChars: options.maxChars ?? 16_000,
		maxBytes: 16_000,
	});
	return {
		runId: run.id,
		taskId: run.taskId,
		status: run.status,
		finalReport: page.content || null,
		finalReportPage: page.page,
		finalReportDigest: missionPilotDigest(report),
		finalJudgment: run.finalJudgment,
		blocker: readBlocker(run.finalJudgment),
		verificationSummary: run.testResults,
		changedPathSummary: changedPaths,
		artifactRefs,
		sourceRevision: run.updatedAt.getTime(),
		sourceDigest: missionPilotDigest(
			JSON.stringify({
				runId: run.id,
				contextSnapshot: run.contextSnapshot ?? null,
			}),
		),
		startedAt: run.startedAt,
		finishedAt: run.finishedAt,
	};
}

function readBlocker(value: unknown) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const blocker = (value as Record<string, unknown>).blocker;
	return typeof blocker === "string" ? blocker : null;
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
