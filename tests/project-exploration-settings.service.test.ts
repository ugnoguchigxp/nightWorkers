import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getRepository: vi.fn(),
	updateRepositoryFeatureSettings: vi.fn(),
}));

vi.mock("../api/modules/nightworkers/nightworkers.repository", () => mocks);

import {
	getProjectExplorationCatalogSettings,
	readProjectExplorationCatalogSettings,
	saveProjectExplorationCatalogSettings,
} from "../api/modules/ontology/exploration/project-exploration-settings.service";

describe("project exploration catalog settings", () => {
	beforeEach(() => {
		mocks.getRepository.mockReset();
		mocks.updateRepositoryFeatureSettings.mockReset();
	});

	it("fails closed for missing or invalid settings", () => {
		for (const value of [
			null,
			{},
			{
				projectExplorationCatalog: {
					enabled: true,
					mcpServerId: null,
					unknown: true,
				},
			},
		]) {
			expect(readProjectExplorationCatalogSettings(value)).toEqual({
				enabled: false,
				mcpServerId: null,
			});
		}
	});

	it("reads the isolated sibling key", async () => {
		mocks.getRepository.mockResolvedValue({
			id: "repo-1",
			featureSettings: {
				securityIntelligence: { ontologyToolsEnabled: true },
				projectExplorationCatalog: {
					enabled: true,
					mcpServerId: "server-1",
				},
			},
		});
		await expect(
			getProjectExplorationCatalogSettings("repo-1"),
		).resolves.toEqual({ enabled: true, mcpServerId: "server-1" });
	});

	it("preserves every sibling feature setting on save", async () => {
		mocks.getRepository.mockResolvedValue({
			id: "repo-1",
			featureSettings: {
				securityIntelligence: { ontologyToolsEnabled: true },
				customFeature: { enabled: true },
			},
		});
		mocks.updateRepositoryFeatureSettings.mockResolvedValue({ id: "repo-1" });
		await expect(
			saveProjectExplorationCatalogSettings("repo-1", {
				enabled: true,
				mcpServerId: null,
			}),
		).resolves.toEqual({ enabled: true, mcpServerId: null });
		expect(mocks.updateRepositoryFeatureSettings).toHaveBeenCalledWith(
			"repo-1",
			{
				securityIntelligence: { ontologyToolsEnabled: true },
				customFeature: { enabled: true },
				projectExplorationCatalog: { enabled: true, mcpServerId: null },
			},
		);
	});
});
