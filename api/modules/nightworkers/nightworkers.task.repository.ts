import { and, desc, eq } from "drizzle-orm";
import { type DbTransaction, db } from "../../db/client";
import type { TaskStatus } from "../../db/schema";
import { taskRevisionSnapshots, tasks } from "../../db/schema";
import { nightWorkersRealtimeBroker } from "../../services/realtime/nightworkers-ws";
import { canonicalDigest } from "../agentsShare";
import { flushActivityEventQueue } from "./nightworkers.activity.repository";

type Db = typeof db | DbTransaction;

export async function createTask(
	data: {
		repositoryId: string;
		title: string;
		description?: string | null;
		objective?: string | null;
		acceptanceCriteria?: string | null;
		worktreePath?: string | null;
		status?: TaskStatus;
		timeoutSeconds?: number;
		priority?: number;
		createdBy?: string | null;
	},
	database: Db = db,
) {
	const create = async (target: Db) => {
		const [task] = await target
			.insert(tasks)
			.values({ ...data, revision: 1 })
			.returning();
		if (!task) throw new Error("Failed to create Task");
		const snapshot = await createTaskRevisionSnapshot(target, task, {
			sourceKind: "canonical",
			createdBy: data.createdBy ?? null,
		});
		await target
			.update(tasks)
			.set({
				currentRevisionSnapshotId: snapshot.id,
				updatedAt: task.updatedAt,
			})
			.where(eq(tasks.id, task.id));
		return { ...task, currentRevisionSnapshotId: snapshot.id };
	};
	return database === db ? db.transaction(create) : create(database);
}

export async function getTask(id: string) {
	const [task] = await db.select().from(tasks).where(eq(tasks.id, id));
	return task;
}

export async function getTaskRevisionSnapshot(id: string) {
	const [snapshot] = await db
		.select()
		.from(taskRevisionSnapshots)
		.where(eq(taskRevisionSnapshots.id, id));
	return snapshot;
}

export async function getCurrentTaskRevisionSnapshot(taskId: string) {
	const [snapshot] = await db
		.select()
		.from(taskRevisionSnapshots)
		.where(eq(taskRevisionSnapshots.taskId, taskId))
		.orderBy(desc(taskRevisionSnapshots.revision))
		.limit(1);
	return snapshot;
}

export async function listTasks() {
	return db.select().from(tasks).orderBy(desc(tasks.createdAt));
}

export async function updateTaskStatus(id: string, status: TaskStatus) {
	const now = new Date();
	const [task] = await db
		.update(tasks)
		.set({
			status,
			updatedAt: now,
			...(status === "completed" ? { completedAt: now } : {}),
			...(status === "archived" ? { archivedAt: now } : {}),
		})
		.where(eq(tasks.id, id))
		.returning();
	if (task) {
		nightWorkersRealtimeBroker.publish(task.id, {
			type: "task_status_updated",
			payload: { status: task.status, task },
		});
	}
	return task;
}

export async function updateTaskCompiledPrompt(
	id: string,
	compiledPrompt: string,
) {
	const [task] = await db
		.update(tasks)
		.set({ compiledPrompt, updatedAt: new Date() })
		.where(eq(tasks.id, id))
		.returning();
	return task;
}

export async function updateTask(
	id: string,
	data: {
		title?: string;
		description?: string | null;
		objective?: string | null;
		acceptanceCriteria?: string | null;
		status?: TaskStatus;
		priority?: number;
	},
	options?: { expectedRevision?: number },
) {
	return db.transaction(async (tx) => {
		const [current] = await tx
			.select()
			.from(tasks)
			.where(eq(tasks.id, id))
			.limit(1);
		if (!current) return undefined;
		if (
			options?.expectedRevision !== undefined &&
			current.revision !== options.expectedRevision
		)
			return undefined;
		const semanticChanged = taskMeaningChanged(current, data);
		const nextRevision = semanticChanged
			? current.revision + 1
			: current.revision;
		const now = new Date();
		const [updated] = await tx
			.update(tasks)
			.set({ ...data, revision: nextRevision, updatedAt: now })
			.where(
				and(
					eq(tasks.id, id),
					eq(tasks.revision, current.revision),
					...(options?.expectedRevision !== undefined
						? [eq(tasks.revision, options.expectedRevision)]
						: []),
				),
			)
			.returning();
		if (!updated) return undefined;
		if (!semanticChanged) return updated;
		const snapshot = await createTaskRevisionSnapshot(tx, updated, {
			sourceKind: "canonical",
			createdBy: updated.createdBy ?? null,
		});
		await tx
			.update(tasks)
			.set({ currentRevisionSnapshotId: snapshot.id, updatedAt: now })
			.where(and(eq(tasks.id, id), eq(tasks.revision, nextRevision)));
		return { ...updated, currentRevisionSnapshotId: snapshot.id };
	});
}

export async function deleteTask(id: string) {
	await flushActivityEventQueue();
	return db.transaction(async (tx) => {
		const [task] = await tx
			.select()
			.from(tasks)
			.where(eq(tasks.id, id))
			.limit(1);
		if (!task) return undefined;
		const [deleted] = await tx
			.delete(tasks)
			.where(eq(tasks.id, id))
			.returning();
		return deleted;
	});
}

function taskMeaningChanged(
	current: typeof tasks.$inferSelect,
	update: {
		title?: string;
		description?: string | null;
		objective?: string | null;
		acceptanceCriteria?: string | null;
	},
) {
	return (
		(update.title !== undefined && update.title !== current.title) ||
		(update.description !== undefined &&
			update.description !== current.description) ||
		(update.objective !== undefined &&
			update.objective !== current.objective) ||
		(update.acceptanceCriteria !== undefined &&
			update.acceptanceCriteria !== current.acceptanceCriteria)
	);
}

async function createTaskRevisionSnapshot(
	database: Db,
	task: Pick<
		typeof tasks.$inferSelect,
		| "id"
		| "revision"
		| "title"
		| "description"
		| "objective"
		| "acceptanceCriteria"
	>,
	input: {
		sourceKind: "canonical" | "legacy_migration";
		createdBy: string | null;
	},
) {
	const canonical = {
		taskId: task.id,
		revision: task.revision,
		title: task.title,
		description: task.description,
		objective: task.objective,
		acceptanceCriteria: task.acceptanceCriteria,
		specificationRefs: [] as string[],
	};
	const [snapshot] = await database
		.insert(taskRevisionSnapshots)
		.values({
			...canonical,
			digest: canonicalDigest(canonical),
			specificationRefsJson: [],
			sourceKind: input.sourceKind,
			createdBy: input.createdBy,
		})
		.returning();
	if (!snapshot) throw new Error("Failed to create Task revision snapshot");
	return snapshot;
}
