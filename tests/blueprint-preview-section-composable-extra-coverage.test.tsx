import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BlueprintPreviewSection } from "../src/modules/blueprint-preview/BlueprintPreviewSection";

describe("BlueprintPreviewSection composable extra coverage", () => {
	it("renders every composable component node branch", () => {
		const components = [
			node("text", "Text", { title: "Text title", description: "Text body" }),
			node("text-empty", "Text", { name: "Text name" }),
			node("button", "Button", { label: "Button" }),
			node("icon", "IconButton", { title: "Icon" }),
			node("input", "Input", { placeholder: "Input placeholder" }),
			node("input-group", "InputGroup", { label: "Input group" }),
			node("select", "Select", { name: "Select" }),
			node("table", "DataTable", {
				columns: [
					{ key: "name", label: "Name" },
					{ key: "status", label: "Status" },
				],
				rows: [{ name: "Build", status: "Ready" }],
			}),
			node("table-alias", "Table", {
				columns: ["name"],
				rows: [{ name: "Alias" }],
			}),
			node("kanban-default", "KanbanTable", {}),
			node("kanban-custom", "KanbanTable", {
				columns: [
					{
						id: "todo",
						title: "Todo",
						cards: [
							{
								title: "Task",
								priority: "high",
								assignee: "Agent",
								dueDate: "Today",
							},
							{ label: "Fallback labels", badge: "new", owner: "Owner" },
						],
					},
					{ key: "doing", label: "Doing", items: [{ name: "Work" }] },
					{ title: "Done", tasks: [] },
					{},
				],
			}),
			node("list", "List", {
				label: "List",
				items: [
					{ id: "one", title: "One", description: "Description" },
					{ label: "Two" },
					{},
				],
			}),
			node("list-default", "List", { title: "Default list" }),
			node("badge", "Badge", { label: "Badge" }),
			node("alert", "Alert", { title: "Alert", body: "Alert body" }),
			node("alert-empty", "Alert", { label: "Empty alert" }),
			node("progress", "Progress", { title: "Progress", value: 140 }),
			node("progress-invalid", "Progress", { value: "invalid" }),
			node("unknown", "Unknown", {
				name: "Unknown card",
				content: "Unknown description",
			}),
			node("unknown-empty", "Other", {}),
		];
		const markup = renderSection({
			id: "components",
			kind: "custom_section",
			root: {
				kind: "layout",
				layout: "grid",
				props: { columns: 8 },
				children: components,
			},
		});

		for (const text of [
			"Text title",
			"Button",
			"Input placeholder",
			"Build",
			"Define section props",
			"Fallback labels",
			"Default list",
			"Badge",
			"Alert body",
			"Unknown description",
		]) {
			expect(markup).toContain(text);
		}
		expect(markup).toContain("repeat(4, minmax(0, 1fr))");
	});

	it.each([
		["row", "1/2"],
		["split", "1/3"],
		["stack", "2/3"],
		["other", "auto"],
		["grid", "fill"],
	])("renders %s layout and %s width", (layout, width) => {
		const markup = renderSection({
			id: `${layout}-${width}`,
			kind: "custom_section",
			root: {
				kind: "layout",
				layout,
				props: layout === "grid" ? { columns: 0 } : "invalid",
				children: [
					{
						...node("child", "Text", { label: `${layout} ${width}` }),
						layout: width === "fill" ? null : { width },
					},
				],
			},
		});
		expect(markup).toContain(`${layout} ${width}`);
	});

	it("renders preset normalization, fallback, and invalid custom roots", () => {
		const preset = renderSection({
			id: "preset",
			kind: "preset_section",
			preset: "metric_grid",
			name: 123,
			props: "invalid",
			overrides: "invalid",
		});
		expect(preset).toContain("preset");

		const unknown = renderSection({
			id: "legacy",
			componentName: "NotASection",
			props: null,
		});
		expect(unknown).toContain("blueprint.preview.sectionFallbackText");

		const invalidRoot = renderSection({
			id: "invalid-root",
			kind: "custom_section",
			root: { kind: "unknown" },
		});
		expect(invalidRoot).toContain('data-preview-shell="transparent"');
	});
});

function renderSection(section: Record<string, unknown>) {
	return renderToStaticMarkup(<BlueprintPreviewSection section={section} />);
}

function node(
	id: string,
	component: string,
	props: Record<string, unknown> | unknown,
) {
	return { id, kind: "component", component, props };
}
