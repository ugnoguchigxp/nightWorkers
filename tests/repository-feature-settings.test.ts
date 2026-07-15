import crypto from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
	createRepository,
	deleteRepository,
	getRepository,
} from "../api/modules/nightworkers/nightworkers.repository";
import { updateRepositoryFeatureSetting } from "../api/modules/nightworkers/repository-feature-settings.repository";

const repositoryIds: string[] = [];

afterEach(async () => {
	for (const id of repositoryIds.splice(0)) await deleteRepository(id);
});

describe("repository feature setting updates", () => {
	it("preserves sibling settings across concurrent keyed updates", async () => {
		const repository = await createRepository({
			name: `feature-settings-${crypto.randomUUID()}`,
			localPath: "/tmp/feature-settings",
			branch: "main",
			allowed: true,
		});
		repositoryIds.push(repository.id);

		await Promise.all([
			updateRepositoryFeatureSetting(repository.id, "securityIntelligence", {
				securityOracleEnabled: true,
			}),
			updateRepositoryFeatureSetting(
				repository.id,
				"projectExplorationCatalog",
				{ enabled: true, mcpServerId: "server-1" },
			),
		]);

		await expect(getRepository(repository.id)).resolves.toMatchObject({
			featureSettings: {
				securityIntelligence: { securityOracleEnabled: true },
				projectExplorationCatalog: {
					enabled: true,
					mcpServerId: "server-1",
				},
			},
		});
	});
});
