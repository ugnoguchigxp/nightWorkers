import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { renderableMockBlueprintSectionNames } from "../shared/schemas/mock-blueprint.schema";
import { BlueprintPreview } from "../src/modules/blueprint-preview/BlueprintPreview";
import { BlueprintPreviewSection } from "../src/modules/blueprint-preview/BlueprintPreviewSection";
import { sampleSectionProps } from "../src/modules/blueprint-section-sample/section-samples";

const sampleImage = "data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=";

const sampleContext = {
	base: {
		title: "Coverage Preview",
		subtitle: "Renderer smoke test",
		description: "Every renderable section should produce stable markup.",
	},
	sampleImage,
	sampleCards: () => [
		{
			title: "Design",
			label: "Design",
			description: "Design review",
			value: "82%",
			status: "Ready",
			meta: "Today",
		},
		{
			title: "Build",
			label: "Build",
			description: "Implementation",
			value: "64%",
			status: "Running",
			meta: "Tomorrow",
		},
		{
			title: "Review",
			label: "Review",
			description: "Verification",
			value: "91%",
			status: "Done",
			meta: "Friday",
		},
	],
	sampleColumns: () => [
		{ key: "name", label: "Name" },
		{ key: "status", label: "Status" },
		{ key: "owner", label: "Owner" },
	],
	sampleRows: () => [
		{ name: "Design", status: "Ready", owner: "Nina" },
		{ name: "Build", status: "Running", owner: "Kai" },
		{ name: "Review", status: "Done", owner: "Mina" },
	],
};

describe("Blueprint preview section renderers", () => {
	it.each(
		renderableMockBlueprintSectionNames,
	)("renders %s with generated sample props", (componentName) => {
		const props = sampleSectionProps(componentName, sampleContext);
		const markup = renderToStaticMarkup(
			createElement(BlueprintPreviewSection, {
				section: {
					id: componentName,
					componentName,
					props,
				},
			}),
		);

		expect(markup.length).toBeGreaterThan(20);
		expect(markup).toContain('data-preview-shell="transparent"');
	});

	it("renders composable preset and custom sections", () => {
		const presetMarkup = renderToStaticMarkup(
			createElement(BlueprintPreviewSection, {
				section: {
					id: "preset-kpi",
					kind: "preset_section",
					preset: "metric_grid",
					name: "Metrics",
					props: {
						title: "Coverage",
						cards: sampleContext.sampleCards(),
					},
				},
			}),
		);
		const customMarkup = renderToStaticMarkup(
			createElement(BlueprintPreviewSection, {
				section: {
					id: "custom-table",
					kind: "custom_section",
					root: {
						kind: "layout",
						layout: "grid",
						props: { columns: 2 },
						children: [
							{
								kind: "component",
								component: "Text",
								props: {
									title: "Custom summary",
									description: "Composable section body",
								},
							},
							{
								kind: "component",
								component: "DataTable",
								props: {
									columns: sampleContext.sampleColumns(),
									rows: sampleContext.sampleRows(),
								},
							},
						],
					},
					overrides: [
						{
							nodeId: "missing-node",
							props: { title: "Ignored override" },
						},
					],
				},
			}),
		);

		expect(presetMarkup).toContain("Coverage");
		expect(customMarkup).toContain("Custom summary");
		expect(customMarkup).toContain("Design");
	});

	it("renders a full blueprint preview with layout regions and meta", () => {
		const markup = renderToStaticMarkup(
			createElement(BlueprintPreview, {
				sessionId: null,
				messageId: "message-blueprint",
				blueprint: {
					id: "blueprint-coverage",
					name: "Coverage Workbench",
					summary: "A dashboard for coverage work.",
					designPreset: {
						theme: "mint",
						density: "compact",
						shape: "rounded",
					},
					meta: {
						selectedSections: [
							{ id: "hero", reason: "Primary signal" },
							{ id: "table", reason: "Operational detail" },
						],
						selectionSummary: "Representative app shell",
					},
				},
				screens: [
					{
						id: "screen-1",
						name: "Coverage Dashboard",
						layout: {
							type: "dashboard",
							sidebar: { region: "left" },
						},
						sections: [
							{
								id: "hero",
								componentName: "FullBleedHeroSection",
								region: "main",
								props: {
									title: "Coverage Dashboard",
									subtitle: "Frontend test progress",
									primaryAction: "Run coverage",
								},
							},
							{
								id: "table",
								componentName: "DataTableSection",
								region: "main",
								props: {
									title: "Files",
									columns: sampleContext.sampleColumns(),
									rows: sampleContext.sampleRows(),
								},
							},
							{
								id: "filters",
								componentName: "ExplorerSidebarSection",
								region: "sidebar",
								props: {
									title: "Filters",
									items: sampleContext.sampleCards(),
								},
							},
						],
					},
				],
			}),
		);

		expect(markup).toContain("Coverage Dashboard");
		expect(markup).toContain("Name");
		expect(markup).toContain("Explorer");
	});

	it("renders the empty blueprint preview state", () => {
		const markup = renderToStaticMarkup(
			createElement(BlueprintPreview, {
				blueprint: { id: "empty" },
				screens: [],
			}),
		);

		expect(markup).toContain("blueprint.preview.noScreens");
	});
});
