import { describe, expect, it } from "vitest";
import { renderBlueprintMarkdown } from "../api/services/blueprints/draft";
import { representativeAppBlueprint } from "./fixtures/app-blueprint";

describe("Blueprint draft rendering", () => {
	it("renders concrete sections, bindings, and implementation tasks for review", () => {
		const markdown = renderBlueprintMarkdown({
			...representativeAppBlueprint,
			screens: [
				{
					...representativeAppBlueprint.screens[0],
					sections: [
						{
							...representativeAppBlueprint.screens[0].sections[0],
							intent:
								"Show sales pipeline health before implementation starts.",
							props: {
								title: "Pipeline KPIs",
								items: [
									{ label: "Open pipeline", value: "¥12.4M" },
									{ label: "Win rate", value: "42%" },
								],
							},
						},
					],
				},
			],
		});

		expect(markdown).toContain("Pipeline KPIs");
		expect(markdown).toContain("Open pipeline: ¥12.4M");
		expect(markdown).toContain("## Design Direction");
		expect(markdown).toContain("## Screen Composition");
		expect(markdown).not.toContain("## Data Model");
		expect(markdown).not.toContain("## Bindings");
		expect(markdown).toContain("## Implementation Tasks");
		expect(markdown).toContain("Implement command center");
	});

	it("renders preset overrides and custom section roots for review", () => {
		const markdown = renderBlueprintMarkdown({
			...representativeAppBlueprint,
			databaseSchema: { tables: [], relations: [] },
			dataBindings: [],
			screens: [
				{
					...representativeAppBlueprint.screens[0],
					sections: [
						{
							kind: "preset_section",
							id: "customers-search",
							preset: "search_header",
							props: { title: "Customers" },
							overrides: [
								{
									target: "searchInput",
									set: { layout: { width: "1/2" } },
								},
							],
							actions: [],
						},
						{
							kind: "custom_section",
							id: "operations-overview",
							root: {
								kind: "layout",
								id: "root",
								layout: "grid",
								props: {},
								children: [],
							},
							actions: [],
						},
					],
				},
			],
		});

		expect(markdown).toContain("preset: `search_header`");
		expect(markdown).toContain("Overrides: searchInput");
		expect(markdown).toContain("Root: layout #root (grid) 0 children");
	});
});
