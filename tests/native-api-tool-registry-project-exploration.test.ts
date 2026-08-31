import { describe, expect, it } from "vitest";
import { requiresFlatToolArgumentsForEndpointKind } from "../api/modules/codingAgent/runtime/native-api-runner/native-api-run-route-preparation";
import { getNativeApiToolDefinitions } from "../api/modules/codingAgent/runtime/native-api-runner/native-api-tool-registry";

describe("native API Project Exploration tool profile", () => {
	it("uses flat tool arguments for Azure-compatible function calling", () => {
		expect(requiresFlatToolArgumentsForEndpointKind("azure")).toBe(true);
		expect(requiresFlatToolArgumentsForEndpointKind("codex")).toBe(false);
	});

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

		const defaultTodo = getNativeApiToolDefinitions().find(
			(tool) => tool.name === "todo_list",
		);
		const compatibleTodo = getNativeApiToolDefinitions({
			flatToolArguments: true,
		}).find((tool) => tool.name === "todo_list");
		expect(defaultTodo?.inputSchema).toHaveProperty("properties.command");
		expect(compatibleTodo?.inputSchema).not.toHaveProperty(
			"properties.command",
		);
		expect(compatibleTodo?.inputSchema).not.toHaveProperty("oneOf");
		expect(compatibleTodo?.inputSchema).toHaveProperty("required", ["op"]);
		expect(JSON.stringify(compatibleTodo?.inputSchema)).not.toContain(
			'"steps"',
		);
	});
});
