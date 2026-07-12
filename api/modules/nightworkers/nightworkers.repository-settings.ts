import { and, eq } from "drizzle-orm";
import type { ProjectGitIntegrationPolicy } from "../../../shared/schemas/git-integration.schema";
import { db } from "../../db/client";
import { repositories } from "../../db/schema";

type RepositorySafetyPolicy = typeof repositories.$inferInsert.safetyPolicy;

export async function updateRepository(
	id: string,
	data: {
		queueEnabled?: boolean;
		maxConcurrentSessions?: number;
		safetyPolicy?: RepositorySafetyPolicy;
		projectMeta?: Record<string, unknown> | null;
		featureSettings?: Record<string, unknown> | null;
		branch?: string;
		gitIntegrationPolicyJson?: ProjectGitIntegrationPolicy | null;
		gitIntegrationVersion?: number;
	},
	expectedGitIntegrationVersion?: number,
) {
	const [repository] = await db
		.update(repositories)
		.set({ ...data, updatedAt: new Date() })
		.where(
			expectedGitIntegrationVersion === undefined
				? eq(repositories.id, id)
				: and(
						eq(repositories.id, id),
						eq(
							repositories.gitIntegrationVersion,
							expectedGitIntegrationVersion,
						),
					),
		)
		.returning();
	return repository;
}
