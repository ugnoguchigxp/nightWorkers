import { describe, expect, it } from "vitest";
import { getNativeApiToolDefinitions } from "../api/modules/codingAgent/runtime/native-api-runner/native-api-tool-registry";

describe("native API Project Exploration tool profile", () => {
	it("publishes the catalog definition only for an eligible run", () => {
		const unavailable = getNativeApiToolDefinitions().map((tool) => tool.name);
		const availableDefinitions = getNativeApiToolDefinitions({
			projectExplorationCatalogEnabled: true,
		});
		const available = availableDefinitions.map((tool) => tool.name);

		expect(unavailable).not.toContain("project_exploration_catalog");
		expect(available).toContain("project_exploration_catalog");
		const catalog = availableDefinitions.find(
			(tool) => tool.name === "project_exploration_catalog",
		);
		expect(catalog?.inputSchema).toMatchObject({
			type: "object",
			properties: {
				paths: { type: "array", maxItems: 10 },
				modules: { type: "array", maxItems: 5 },
				terms: { type: "array", maxItems: 10 },
			},
		});
		expect(catalog?.inputSchema).not.toHaveProperty("properties.focus");
	});
});
