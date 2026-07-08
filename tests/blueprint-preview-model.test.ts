import type { TFunction } from "i18next";
import { describe, expect, it, vi } from "vitest";
import {
	chartPreviewItems,
	compactChartLabel,
	isObject,
	labelForOption,
	labelForOptionA11y,
	previewColumns,
	previewGenericItems,
	previewImageAlt,
	previewImageFor,
	previewRows,
	sectionFallbackText,
	titleCase,
	toObjectArray,
} from "../src/modules/blueprint-preview/previewModel";

describe("previewModel module", () => {
	it("previewColumns converts array of columns or returns fallbacks", () => {
		// Custom columns
		expect(
			previewColumns({ columns: [{ key: "c1", label: "Col 1" }] }),
		).toEqual([{ key: "c1", label: "Col 1" }]);
		// Missing key/label fallback
		expect(previewColumns({ columns: [{ name: "Col Name" }] })).toEqual([
			{ key: "Col Name", label: "Col Name" },
		]);
		// Missing both key/label fallback
		expect(previewColumns({ columns: [{}] })).toEqual([
			{ key: "0", label: "Column 1" },
		]);
		// Empty/invalid columns returns fallback columns
		const fallback = previewColumns({});
		expect(fallback.length).toBe(3);
		expect(fallback[0].key).toBe("name");
	});

	it("previewRows generates sample rows or uses provided ones", () => {
		const cols = [{ key: "id", label: "ID" }];
		// Normal rows
		expect(previewRows({ rows: [{ id: 1 }, { id: 2 }] }, cols)).toEqual([
			{ id: 1 },
			{ id: 2 },
		]);
		// Generated rows
		const generated = previewRows({}, cols, 2);
		expect(generated).toEqual([{ id: "ID 1" }, { id: "ID 2" }]);
	});

	it("previewImageFor returns correct image URL and alt text", () => {
		// Standard image field
		expect(
			previewImageFor({ imageUrl: "http://img.png" }, "small", "seed"),
		).toBe("http://img.png");
		expect(
			previewImageFor({ image: { url: "http://nested.png" } }, "small", "seed"),
		).toBe("http://nested.png");
		// Fallback image using seed and sizes
		expect(previewImageFor({}, "small", "test-seed")).toContain(
			"picsum.photos/seed/test-seed/240/135",
		);

		// Alt text variations
		expect(previewImageAlt({ alt: "my alt" }, "fallback")).toBe("my alt");
		expect(previewImageAlt({ title: "my title" }, "fallback")).toBe("my title");
		expect(previewImageAlt({}, "fallback")).toBe("fallback");
	});

	it("chartPreviewItems structures values for chart renderers", () => {
		// With explicit chart items
		expect(chartPreviewItems({ data: [{ label: "A", value: 10 }] })).toEqual([
			{ label: "A", value: 10 },
		]);
		// Invalid chart value fallback
		expect(
			chartPreviewItems({ data: [{ label: "A", value: "invalid" }] }),
		).toEqual([{ label: "A", value: 24 }]);
		// No item fallback
		const fallback = chartPreviewItems({
			columns: [{ key: "A", label: "Col A" }],
		});
		expect(fallback[0]).toEqual({ label: "Col A", value: 24 });
	});

	it("compactChartLabel truncates long labels", () => {
		expect(compactChartLabel("Short")).toBe("Short");
		expect(compactChartLabel("VeryLongLabelName")).toBe("VeryLong...");
	});

	it("previewGenericItems provides list of items or falls back appropriately", () => {
		const tMock = ((key: string) => key) as TFunction;
		// With item list
		expect(
			previewGenericItems(
				{ items: [{ title: "T1", description: "D1" }] },
				tMock,
			),
		).toEqual([{ title: "T1", description: "D1" }]);
		// With columns
		expect(
			previewGenericItems(
				{ columns: [{ key: "col1", label: "Col 1" }] },
				tMock,
			),
		).toEqual([{ title: "Col 1", description: "" }]);
		// Total fallback
		expect(
			previewGenericItems({ title: "My Title", description: "My Desc" }, tMock),
		).toEqual([
			{ title: "Name", description: "Sample name" },
			{ title: "Status", description: "Sample status" },
			{ title: "Owner", description: "Sample owner" },
		]);
	});

	it("sectionFallbackText translates correctly", () => {
		const tMock = vi.fn().mockReturnValue("Fallback Text");
		expect(sectionFallbackText("Comp", tMock)).toBe("Fallback Text");
		expect(tMock).toHaveBeenCalledWith(
			"blueprint.preview.sectionFallbackText",
			{
				componentName: "Comp",
			},
		);
	});

	it("titleCase and labelForOption format values for display", () => {
		expect(titleCase("my-custom-value")).toBe("My Custom Value");
		expect(labelForOption("0deg")).toBe("↓");
		expect(labelForOption("campfire")).toBe("Camp Fire");
		expect(labelForOption("normal-value")).toBe("Normal Value");

		expect(labelForOptionA11y("0deg")).toBe("Shadow direction down");
		expect(labelForOptionA11y("other")).toBe("Other");
	});

	it("isObject and toObjectArray validate data shapes", () => {
		expect(isObject(null)).toBe(false);
		expect(isObject([])).toBe(false);
		expect(isObject({})).toBe(true);

		expect(toObjectArray(null)).toEqual([]);
		expect(toObjectArray([{}, "invalid", null])).toEqual([{}]);
	});
});
