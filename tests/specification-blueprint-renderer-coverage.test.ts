import { describe, expect, it } from "vitest";
import {
	buildImplementationPlanGuidance,
	labelArray,
	renderCompressedBlueprintNaturalLanguage,
	sampleItemLabel,
	summarizeInteractionHints,
	summarizeSampleValue,
	summarizeSectionProps,
	summarizeStateHints,
} from "../api/modules/specification/specification-blueprint-renderer";

describe("specification blueprint renderer coverage", () => {
	it("classifies lightweight, standard, risky, and schema-changing plans", () => {
		expect(buildImplementationPlanGuidance("small documentation")).toContain(
			"軽量タスク",
		);
		expect(
			buildImplementationPlanGuidance("React UI and API endpoint"),
		).toContain("標準タスク");
		expect(
			buildImplementationPlanGuidance("React API database security worker"),
		).toContain("高リスクタスク");
		const schema = buildImplementationPlanGuidance(
			"React screen Hono API create table migration test",
		);
		expect(schema).toContain("DB 変更部分は高リスク相当");
		expect(schema).toContain("DB 変更:");
		expect(schema).toContain("API:");
		expect(schema).toContain("UI:");
	});

	it("renders rich and sparse blueprints", () => {
		expect(renderCompressedBlueprintNaturalLanguage(null)).toContain("未生成");
		const text = renderCompressedBlueprintNaturalLanguage({
			id: "blueprint-1",
			description: "A detailed operations console",
			screens: [
				{
					id: "home",
					path: "/home",
					sections: [
						{
							id: "table",
							componentName: "DataTable",
							visualIntent: "Inspect records",
							props: {
								title: "Records",
								dataset: "orders",
								sample: [{ label: "Order one" }],
								columns: [{ title: "ID" }, { name: "Status" }, null],
								items: [{ label: "First" }, { title: "Second" }, 1],
								tabs: [{ label: "Open" }, "Closed"],
								filters: [{ name: "Owner" }, "All"],
								actions: [{ label: "Edit" }],
								rowActions: "Delete",
								primaryAction: { title: "Create" },
								emptyState: { title: "Nothing" },
								loadingState: "Loading",
								errorState: 500,
								validation: true,
							},
						},
						{ name: "Sparse", props: [] },
					],
				},
			],
			implementationTasks: [
				{ id: "task-1", description: "Build it" },
				{ title: "Verify" },
			],
		});
		expect(text).toContain("Records");
		expect(text).toContain("列は ID / Status");
		expect(text).toContain("操作は Edit / Delete / Create");
		expect(text).toContain("実装時に意識する作業");
	});

	it("normalizes labels and sample values across primitive and record forms", () => {
		expect(labelArray(null)).toEqual([]);
		expect(labelArray("Open")).toEqual(["Open"]);
		expect(
			labelArray([
				{ label: "A" },
				{ title: "B" },
				{ name: "C" },
				{ id: "D" },
				null,
				4,
			]),
		).toEqual(["A", "B", "C", "D", "4"]);
		expect(labelArray({ name: "Named" })).toEqual(["Named"]);
		expect(labelArray({})).toEqual([]);
		expect(labelArray(42)).toEqual([]);

		expect(summarizeSampleValue(null)).toBe("");
		expect(summarizeSampleValue("sample")).toBe("sample");
		expect(summarizeSampleValue(["a", 2, true, null])).toBe("a / 2 / true");
		expect(summarizeSampleValue({ a: "x", b: null, c: { value: "v" } })).toBe(
			"a:x / c:v",
		);
		expect(summarizeSampleValue(12)).toBe("12");

		expect(sampleItemLabel(undefined)).toBe("");
		expect(sampleItemLabel(false)).toBe("false");
		expect(sampleItemLabel({ title: "T" })).toBe("T");
		expect(sampleItemLabel([])).toBe("");
	});

	it("summarizes absent and alternate interaction and state sources", () => {
		expect(summarizeSectionProps({})).toBe("");
		expect(
			summarizeSectionProps({
				reason: "Why",
				dataset: "events",
				sample: "one",
				actions: "Refresh",
				emptyState: "Empty",
				props: { heading: "Heading" },
			}),
		).toContain("Heading");
		expect(
			summarizeInteractionHints(
				{ actions: ["Section"] },
				{ secondaryAction: "Cancel", submitLabel: "Save", cancelLabel: "Back" },
			),
		).toEqual(["Cancel", "Save", "Back", "Section"]);
		expect(
			summarizeStateHints({ loadingState: { label: "Busy" } }, {}),
		).toEqual(["loading:label:Busy"]);
	});
});
