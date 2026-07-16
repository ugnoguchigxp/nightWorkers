import { and, eq } from "drizzle-orm";
import { db } from "../../../db/client";
import { designQuestionnaireSessions } from "../../../db/design-questionnaire-schema";
import { reviewSessions } from "../../../db/review-mode-schema";
import {
	backgroundProcesses,
	implementationQueueEntries,
	taskRuns,
} from "../../../db/schema";

const runResourceArgumentByAction = new Map<string, string>([
	["run.stop", "runId"],
	["review.session.start", "sourceRunId"],
	["run.review.submit", "runId"],
	["task.complete", "sourceRunId"],
	["git.commit", "sourceRunId"],
	["git.push", "sourceRunId"],
	["git.merge.preview", "runId"],
	["git.merge.defer", "runId"],
	["git.merge.rework", "runId"],
	["git.merge.target.update", "runId"],
	["git.merge.execute", "runId"],
]);
const queueResourceActions = new Set([
	"task.queue.update",
	"task.queue.cancel",
	"task.queue.requeue",
	"task.queue.recover",
	"task.queue.archive",
]);
const questionnaireResourceActions = new Set([
	"questionnaire.draft.update",
	"questionnaire.draft.save",
	"questionnaire.submit",
	"questionnaire.follow_up.generate",
	"questionnaire.review.generate",
	"questionnaire.review.accept",
	"questionnaire.review.leave_unadopted",
]);

export async function actionResourceBelongsToTask(
	taskId: string,
	actionId: string,
	args: Record<string, unknown>,
) {
	if (actionId === "run.implementation.start") {
		const repairRequest = asRecord(args.repairRequest);
		const sourceRunId = asRecord(repairRequest?.failure)?.sourceRunId;
		if (typeof sourceRunId !== "string") return true;
		return runBelongsToTask(taskId, sourceRunId);
	}
	const runArgument = runResourceArgumentByAction.get(actionId);
	if (runArgument) {
		const runId = args[runArgument];
		return typeof runId === "string" && runBelongsToTask(taskId, runId);
	}
	if (queueResourceActions.has(actionId)) {
		const entryId = args.entryId;
		if (typeof entryId !== "string") return false;
		const [entry] = await db
			.select({ id: implementationQueueEntries.id })
			.from(implementationQueueEntries)
			.where(
				and(
					eq(implementationQueueEntries.id, entryId),
					eq(implementationQueueEntries.taskId, taskId),
				),
			);
		return Boolean(entry);
	}
	if (questionnaireResourceActions.has(actionId)) {
		const questionnaireSessionId = args.questionnaireSessionId;
		if (typeof questionnaireSessionId !== "string") return false;
		const [questionnaire] = await db
			.select({ id: designQuestionnaireSessions.id })
			.from(designQuestionnaireSessions)
			.where(
				and(
					eq(designQuestionnaireSessions.id, questionnaireSessionId),
					eq(designQuestionnaireSessions.taskId, taskId),
				),
			);
		return Boolean(questionnaire);
	}
	if (actionId === "background_process.stop") {
		const processId = args.processId;
		if (typeof processId !== "string") return false;
		const [process] = await db
			.select({ id: backgroundProcesses.id })
			.from(backgroundProcesses)
			.where(
				and(
					eq(backgroundProcesses.id, processId),
					eq(backgroundProcesses.taskId, taskId),
				),
			);
		return Boolean(process);
	}
	if (actionId === "review.run.start") {
		const reviewSessionId = args.reviewSessionId;
		if (typeof reviewSessionId !== "string") return false;
		const [reviewSession] = await db
			.select({ id: reviewSessions.id })
			.from(reviewSessions)
			.where(
				and(
					eq(reviewSessions.id, reviewSessionId),
					eq(reviewSessions.taskId, taskId),
				),
			);
		return Boolean(reviewSession);
	}
	return true;
}

async function runBelongsToTask(taskId: string, runId: string) {
	const [run] = await db
		.select({ id: taskRuns.id })
		.from(taskRuns)
		.where(and(eq(taskRuns.id, runId), eq(taskRuns.taskId, taskId)));
	return Boolean(run);
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}
