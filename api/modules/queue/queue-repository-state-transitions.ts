import { and, eq, isNull, sql } from "drizzle-orm";
import { type DbTransaction, db } from "../../db/client";
import type {
	ImplementationQueueEntryStatus,
	TaskStatus,
} from "../../db/schema";
import {
	implementationQueueEntries,
	taskMessages,
	tasks,
} from "../../db/schema";
import type { CreateImplementationQueueEntryData } from "./queue-repository-command.types";
import {
	type QueueDb,
	resolveImplementationQueueExecutionLockKey,
} from "./queue-repository-row-mapper";

type QueueEntryUpdate = Partial<typeof implementationQueueEntries.$inferInsert>;

export async function createImplementationQueueEntry(
	data: CreateImplementationQueueEntryData,
	database: QueueDb = db,
) {
	const now = new Date();
	const executionType = data.executionType ?? "normal";
	const [entry] = await database
		.insert(implementationQueueEntries)
		.values({
			taskId: data.taskId,
			repositoryId: data.repositoryId,
			priority: data.priority ?? 0,
			queuePosition: data.queuePosition ?? null,
			executionType,
			executionLockKey:
				data.executionLockKey ??
				resolveImplementationQueueExecutionLockKey(data),
			sequenceGroupId:
				executionType === "sequence" ? (data.sequenceGroupId ?? null) : null,
			sequenceOrder:
				executionType === "sequence" ? (data.sequenceOrder ?? null) : null,
			sequenceDependsOnEntryId:
				executionType === "sequence"
					? (data.sequenceDependsOnEntryId ?? null)
					: null,
			schedulingReason: data.schedulingReason ?? null,
			sourceCommandKey: data.sourceCommandKey ?? null,
			requestProvenanceJson: data.requestProvenance ?? null,
			claimReady: data.claimReady ?? true,
			workspaceId: data.workspaceId ?? null,
			workspaceRequired: data.workspaceRequired ?? false,
			status: "queued",
			createdAt: now,
			updatedAt: now,
		})
		.returning();
	return entry;
}

export class QueueEntryTransitionConflict extends Error {}

export async function admitImplementationQueueEntry(input: {
	task: {
		id: string;
		expectedStatus: TaskStatus;
		expectedUpdatedAt: Date;
	};
	entry: CreateImplementationQueueEntryData;
}): Promise<{
	entry: typeof implementationQueueEntries.$inferSelect;
	task: typeof tasks.$inferSelect;
	message: typeof taskMessages.$inferSelect;
}> {
	return db.transaction(async (transaction) => {
		const now = new Date();
		const [task] = await transaction
			.update(tasks)
			.set({ status: "queued", updatedAt: now })
			.where(
				and(
					eq(tasks.id, input.task.id),
					eq(tasks.status, input.task.expectedStatus),
					eq(tasks.updatedAt, input.task.expectedUpdatedAt),
				),
			)
			.returning();
		if (!task) throw new QueueEntryTransitionConflict();
		const entry = await createImplementationQueueEntry(
			{
				...input.entry,
				repositoryId: task.repositoryId,
				priority: task.priority,
			},
			transaction,
		);
		if (!entry) throw new Error("Queue Entry was not created");
		const [message] = await transaction
			.insert(taskMessages)
			.values({
				taskId: task.id,
				role: "system",
				content: "Implementation Queue entry created.",
				messageType: "text",
				metadataJson: {
					source: "implementation_queue",
					status: "queued",
					queueEntryId: entry.id,
				},
				traceOwner: "system",
				traceChannel: "internal",
			})
			.returning();
		if (!message) throw new Error("Queue admission message was not created");
		return { entry, task, message };
	});
}

export async function updateImplementationQueueEntry(
	id: string,
	data: QueueEntryUpdate,
) {
	const [entry] = await db
		.update(implementationQueueEntries)
		.set({ ...data, updatedAt: new Date() })
		.where(eq(implementationQueueEntries.id, id))
		.returning();
	return entry;
}

type TransitionInput = {
	id: string;
	expectedStatus: ImplementationQueueEntryStatus;
	expectedLeaseVersion: number;
	expectedActiveRunId: string | null;
};

type TransitionResult =
	| {
			kind: "applied";
			entry: typeof implementationQueueEntries.$inferSelect;
			task: typeof tasks.$inferSelect | null;
	  }
	| {
			kind: "conflict";
			entry: typeof implementationQueueEntries.$inferSelect | null;
			task: typeof tasks.$inferSelect | null;
	  };

