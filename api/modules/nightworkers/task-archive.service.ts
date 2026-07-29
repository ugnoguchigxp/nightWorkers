import crypto from "node:crypto";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../../db/client";
import {
	missionPilotSessions,
	taskArchiveRecords,
} from "../../db/mission-pilot-schema";
import {
	agentModeSessions,
	implementationQueueEntries,
	taskRunCommitRecords,
	taskRuns,
	tasks,
} from "../../db/schema";
import { AppError, NotFoundError, ValidationError } from "../../lib/errors";

type ArchiveInput = {
	taskId: string;
	reason?: "mission_pilot_completed" | "manual" | "retention";
	missionPilotSessionId?: string | null;
	sourceRunId?: string | null;
	evidence?: Record<string, unknown>;
	expectedTaskRevision?: number;
	discardPendingCloseouts?: boolean;
};

export async function archiveCompletedTask(input: ArchiveInput) {
	return db.transaction(async (tx) => {
		const [task] = await tx
			.select()
			.from(tasks)
			.where(eq(tasks.id, input.taskId))
			.limit(1);
		if (!task) throw new NotFoundError("Task not found");
		if (
			input.expectedTaskRevision !== undefined &&
			task.updatedAt.getTime() !== input.expectedTaskRevision
		)
			throw new AppError(
				409,
				"TASK_REVISION_CONFLICT",
				"Task revision changed; re-read the Task Operator view.",
				{ currentTaskRevision: task.updatedAt.getTime() },
			);
		const [activeRecord] = await tx
			.select()
			.from(taskArchiveRecords)
			.where(
				and(
					eq(taskArchiveRecords.taskId, input.taskId),
					isNull(taskArchiveRecords.restoredAt),
				),
			)
			.orderBy(desc(taskArchiveRecords.archivedAt))
			.limit(1);
		if (task.status === "archived" && activeRecord) {
			return { task, archiveRecord: activeRecord, duplicate: true } as const;
		}
		if (task.status !== "completed") {
			throw new ValidationError(
				"Task must be completed before it can be archived",
			);
		}
		const pendingCloseouts = await tx
			.select({ runId: taskRunCommitRecords.runId })
			.from(taskRunCommitRecords)
			.innerJoin(taskRuns, eq(taskRunCommitRecords.runId, taskRuns.id))
			.where(
				and(
					eq(taskRuns.taskId, task.id),
					inArray(taskRunCommitRecords.status, [
						"pending",
						"ready",
						"needs_human",
					]),
				),
			);
		if (pendingCloseouts.length > 0 && !input.discardPendingCloseouts)
			throw new AppError(
				409,
				"TASK_CLOSEOUT_PENDING",
				"Pending Git closeout must be committed or explicitly discarded before archiving",
				{
					pendingCloseoutCount: pendingCloseouts.length,
					runIds: pendingCloseouts.map((row) => row.runId),
				},
			);
		const now = new Date();
		const discardedCloseoutRunIds = pendingCloseouts.map((row) => row.runId);
		if (discardedCloseoutRunIds.length > 0) {
			await tx
				.update(taskRunCommitRecords)
				.set({
					status: "discarded",
					statusReason:
						"Pending Git closeout was explicitly discarded when the Task was archived.",
					updatedAt: now,
				})
				.where(inArray(taskRunCommitRecords.runId, discardedCloseoutRunIds));
		}
		const id = crypto.randomUUID();
		await tx.insert(taskArchiveRecords).values({
			id,
			taskId: task.id,
			missionPilotSessionId: input.missionPilotSessionId ?? null,
			sourceRunId: input.sourceRunId ?? null,
			previousStatus: "completed",
			reason: input.reason ?? "manual",
			evidenceJson: {
				...(input.evidence ?? {}),
				discardedCloseoutRunIds,
			},
			archivedAt: now,
		});
		const [archived] = await tx
			.update(tasks)
			.set({ status: "archived", archivedAt: now, updatedAt: now })
			.where(
				and(
					eq(tasks.id, task.id),
					eq(tasks.status, "completed"),
					...(input.expectedTaskRevision !== undefined
						? [eq(tasks.updatedAt, new Date(input.expectedTaskRevision))]
						: []),
				),
			)
			.returning();
		if (!archived)
			throw new ValidationError(
				"Task archive admission changed; retry required",
			);
		await tx
			.update(agentModeSessions)
			.set({
				status: "closed",
				closeReason: "task_closed",
				closedAt: now,
				updatedAt: now,
			})
			.where(
				and(
					eq(agentModeSessions.taskId, task.id),
					eq(agentModeSessions.status, "active"),
				),
			);
		await tx
			.update(implementationQueueEntries)
			.set({ status: "execution_archived", archivedAt: now, updatedAt: now })
			.where(eq(implementationQueueEntries.taskId, task.id));
		if (input.missionPilotSessionId) {
			await tx
				.update(missionPilotSessions)
				.set({
					phase: "archived",
					desiredState: "stopped",
					activeRunId: null,
					activePhaseRunId: null,
					stoppedAt: now,
					updatedAt: now,
				})
				.where(eq(missionPilotSessions.id, input.missionPilotSessionId));
		}
		const [archiveRecord] = await tx
			.select()
			.from(taskArchiveRecords)
			.where(eq(taskArchiveRecords.id, id))
			.limit(1);
		return { task: archived, archiveRecord, duplicate: false } as const;
	});
}

export async function restoreArchivedTask(
	taskId: string,
	restoredBy = "user",
	expectedTaskRevision?: number,
) {
	return db.transaction(async (tx) => {
		const [task] = await tx
			.select()
			.from(tasks)
			.where(eq(tasks.id, taskId))
			.limit(1);
		if (!task) throw new NotFoundError("Task not found");
		if (
			expectedTaskRevision !== undefined &&
			task.updatedAt.getTime() !== expectedTaskRevision
		)
			throw new AppError(
				409,
				"TASK_REVISION_CONFLICT",
				"Task revision changed; re-read the Task Operator view.",
				{ currentTaskRevision: task.updatedAt.getTime() },
			);
		if (task.status !== "archived")
			throw new ValidationError("Task is not archived");
		const [record] = await tx
			.select()
			.from(taskArchiveRecords)
			.where(
				and(
					eq(taskArchiveRecords.taskId, taskId),
					isNull(taskArchiveRecords.restoredAt),
				),
			)
			.orderBy(desc(taskArchiveRecords.archivedAt))
			.limit(1);
		if (!record)
			throw new ValidationError("Active task archive record not found");
		const now = new Date();
		const [restored] = await tx
			.update(tasks)
			.set({ status: "completed", archivedAt: null, updatedAt: now })
			.where(
				and(
					eq(tasks.id, taskId),
					...(expectedTaskRevision !== undefined
						? [eq(tasks.updatedAt, new Date(expectedTaskRevision))]
						: []),
				),
			)
			.returning();
		await tx
			.update(taskArchiveRecords)
			.set({ restoredAt: now, restoredToStatus: "completed", restoredBy })
			.where(eq(taskArchiveRecords.id, record.id));
		return restored;
	});
}

export async function reopenCompletedTask(taskId: string) {
	const [task] = await db
		.select()
		.from(tasks)
		.where(eq(tasks.id, taskId))
		.limit(1);
	if (!task) throw new NotFoundError("Task not found");
	if (task.status !== "completed")
		throw new ValidationError("Restore archived task before reopening it");
	const [reopened] = await db
		.update(tasks)
		.set({ status: "ready", completedAt: null, updatedAt: new Date() })
		.where(eq(tasks.id, taskId))
		.returning();
	return reopened;
}
