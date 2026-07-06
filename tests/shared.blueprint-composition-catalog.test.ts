import { describe, expect, it } from "vitest";
import { createPresetBlueprintNodeTree } from "../shared/blueprint-composition-catalog";

describe("blueprint-composition-catalog", () => {
	const mockLabels = {
		searchPlaceholder: "Search...",
		primarySignal: "Primary",
		secondarySignal: "Secondary",
		nextAction: "Next Action",
	};

	it("creates search_header preset node tree", () => {
		const result = createPresetBlueprintNodeTree({
			preset: "search_header",
			sectionId: "sec-1",
			sectionName: "Header",
			props: {
				placeholder: "Custom Search",
				actions: [{ id: "btn-1", label: "Click Me" }],
			},
			labels: mockLabels,
		});

		expect(result.kind).toBe("layout");
		expect(result.layout).toBe("stack");
		const childLayout = result.children[0];
		expect(childLayout.kind).toBe("layout");
		expect(childLayout.layout).toBe("row");
		expect(childLayout.children[0].component).toBe("Input");
		expect(childLayout.children[0].props.placeholder).toBe("Custom Search");
		expect(childLayout.children[1].children[0].component).toBe("Button");
		expect(childLayout.children[1].children[0].props.label).toBe("Click Me");
	});

	it("creates table_workspace preset node tree", () => {
		const result = createPresetBlueprintNodeTree({
			preset: "table_workspace",
			sectionId: "sec-2",
			sectionName: "Workspace",
			props: {
				actions: [{ id: "action-btn", label: "Do Action" }],
			},
			labels: mockLabels,
		});

		expect(result.kind).toBe("layout");
		expect(result.layout).toBe("stack");
		const toolbar = result.children[0];
		expect(toolbar.layout).toBe("row");
		expect(toolbar.children[0].component).toBe("Text");
		expect(toolbar.children[0].props.title).toBe("Workspace");
		expect(toolbar.children[1].children[0].component).toBe("Button");
		expect(result.children[1].component).toBe("DataTable");
	});

	it("creates metrics_overview preset node tree with custom items", () => {
		const result = createPresetBlueprintNodeTree({
			preset: "metrics_overview",
			sectionId: "sec-3",
			props: {
				items: [{ id: "m-1", label: "Traffic", value: "10k" }],
			},
			labels: mockLabels,
		});

		expect(result.kind).toBe("layout");
		expect(result.layout).toBe("grid");
		expect(result.children.length).toBe(1);
		expect(result.children[0].component).toBe("Card");
		expect(result.children[0].props.label).toBe("Traffic");
	});

	it("creates metrics_overview preset node tree with defaults if items omitted", () => {
		const result = createPresetBlueprintNodeTree({
			preset: "metrics_overview",
			sectionId: "sec-3",
			labels: mockLabels,
		});

		expect(result.kind).toBe("layout");
		expect(result.layout).toBe("grid");
		expect(result.children.length).toBe(3);
		expect(result.children[0].props.label).toBe("Primary");
		expect(result.children[1].props.label).toBe("Secondary");
		expect(result.children[2].props.label).toBe("Next Action");
	});

	it("creates kanban_board preset node tree", () => {
		const result = createPresetBlueprintNodeTree({
			preset: "kanban_board",
			sectionId: "sec-5",
			props: {
				columns: [
					{
						id: "col-todo",
						title: "To Do",
						cards: [{ title: "Task 1" }],
					},
				],
			},
			labels: mockLabels,
		});

		expect(result.kind).toBe("component");
		expect(result.component).toBe("KanbanTable");
		expect(result.props.columns).toEqual([
			{
				id: "col-todo",
				title: "To Do",
				cards: [{ title: "Task 1" }],
			},
		]);
	});

	it("falls back to stack and Card for unknown preset", () => {
		const result = createPresetBlueprintNodeTree({
			preset: "unknown_preset",
			sectionId: "sec-6",
			sectionName: "Fallback Section",
			labels: mockLabels,
		});

		expect(result.kind).toBe("layout");
		expect(result.layout).toBe("stack");
		expect(result.children[0].component).toBe("Card");
		expect(result.children[0].props.title).toBe("Fallback Section");
	});
});
