import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { renderableMockBlueprintSectionNames } from "../shared/schemas/mock-blueprint.schema";
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
});