async function readEntryAndTask(
	entryId: string,
	taskId?: string,
	database: typeof db | DbTransaction = db,
) {
	const entry = await database
		.select()
		.from(implementationQueueEntries)
		.where(eq(implementationQueueEntries.id, entryId))
		.then((rows) => rows[0] ?? null);
	const task = taskId
		? await database
				.select()
				.from(tasks)
				.where(eq(tasks.id, taskId))
				.then((rows) => rows[0] ?? null)
		: null;
	return { entry, task };
}

function matchesActiveRun(
	entry: typeof implementationQueueEntries,
	activeRunId: string | null,
) {
	return activeRunId === null
		? isNull(entry.activeRunId)
		: eq(entry.activeRunId, activeRunId);
}

export async function cancelImplementationQueueEntryWithoutRun(input: {
	entry: TransitionInput;
	task: {
		id: string;
		expectedStatus: TaskStatus;
		expectedUpdatedAt: Date;
	};
}): Promise<TransitionResult> {
	try {
		return await db.transaction(async (transaction) => {
			const now = new Date();
			const [entry] = await transaction
				.update(implementationQueueEntries)
				.set({
					status: "cancelled",
					statusReason: "Cancelled by user.",
					processorSlot: null,
					leaseOwnerId: null,
					leaseAcquiredAt: null,
					leaseExpiresAt: null,
					lastFailureKind: "manual_cancel",
					leaseVersion: sql`${implementationQueueEntries.leaseVersion} + 1`,
					updatedAt: now,
				})
				.where(
					and(
						eq(implementationQueueEntries.id, input.entry.id),
						eq(implementationQueueEntries.status, input.entry.expectedStatus),
						eq(
							implementationQueueEntries.leaseVersion,
							input.entry.expectedLeaseVersion,
						),
						matchesActiveRun(
							implementationQueueEntries,
							input.entry.expectedActiveRunId,
						),
					),
				)
				.returning();
			if (!entry) throw new QueueEntryTransitionConflict();
			if (input.task.expectedStatus !== "queued") {
				return { kind: "applied", entry, task: null };
			}
			const [task] = await transaction
				.update(tasks)
				.set({ status: "ready", updatedAt: now })
				.where(
					and(
						eq(tasks.id, input.task.id),
						eq(tasks.status, input.task.expectedStatus),
						eq(tasks.updatedAt, input.task.expectedUpdatedAt),
					),
				)
				.returning();
			if (!task) throw new QueueEntryTransitionConflict();
			return { kind: "applied", entry, task };
		});
	} catch (error) {
		if (!(error instanceof QueueEntryTransitionConflict)) throw error;
		return {
			kind: "conflict",
			...(await readEntryAndTask(input.entry.id, input.task.id)),
		};
	}
}

export async function resumeImplementationQueueEntryWithoutRun(
	input: TransitionInput,
): Promise<TransitionResult> {
	try {
		return await db.transaction(async (transaction) => {
			const now = new Date();
			const [entry] = await transaction
				.update(implementationQueueEntries)
				.set({
					status: "queued",
					activeRunId: null,
					processorSlot: null,
					leaseOwnerId: null,
					leaseAcquiredAt: null,
					leaseExpiresAt: null,
					statusReason: null,
					claimReady: true,
					leaseVersion: sql`${implementationQueueEntries.leaseVersion} + 1`,
					updatedAt: now,
				})
				.where(
					and(
						eq(implementationQueueEntries.id, input.id),
						eq(implementationQueueEntries.status, input.expectedStatus),
						eq(
							implementationQueueEntries.leaseVersion,
							input.expectedLeaseVersion,
						),
						matchesActiveRun(
							implementationQueueEntries,
							input.expectedActiveRunId,
						),
					),
				)
				.returning();
			if (!entry) throw new QueueEntryTransitionConflict();
			return { kind: "applied", entry, task: null };
		});
	} catch (error) {
		if (!(error instanceof QueueEntryTransitionConflict)) throw error;
		const { entry } = await readEntryAndTask(input.id);
		return { kind: "conflict", entry, task: null };
	}
}

export async function recoverImplementationQueueEntryFromSnapshot(
	id: string,
	expected: { status: ImplementationQueueEntryStatus; leaseVersion: number },
	data: QueueEntryUpdate,
) {
	const [entry] = await db
		.update(implementationQueueEntries)
		.set({
			...data,
			leaseVersion: sql`${implementationQueueEntries.leaseVersion} + 1`,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(implementationQueueEntries.id, id),
				eq(implementationQueueEntries.status, expected.status),
				eq(implementationQueueEntries.leaseVersion, expected.leaseVersion),
			),
		)
		.returning();
	return entry ?? null;
}
