import { describe, expect, it } from "vitest";
import type {
	MockBlueprint,
	MockBlueprintDataset,
	MockBlueprintScreen,
} from "../shared/schemas/mock-blueprint.schema";
import {
	mockBlueprintToPreviewBlueprint,
	mockBlueprintToPreviewBlueprintSafely,
} from "../src/modules/blueprint-preview/mockBlueprintAdapter";

const createMockBlueprint = (dataset: MockBlueprintDataset): MockBlueprint => ({
	id: "bp-1",
	name: "Mock Blueprint",
	version: 1,
	summary: "Summary info",
	meta: {
		selectedSections: [],
		selectionSummary: "Selection details",
	},
	screens: [
		{
			id: "screen-1",
			name: "Dashboard",
			path: "/dashboard",
			layout: {
				template: "dashboard",
			},
			purpose: "General dashboard",
			sections: [
				{
					id: "section-1",
					name: "My Section",
					componentName: "DataTableSection",
					selectionReason: "Displays primary data",
					copy: {
						title: "Section title",
						description: "Section description",
						emptyStateTitle: "No data",
						emptyStateDescription: "Please add some data",
						primaryActionLabel: "Add item",
						secondaryActionLabel: "Cancel",
					},
					dataset,
				},
			],
		},
	],
});

describe("mockBlueprintAdapter module", () => {
	it("safely handles parsing invalid formats", () => {
		expect(mockBlueprintToPreviewBlueprintSafely(null)).toBeNull();
		expect(mockBlueprintToPreviewBlueprintSafely({ invalid: true })).toBeNull();
	});

	it("correctly converts all dataset types", () => {
		const datasets = [
			{ kind: "navigation", items: [{ label: "Home", href: "/" }] },
			{
				kind: "table",
				columns: [{ key: "id", label: "ID" }],
				rows: [{ id: 1 }],
			},
			{
				kind: "form",
				fields: [{ name: "email", type: "email", label: "Email" }],
				submitLabel: "Save",
			},
			{
				kind: "cards",
				cards: [
					{
						title: "Card 1",
						description: "Desc",
						meta: "New",
						actionLabel: "View",
					},
				],
			},
			{
				kind: "kanban",
				columns: [
					{
						id: "todo",
						label: "Todo",
						cards: [{ title: "Task 1", description: "Desc", meta: "High" }],
					},
				],
			},
			{
				kind: "timeline",
				items: [
					{ title: "Step 1", description: "First step", timestamp: "12:00" },
				],
			},
			{
				kind: "article",
				title: "My Article",
				body: "Content here",
				meta: "Draft",
			},
			{
				kind: "metrics",
				metrics: [{ label: "Revenue", value: "$100", trend: "+5%" }],
			},
			{
				kind: "media",
				items: [
					{
						title: "Image 1",
						description: "A test image",
						mediaLabel: "img-1",
					},
				],
			},
			{
				kind: "map",
				points: [
					{
						latitude: 35.6,
						longitude: 139.6,
						label: "Tokyo",
						description: "Capital",
					},
				],
			},
			{
				kind: "code",
				files: [
					{
						path: "index.js",
						language: "javascript",
						excerpt: "console.log(1)",
					},
				],
			},
			{
				kind: "chat",
				messages: [{ author: "Alice", body: "Hello", state: "sent" }],
			},
			{ kind: "generic", items: ["item1", "item2"] },
		];

		for (const dataset of datasets) {
			const mockBp = createMockBlueprint(dataset);
			const previewBp = mockBlueprintToPreviewBlueprint(mockBp);
			expect(previewBp.id).toBe("bp-1");
			expect(previewBp.screens.length).toBe(1);
			const firstScreen = previewBp.screens[0] as MockBlueprintScreen;
			expect(firstScreen.sections.length).toBe(1);
			expect(firstScreen.sections[0].props).toBeDefined();
		}
	});

	it("infers layout template based on sidebar/aside sections", () => {
		const baseBlueprint = createMockBlueprint({ kind: "generic", items: [] });
		baseBlueprint.screens[0].sections = [
			{
				id: "sec-1",
				name: "Sec 1",
				componentName: "TopMenuSection",
				region: "header",
				selectionReason: "header menu",
				copy: { title: "Header" },
				dataset: { kind: "generic", items: [] },
			},
			{
				id: "sec-2",
				name: "Sec 2",
				componentName: "RightSidebarLinksSection",
				region: "sidebar", // force sidebar layout
				selectionReason: "sidebar links",
				copy: { title: "Sidebar" },
				dataset: { kind: "generic", items: [] },
			},
			{
				id: "sec-3",
				name: "Sec 3",
				componentName: "RightSidebarLinksSection",
				region: "aside", // force aside layout
				selectionReason: "aside links",
				copy: { title: "Aside" },
				dataset: { kind: "generic", items: [] },
			},
		];

		const previewBp = mockBlueprintToPreviewBlueprint(baseBlueprint);
		const firstScreen = previewBp.screens[0] as MockBlueprintScreen;
		expect(firstScreen.layout.template).toBe("three_column");
	});
});
