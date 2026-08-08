import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock(
	"../src/modules/nightworkers/components/ThreadTimelineMarkdown",
	() => ({
		NightWorkersCodeBlock: ({
			code,
			filename,
		}: {
			code: string;
			filename: string;
		}) => <pre data-filename={filename}>{code}</pre>,
	}),
);

import {
	getInspectionToolCardModel,
	hasInspectionToolCard,
	InspectionToolCard,
	NormalInspectionToolCard,
} from "../src/modules/nightworkers/components/ThreadTimelineInspectionToolCard";

function finished(
	toolName: string,
	argumentsValue: Record<string, unknown>,
	payload: Record<string, unknown>,
	overrides: Record<string, unknown> = {},
) {
	return {
		kind: "tool.result",
		status: "completed",
		seq: 7,
		payloadJson: {
			runEvent: {
				type: "tool.call_finished",
				data: {
					toolName,
					arguments: argumentsValue,
					ok: true,
					result: payload,
					...overrides,
				},
			},
		},
	};
}

describe("inspection tool card branch coverage", () => {
	it("covers find-file defaults, count fallbacks, and result limits", () => {
		const files = Array.from(
			{ length: 10 },
			(_, index) => `src/file-${index}.ts`,
		);
		const card = getInspectionToolCardModel(
			finished(
				"find_file",
				{ fileMask: "*.ts", recursive: false, maxResults: 0 },
				{ files },
			),
		);
		expect(card).toMatchObject({ target: ".", query: "*.ts" });
		expect(card?.metrics).toContainEqual({ label: "matches", value: "10" });
		expect(card?.preview?.split("\n")).toHaveLength(8);

		const counted = getInspectionToolCardModel(
			finished(
				"find_file",
				{ relativePath: "api", fileMask: "*.tsx" },
				{ count: 0, files: [] },
			),
		);
		expect(counted?.metrics).toContainEqual({ label: "matches", value: "0" });
	});

	it("covers list-directory payload metrics and truncation", () => {
		const card = getInspectionToolCardModel(
			finished(
				"list_dir",
				{ skipIgnored: true },
				{ dirs: 3, files: ["one.ts"], truncated: true },
			),
		);
		expect(card).toMatchObject({ target: ".", badges: ["truncated"] });
		expect(card?.metrics).toEqual([{ label: "files", value: "1" }]);
		expect(card?.options).toContainEqual({
			label: "skipIgnored",
			value: "true",
		});
	});

	it("covers search previews with sparse and malformed matches", () => {
		const matches = [
			{ filePath: "a.ts", lineNumber: 0, excerpt: "hit" },
			{ filePath: "b.ts", excerpt: "second" },
			null,
			{},
			{ lineNumber: 12 },
			{ filePath: "six.ts" },
			{ filePath: "not-shown.ts" },
		];
		const card = getInspectionToolCardModel(
			finished(
				"search_files",
				{ query: "hit", caseSensitive: false, maxResults: 10 },
				{ matches, engine: "native" },
			),
		);
		expect(card?.preview).toContain("a.ts:0:hit");
		expect(card?.preview).not.toContain("not-shown");
		expect(card?.metrics).toContainEqual({ label: "matches", value: "7" });
	});

	it("covers structure symbol and path previews", () => {
		let card = getInspectionToolCardModel(
			finished(
				"inspect_structure",
				{
					filePath: "src/a.ts",
					includeImports: true,
					previewPrimitives: false,
					maxPaths: 0,
				},
				{
					kind: "typescript",
					symbols: [{ kind: "function", name: "run" }, { name: "anonymous" }],
					paths: [{ path: "ignored", type: "string" }],
					truncated: true,
				},
			),
		);
		expect(card?.preview).toBe("function run\nanonymous");
		expect(card?.badges).toContain("truncated");

		card = getInspectionToolCardModel(
			finished(
				"inspect_structure",
				{},
				{
					filePath: "data.json",
					symbols: [],
					paths: [{ path: "user.name", type: "string" }, {}],
				},
			),
		);
		expect(card?.target).toBe("data.json");
		expect(card?.preview).toBe("user.name: string");
	});

	it("covers clean and dirty git cards", () => {
		const cleanStatus = getInspectionToolCardModel(
			finished(
				"git_status",
				{},
				{ isDirty: false, modifiedCount: 0, untrackedCount: 0 },
			),
		);
		expect(cleanStatus).toMatchObject({
			target: "repository",
			badges: ["clean"],
		});

		const changedDiff = getInspectionToolCardModel(
			finished(
				"git_diff",
				{},
				{ hasChanges: true, diffStat: "2 files changed" },
			),
		);
		expect(changedDiff).toMatchObject({
			target: "repository",
			badges: ["has changes"],
		});
		const cleanDiff = getInspectionToolCardModel(
			finished("git_diff", {}, { hasChanges: false }),
		);
		expect(cleanDiff?.badges).toEqual(["clean"]);
	});

	it("covers specification found, missing, and unknown states", () => {
		let card = getInspectionToolCardModel(
			finished(
				"read_current_specification",
				{ taskId: "fallback" },
				{
					taskId: "task-1",
					found: true,
					title: "Feature",
					digest: "123456789012345678901234",
				},
			),
		);
		expect(card?.metrics).toContainEqual({ label: "found", value: "yes" });
		expect(card?.metrics).toContainEqual({
			label: "digest",
			value: "1234567890123456789",
		});

		card = getInspectionToolCardModel(
			finished(
				"read_current_specification",
				{ taskId: "fallback" },
				{ found: false },
			),
		);
		expect(card?.target).toBe("fallback");
		expect(card?.metrics).toContainEqual({ label: "found", value: "no" });

		card = getInspectionToolCardModel(
			finished("read_current_specification", { taskId: "fallback" }, {}),
		);
		expect(card?.metrics).toEqual([]);
	});

	it("covers read-file partial ranges and failed status sources", () => {
		let card = getInspectionToolCardModel(
			finished(
				"read_file",
				{ filePath: "a.ts", endLine: 20, compressionMode: "summary" },
				{
					startLine: 2,
					totalLines: 40,
					compression: {},
				},
			),
		);
		expect(card?.options).toContainEqual({ label: "requested", value: "?-20" });
		expect(card?.metrics).toContainEqual({
			label: "lines",
			value: "2-? / total 40",
		});

		card = getInspectionToolCardModel({
			...finished("git_diff", {}, { hasChanges: true }),
			status: "failed",
		});
		expect(card?.status).toBe("failed");
		card = getInspectionToolCardModel({
			...finished("git_diff", {}, { hasChanges: true }),
			eventType: "tool_failed",
		});
		expect(card?.status).toBe("failed");
	});

	it("rejects unknown tools, non-tool lifecycle, and empty started cards", () => {
		expect(
			getInspectionToolCardModel(finished("unknown", {}, { summary: "x" })),
		).toBeNull();
		expect(
			getInspectionToolCardModel({ kind: "message", payloadJson: {} }),
		).toBeNull();
		const emptyStarted = {
			kind: "tool.call",
			status: "started",
			payloadJson: {
				runEvent: {
					type: "tool.call_started",
					data: { toolName: "read_file", arguments: {} },
				},
			},
		};
		expect(hasInspectionToolCard(emptyStarted)).toBe(false);
	});

	it("renders debug and normal cards with status labels and details", () => {
		const readEvent = finished(
			"read_file",
			{ filePath: "src/a.ts" },
			{
				startLine: 1,
				endLine: 3,
				cached: true,
			},
		);
		let html = renderToStaticMarkup(<InspectionToolCard event={readEvent} />);
		expect(html).toContain("Cached");
		expect(html).toContain("#7");
		expect(html).toContain("read_file.txt");

		const compressed = finished(
			"read_file",
			{ filePath: "src/a.ts" },
			{
				startLine: 1,
				endLine: 3,
				compression: { strategy: "summary_v1" },
			},
		);
		html = renderToStaticMarkup(
			<NormalInspectionToolCard event={compressed} />,
		);
		expect(html).toContain("Compressed");

		const completed = finished(
			"find_file",
			{ fileMask: "*.ts" },
			{ files: ["a.ts"] },
		);
		html = renderToStaticMarkup(<NormalInspectionToolCard event={completed} />);
		expect(html).toContain("Completed");
		expect(renderToStaticMarkup(<InspectionToolCard event={{}} />)).toBe("");
		expect(renderToStaticMarkup(<NormalInspectionToolCard event={{}} />)).toBe(
			"",
		);
	});
});
