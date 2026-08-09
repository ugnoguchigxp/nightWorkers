import { describe, expect, it } from "vitest";
import { getNativeApiToolDefinitions } from "../api/modules/codingAgent/runtime/native-api-runner/native-api-tool-registry";

describe("native API Project Exploration tool profile", () => {
	it("publishes the catalog definition only for an eligible run", () => {
		const unavailable = getNativeApiToolDefinitions().map((tool) => tool.name);
		const available = getNativeApiToolDefinitions({
			projectExplorationCatalogEnabled: true,
		}).map((tool) => tool.name);

		expect(unavailable).not.toContain("project_exploration_catalog");
		expect(available).toContain("project_exploration_catalog");
	});
});
