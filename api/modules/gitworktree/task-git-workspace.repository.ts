import { and, eq, isNull, lt, lte, or, sql } from "drizzle-orm";
import { type DbTransaction, db } from "../../db/client";
import { taskGitWorkspaces } from "../../db/schema";

type Db = typeof db | DbTransaction;

export async function getTaskGitWorkspace(taskId: string, database: Db = db) {
	const [workspace] = await database
		.select()
		.from(taskGitWorkspaces)
		.where(eq(taskGitWorkspaces.taskId, taskId))
		.limit(1);
	return workspace ?? null;
}

export async function getTaskGitWorkspaceById(id: string, database: Db = db) {
	const [workspace] = await database
		.select()
		.from(taskGitWorkspaces)
		.where(eq(taskGitWorkspaces.id, id))
		.limit(1);
	return workspace ?? null;
}

export async function createTaskGitWorkspace(
	data: typeof taskGitWorkspaces.$inferInsert,
	database: Db = db,
) {
	const [workspace] = await database
		.insert(taskGitWorkspaces)
		.values(data)
		.returning();
	return workspace;
}

export async function updateTaskGitWorkspace(
	id: string,
	data: Partial<typeof taskGitWorkspaces.$inferInsert>,
	database: Db = db,
) {
	const [workspace] = await database
		.update(taskGitWorkspaces)
		.set({ ...data, updatedAt: new Date() })
		.where(eq(taskGitWorkspaces.id, id))
		.returning();
	return workspace ?? null;
}

export async function transitionTaskGitWorkspace(
	input: {
		id: string;
		expectedStatus: string;
		data: Partial<typeof taskGitWorkspaces.$inferInsert>;
	},
	database: Db = db,
) {
	const [workspace] = await database
		.update(taskGitWorkspaces)
		.set({ ...input.data, updatedAt: new Date() })
		.where(
			and(
				eq(taskGitWorkspaces.id, input.id),
				eq(taskGitWorkspaces.status, input.expectedStatus),
			),
		)
		.returning();
	return workspace ?? null;
}

export async function claimTaskGitWorkspaceInitialization(
	input: {
		id: string;
		leaseOwner: string;
		leaseExpiresAt: Date;
		maxAttempts: number;
	},
	database: Db = db,
) {
	const now = new Date();
	const [workspace] = await database
		.update(taskGitWorkspaces)
		.set({
			leaseOwner: input.leaseOwner,
			leaseExpiresAt: input.leaseExpiresAt,
			initializationAttempt: sql`${taskGitWorkspaces.initializationAttempt} + 1`,
			updatedAt: now,
		})
		.where(
			and(
				eq(taskGitWorkspaces.id, input.id),
				eq(taskGitWorkspaces.status, "initializing"),
				lt(taskGitWorkspaces.initializationAttempt, input.maxAttempts),
				or(
					isNull(taskGitWorkspaces.leaseOwner),
					isNull(taskGitWorkspaces.leaseExpiresAt),
					lte(taskGitWorkspaces.leaseExpiresAt, now),
				),
			),
		)
		.returning();
	return workspace ?? null;
}

export async function renewTaskGitWorkspaceInitializationLease(
	input: { id: string; leaseOwner: string; leaseExpiresAt: Date },
	database: Db = db,
) {
	const [workspace] = await database
		.update(taskGitWorkspaces)
		.set({
			leaseExpiresAt: input.leaseExpiresAt,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(taskGitWorkspaces.id, input.id),
				eq(taskGitWorkspaces.status, "initializing"),
				eq(taskGitWorkspaces.leaseOwner, input.leaseOwner),
			),
		)
		.returning({ id: taskGitWorkspaces.id });
	return Boolean(workspace);
}

export async function transitionClaimedTaskGitWorkspaceInitialization(
	input: {
		id: string;
		leaseOwner: string;
		data: Partial<typeof taskGitWorkspaces.$inferInsert>;
	},
	database: Db = db,
) {
	const [workspace] = await database
		.update(taskGitWorkspaces)
		.set({
			...input.data,
			leaseOwner: null,
			leaseExpiresAt: null,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(taskGitWorkspaces.id, input.id),
				eq(taskGitWorkspaces.status, "initializing"),
				eq(taskGitWorkspaces.leaseOwner, input.leaseOwner),
			),
		)
		.returning();
	return workspace ?? null;
}
