import crypto from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "../../db/client";
import { repositoryGitMutationLeases } from "../../db/schema";
import { AppError } from "../../lib/errors";

export async function withRepositoryGitMutationLock<T>(
	repositoryId: string,
	operation: "workspace_provision" | "commit" | "merge" | "cleanup",
	fn: () => Promise<T>,
): Promise<T> {
	const ownerId = crypto.randomUUID();
	const now = new Date();
	const expiresAt = new Date(now.getTime() + 120_000);
	const [lease] = await db
		.insert(repositoryGitMutationLeases)
		.values({
			repositoryId,
			ownerId,
			operation,
			leaseVersion: 1,
			acquiredAt: now,
			expiresAt,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: repositoryGitMutationLeases.repositoryId,
			set: {
				ownerId,
				operation,
				leaseVersion: sql`${repositoryGitMutationLeases.leaseVersion} + 1`,
				acquiredAt: now,
				expiresAt,
				updatedAt: now,
			},
			setWhere: lt(repositoryGitMutationLeases.expiresAt, now),
		})
		.returning();
	if (!lease || lease.ownerId !== ownerId)
		throw new AppError(
			409,
			"repository_git_mutation_locked",
			"Repository Git mutation is already in progress",
		);
	try {
		return await fn();
	} finally {
		await db
			.delete(repositoryGitMutationLeases)
			.where(
				and(
					eq(repositoryGitMutationLeases.repositoryId, repositoryId),
					eq(repositoryGitMutationLeases.ownerId, ownerId),
					eq(repositoryGitMutationLeases.leaseVersion, lease.leaseVersion),
				),
			);
	}
}
