import { eq, sql } from "drizzle-orm";
import { db } from "../../db/client";
import { repositories } from "../../db/schema";

export type RepositoryFeatureSettingKey =
	| "projectExplorationCatalog"
	| "securityIntelligence";

export async function updateRepositoryFeatureSetting(
	id: string,
	key: RepositoryFeatureSettingKey,
	value: Record<string, unknown>,
) {
	const jsonPath = `$.${key}`;
	const encodedValue = JSON.stringify(value);
	const [repository] = await db
		.update(repositories)
		.set({
			featureSettings: sql`json_set(coalesce(${repositories.featureSettings}, json('{}')), ${jsonPath}, json(${encodedValue}))`,
			updatedAt: new Date(),
		})
		.where(eq(repositories.id, id))
		.returning();
	return repository;
}
