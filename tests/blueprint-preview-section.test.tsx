import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BlueprintPreviewSection } from "../src/modules/blueprint-preview/BlueprintPreviewSection";

describe("BlueprintPreviewSection component", () => {
	it("renders various component kinds under custom_section", () => {
		const components = [
			{
				kind: "custom_section",
				root: {
					kind: "layout",
					layout: "grid",
					props: { columns: 3 },
					children: [
						{
							kind: "component",
							component: "Text",
							props: { title: "Title A", description: "Desc A" },
						},
						{
							kind: "component",
							component: "Button",
							props: { label: "Click Me" },
						},
						{
							kind: "component",
							component: "Input",
							props: { placeholder: "Write here" },
						},
						{
							kind: "component",
							component: "DataTable",
							props: {
								columns: [{ key: "id", label: "ID" }],
								rows: [{ id: 10 }],
							},
						},
						{
							kind: "component",
							component: "KanbanTable",
							props: {
								columns: [
									{
										key: "todo",
										title: "Todo",
										cards: [
											{ title: "Task 1", priority: "High", assignee: "Bob" },
										],
									},
								],
							},
						},
						{
							kind: "component",
							component: "List",
							props: {
								title: "My List",
								items: [{ title: "Item 1", description: "Desc 1" }],
							},
						},
						{ kind: "component", component: "Badge", props: { title: "New" } },
						{
							kind: "component",
							component: "Alert",
							props: { title: "Danger", description: "Something failed" },
						},
						{
							kind: "component",
							component: "Progress",
							props: { title: "Loading", value: 65 },
						},
					],
				},
			},
			// layout width tests
			{
				kind: "custom_section",
				root: {
					kind: "layout",
					layout: "row",
					children: [
						{ kind: "component", component: "Text", layout: { width: "1/2" } },
						{ kind: "component", component: "Text", layout: { width: "1/3" } },
						{ kind: "component", component: "Text", layout: { width: "2/3" } },
						{ kind: "component", component: "Text", layout: { width: "auto" } },
					],
				},
			},
		];

		for (const section of components) {
			const markup = renderToStaticMarkup(
				<BlueprintPreviewSection section={section} />,
			);
			expect(markup).toBeDefined();
		}
	});

	it("renders fallback text for unknown component", () => {
		const section = {
			kind: "custom_section",
			root: {
				kind: "component",
				component: "UnknownWidget",
				props: { title: "Fallback Test" },
			},
		};

		const markup = renderToStaticMarkup(
			<BlueprintPreviewSection section={section} />,
		);
		expect(markup).toContain("Fallback Test");
	});
});
