import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db/client";
import { repositories, taskGitWorkspaces } from "../../db/schema";
import { inspectProjectRepositoryIdentity } from "./project-repository-identity";

export async function previewProjectRepositoryIdentityBackfill(
	repositoryId?: string,
) {
	const projects = repositoryId
		? await db
				.select()
				.from(repositories)
				.where(eq(repositories.id, repositoryId))
		: await db.select().from(repositories);
	return Promise.all(
		projects.map(async (project) => {
			const observed = await inspectProjectRepositoryIdentity(
				project.registeredRootCanonical ?? project.localPath,
			);
			const expected = {
				repositoryKind: project.repositoryKind,
				status: project.repositoryIdentityStatus,
				registeredRootCanonical: project.registeredRootCanonical,
				gitCommonDirCanonical: project.gitCommonDirCanonical,
				baseWorktreePathCanonical: project.baseWorktreePathCanonical,
				baseWorktreeId: project.baseWorktreeId,
				digest: project.repositoryIdentityDigest,
				revision: project.repositoryIdentityRevision,
				verifiedAt: project.repositoryIdentityVerifiedAt?.toISOString() ?? null,
			};
			const changedFields = Object.entries({
				repositoryKind: expected.repositoryKind !== observed.repositoryKind,
				status: expected.status !== observed.status,
				registeredRootCanonical:
					expected.registeredRootCanonical !== observed.registeredRootCanonical,
				gitCommonDirCanonical:
					expected.gitCommonDirCanonical !== observed.gitCommonDirCanonical,
				baseWorktreePathCanonical:
					expected.baseWorktreePathCanonical !==
					observed.baseWorktreePathCanonical,
				baseWorktreeId: expected.baseWorktreeId !== observed.baseWorktreeId,
				digest: expected.digest !== observed.digest,
			})
				.filter(([, changed]) => changed)
				.map(([field]) => field);
			return {
				repositoryId: project.id,
				expected,
				observed,
				changedFields,
				needsBackfill: changedFields.length > 0,
			};
		}),
	);
}

export async function applyProjectRepositoryIdentityBackfill(input: {
	repositoryId: string;
	expectedRevision: number;
}) {
	const [project] = await db
		.select()
		.from(repositories)
		.where(eq(repositories.id, input.repositoryId));
	if (!project) throw new Error("PROJECT_NOT_FOUND");
	if (project.repositoryIdentityRevision !== input.expectedRevision) {
		throw new Error("PROJECT_IDENTITY_REVISION_CONFLICT");
	}
	const [workspace] = await db
		.select({ id: taskGitWorkspaces.id })
		.from(taskGitWorkspaces)
		.where(eq(taskGitWorkspaces.repositoryId, input.repositoryId))
		.limit(1);
	if (workspace) throw new Error("PROJECT_IDENTITY_BACKFILL_HAS_WORKSPACES");
	const observed = await inspectProjectRepositoryIdentity(
		project.registeredRootCanonical ?? project.localPath,
	);
	const [updated] = await db
		.update(repositories)
		.set({
			repositoryKind: observed.repositoryKind,
			repositoryIdentityStatus: observed.status,
			registeredRootCanonical: observed.registeredRootCanonical,
			gitCommonDirCanonical: observed.gitCommonDirCanonical,
			baseWorktreePathCanonical: observed.baseWorktreePathCanonical,
			baseWorktreeId: observed.baseWorktreeId,
			baseWorktreeBranch: observed.observedBranch,
			baseWorktreeHeadSha: observed.observedHeadSha,
			baseWorktreeDirty: observed.baseWorktreeDirty,
			repositoryIdentityDigest: observed.digest,
			repositoryIdentityRevision: sql`${repositories.repositoryIdentityRevision} + 1`,
			repositoryIdentityVerifiedAt: new Date(observed.verifiedAt),
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(repositories.id, input.repositoryId),
				eq(repositories.repositoryIdentityRevision, input.expectedRevision),
			),
		)
		.returning();
	if (!updated) throw new Error("PROJECT_IDENTITY_REVISION_CONFLICT");
	return updated;
}
