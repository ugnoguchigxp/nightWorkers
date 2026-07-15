import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getRepository: vi.fn(),
	updateRepositoryFeatureSetting: vi.fn(),
}));

vi.mock("../api/modules/nightworkers/nightworkers.repository", () => ({
	getRepository: mocks.getRepository,
}));
vi.mock(
	"../api/modules/nightworkers/repository-feature-settings.repository",
	() => ({
		updateRepositoryFeatureSetting: mocks.updateRepositoryFeatureSetting,
	}),
);

import {
	getProjectExplorationCatalogSettings,
	readProjectExplorationCatalogSettings,
	saveProjectExplorationCatalogSettings,
} from "../api/modules/ontology/exploration/project-exploration-settings.service";

describe("project exploration catalog settings", () => {
	beforeEach(() => {
		mocks.getRepository.mockReset();
		mocks.updateRepositoryFeatureSetting.mockReset();
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

	it("uses a keyed update so sibling feature settings are preserved atomically", async () => {
		mocks.getRepository.mockResolvedValue({
			id: "repo-1",
			featureSettings: {
				securityIntelligence: { ontologyToolsEnabled: true },
				customFeature: { enabled: true },
			},
		});
		mocks.updateRepositoryFeatureSetting.mockResolvedValue({ id: "repo-1" });
		await expect(
			saveProjectExplorationCatalogSettings("repo-1", {
				enabled: true,
				mcpServerId: null,
			}),
		).resolves.toEqual({ enabled: true, mcpServerId: null });
		expect(mocks.updateRepositoryFeatureSetting).toHaveBeenCalledWith(
			"repo-1",
			"projectExplorationCatalog",
			{ enabled: true, mcpServerId: null },
		);
	});

	it("reports a repository deleted during the atomic update", async () => {
		mocks.getRepository.mockResolvedValue({
			id: "repo-1",
			featureSettings: {},
		});
		mocks.updateRepositoryFeatureSetting.mockResolvedValue(undefined);
		await expect(
			saveProjectExplorationCatalogSettings("repo-1", {
				enabled: false,
				mcpServerId: null,
			}),
		).rejects.toThrow("Repository not found");
	});
});
