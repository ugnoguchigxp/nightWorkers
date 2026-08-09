import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	downloadBlob: vi.fn(),
}));

vi.mock("../shared/json-record", () => ({
	toDeepRecord: (value: unknown) =>
		value && typeof value === "object" && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: {},
}));

vi.mock("../src/modules/nightworkers/artifactExport", () => ({
	artifactFileStem: (title: string) => title.toLowerCase().replaceAll(" ", "-"),
	buildMarkdownFromValue: (title: string, value: unknown) =>
		`# ${title}\n\n${JSON.stringify(value)}`,
	downloadBlob: mocks.downloadBlob,
	markdownCodeBlock: (content: string, language: string) =>
		`\`\`\`${language}\n${content}\n\`\`\``,
}));

vi.mock("../src/modules/nightworkers/workbenchSelectorUtils", () => ({
	toMs: (value: unknown) => Date.parse(String(value)) || 0,
}));

import {
	artifactFileName,
	buildArtifactVersions,
	buildExportedArtifactContent,
	copyText,
	saveTextFile,
} from "../src/modules/nightworkers/components/ArtifactPaneVersions";

function artifact(kind: string, overrides: Record<string, unknown> = {}) {
	return {
		id: `selected-${kind}`,
		taskId: "task-1",
		kind,
		title: `${kind} Selected`,
		source: { type: "task_message", messageId: "selected" },
		createdAt: "2026-08-01T00:10:00.000Z",
		...overrides,
	} as never;
}

function message(
	id: string,
	metadataJson: Record<string, unknown>,
	overrides: Record<string, unknown> = {},
) {
	return {
		id,
		taskId: "task-1",
		runId: "run-1",
		messageType: "text",
		content: `${id} content`,
		metadataJson,
		createdAt: "2026-08-01T00:01:00.000Z",
		...overrides,
	} as never;
}

function activityArtifact(
	id: string,
	kind: string,
	metadataJson: Record<string, unknown>,
	overrides: Record<string, unknown> = {},
) {
	return {
		id,
		taskId: "task-1",
		runId: "run-activity",
		kind,
		metadataJson,
		createdAt: "2026-08-01T00:02:00.000Z",
		...overrides,
	} as never;
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe("ArtifactPaneVersions extra coverage", () => {
	it("returns empty and fixed single versions for non-versioned artifact kinds", () => {
		expect(buildArtifactVersions(null, [], [])).toEqual([]);
		for (const kind of [
			"diff",
			"evidence_check",
			"review_status",
			"plan_mode_workspace",
		]) {
			const selected = artifact(kind);
			expect(
				buildArtifactVersions(
					selected,
					[message("ignored", { componentDesign: { componentName: "Card" } })],
					[activityArtifact("ignored", "component_design", {})],
				),
			).toEqual([selected]);
		}
	});

	it("resolves every message artifact kind and filters unrelated versions", () => {
		const messages = [
			message("component", {
				componentDesign: { componentName: "Button Design" },
				display: { summary: "component summary" },
			}),
			message("delta", { designDelta: { changed: true }, title: "Delta" }),
			message("markdown-data", {
				markdownDocumentData: { body: "spec" },
				display: { title: "Display Spec" },
			}),
			message("draft", { intent: "draft_spec" }, { runId: "" }),
			message("app", { appBlueprint: { name: "Application" } }),
			message("mock", { mockBlueprint: { name: "Mock Application" } }),
			message("row", {
				artifactRef: { artifactId: "artifact-row-1" },
				title: "Stored Blueprint",
			}),
			message("markdown", {}, { messageType: "markdown_document" }),
			message("unsupported", {}, { messageType: "chart" }),
		];

		const componentVersions = buildArtifactVersions(
			artifact("component_design"),
			messages,
			[],
		);
		expect(componentVersions[0]).toMatchObject({
			id: "message-component",
			title: "Button Design",
			summary: "component summary",
		});
		expect(
			buildArtifactVersions(artifact("design_delta"), messages, [])[0],
		).toMatchObject({ id: "message-delta", title: "Delta" });
		const specs = buildArtifactVersions(artifact("spec"), messages, []);
		expect(specs.map((version) => version.id)).toEqual([
			"message-markdown-data",
			"message-draft",
			"message-markdown",
			"selected-spec",
		]);
		expect(specs[0].title).toBe("Display Spec");
		expect(specs[1]).toMatchObject({ title: "Artifact", runId: undefined });
		const blueprints = buildArtifactVersions(
			artifact("app_blueprint"),
			messages,
			[],
		);
		expect(blueprints.map((version) => version.title)).toEqual([
			"Application",
			"Mock Application",
			"Stored Blueprint",
			"app_blueprint Selected",
		]);
		expect(blueprints[2].source).toEqual({
			type: "artifact_row",
			artifactId: "artifact-row-1",
		});
		expect(blueprints[0].source).toEqual({
			type: "task_message",
			messageId: "app",
		});
	});

	it("sorts, deduplicates, and applies every activity title and summary fallback", () => {
		const selected = artifact("app_blueprint", {
			id: "artifact-duplicate",
			createdAt: "2026-08-01T00:09:00.000Z",
		});
		const artifacts = [
			activityArtifact("title", "app_blueprint", {
				title: "Metadata Title",
				summary: "Metadata Summary",
			}),
			activityArtifact(
				"app-name",
				"app_blueprint",
				{ appBlueprint: { name: "App Name" } },
				{ contentText: "content summary", createdAt: "invalid" },
			),
			activityArtifact("mock-name", "app_blueprint", {
				mockBlueprint: { name: "Mock Name" },
			}),
			activityArtifact(
				"path",
				"app_blueprint",
				{},
				{ path: "blueprint.json", runId: "" },
			),
			activityArtifact("kind", "app_blueprint", {}),
			activityArtifact("duplicate", "app_blueprint", {
				title: "Overridden by selected",
			}),
			activityArtifact("filtered", "spec", { title: "Wrong Kind" }),
		];
		const versions = buildArtifactVersions(selected, [], artifacts);

		expect(versions).toHaveLength(6);
		expect(versions[0]).toMatchObject({
			title: "App Name",
			summary: "content summary",
		});
		expect(versions.map((version) => version.title)).toEqual(
			expect.arrayContaining([
				"Metadata Title",
				"App Name",
				"Mock Name",
				"blueprint.json",
				"app_blueprint",
				"app_blueprint Selected",
			]),
		);
		expect(
			versions.find((version) => version.title === "blueprint.json"),
		).toMatchObject({ runId: undefined, summary: "" });
	});

	it("exports diff, test result, activity JSON, and activity plain text", () => {
		expect(
			buildExportedArtifactContent({
				showDiff: true,
				latestRun: { diffPatch: "patch" } as never,
				selectedMessage: null,
				selectedActivityArtifact: null,
				selectedFile: null,
				selectedArtifact: artifact("diff", { title: "Custom Diff" }),
			}),
		).toBe("# Custom Diff\n\n```diff\npatch\n```\n");
		expect(
			buildExportedArtifactContent({
				showDiff: true,
				selectedMessage: null,
				selectedActivityArtifact: null,
				selectedFile: null,
				selectedArtifact: null,
			}),
		).toContain("# Code Diff\n\n```diff\n\n```");
		expect(
			buildExportedArtifactContent({
				showDiff: false,
				latestRun: { testResults: { passed: 3 } } as never,
				selectedMessage: null,
				selectedActivityArtifact: null,
				selectedFile: null,
				selectedArtifact: artifact("test_result", { title: "Tests" }),
			}),
		).toContain('{"passed":3}');
		expect(
			buildExportedArtifactContent({
				showDiff: false,
				selectedMessage: null,
				selectedActivityArtifact: activityArtifact(
					"json",
					"report",
					{},
					{ contentText: '{"ok":true}' },
				),
				selectedFile: null,
				selectedArtifact: null,
			}),
		).toBe('# report\n\n{"ok":true}');
		expect(
			buildExportedArtifactContent({
				showDiff: false,
				selectedMessage: null,
				selectedActivityArtifact: activityArtifact(
					"plain",
					"report",
					{},
					{ contentText: "plain text" },
				),
				selectedFile: null,
				selectedArtifact: artifact("report", { title: "Report Title" }),
			}),
		).toBe("plain text");
	});

	it("exports API, Zod, regular messages, files, metadata, and empty fallbacks", () => {
		const input = (overrides: Record<string, unknown>) => ({
			showDiff: false,
			selectedMessage: null,
			selectedActivityArtifact: null,
			selectedFile: null,
			selectedArtifact: null,
			...overrides,
		});
		expect(
			buildExportedArtifactContent(
				input({
					selectedMessage: message(
						"api-meta",
						{ apiContract: { paths: 2 } },
						{ messageType: "api_contract", content: '{"ignored":true}' },
					),
					selectedArtifact: artifact("api_contract", { title: "Orders API" }),
				}) as never,
			),
		).toBe('# Orders API\n\n{"paths":2}');
		expect(
			buildExportedArtifactContent(
				input({
					selectedMessage: message(
						"api-json",
						{},
						{
							messageType: "api_contract",
							content: '{"fallback":true}',
						},
					),
				}) as never,
			),
		).toBe('# API Contract\n\n{"fallback":true}');
		expect(
			buildExportedArtifactContent(
				input({
					selectedMessage: message(
						"zod",
						{},
						{
							messageType: "zod_schema",
							content: "export const Schema = {};",
						},
					),
				}) as never,
			),
		).toContain("# Zod Schema\n\n```typescript");
		expect(
			buildExportedArtifactContent(
				input({ selectedMessage: message("plain", {}) }) as never,
			),
		).toBe("plain content");
		expect(
			buildExportedArtifactContent(
				input({ selectedFile: { content: "file contents" } }) as never,
			),
		).toBe("file contents");
		expect(
			buildExportedArtifactContent(
				input({
					selectedArtifact: artifact("report", {
						title: "Metadata",
						metadata: { score: 90 },
					}),
				}) as never,
			),
		).toBe('# Metadata\n\n{"score":90}');
		expect(
			buildExportedArtifactContent(
				input({
					selectedArtifact: artifact("report", { metadata: undefined }),
				}) as never,
			),
		).toContain("{}");
		expect(buildExportedArtifactContent(input({}) as never)).toBe("");
	});

	it("copies with modern and legacy clipboard paths and always removes the textarea", async () => {
		const writeText = vi.fn(async () => undefined);
		vi.stubGlobal("navigator", { clipboard: { writeText } });
		await copyText("modern");
		expect(writeText).toHaveBeenCalledWith("modern");

		const textarea = {
			value: "",
			style: { position: "", left: "" },
			setAttribute: vi.fn(),
			select: vi.fn(),
			remove: vi.fn(),
		};
		const appendChild = vi.fn();
		const execCommand = vi.fn(() => true);
		vi.stubGlobal("navigator", { clipboard: {} });
		vi.stubGlobal("document", {
			createElement: vi.fn(() => textarea),
			body: { appendChild },
			execCommand,
		});
		await copyText("legacy");
		expect(textarea).toMatchObject({
			value: "legacy",
			style: { position: "fixed", left: "-9999px" },
		});
		expect(textarea.setAttribute).toHaveBeenCalledWith("readonly", "true");
		expect(textarea.select).toHaveBeenCalled();
		expect(appendChild).toHaveBeenCalledWith(textarea);
		expect(execCommand).toHaveBeenCalledWith("copy");
		expect(textarea.remove).toHaveBeenCalled();

		execCommand.mockReturnValue(false);
		await expect(copyText("failure")).rejects.toThrow("clipboard_copy_failed");
		expect(textarea.remove).toHaveBeenCalledTimes(2);
	});

	it("saves default and custom MIME files and produces artifact filenames", () => {
		saveTextFile("plain", "plain.txt");
		saveTextFile("markdown", "artifact.md", "text/markdown");
		expect(mocks.downloadBlob).toHaveBeenCalledTimes(2);
		const [plainBlob, plainName] = mocks.downloadBlob.mock.calls[0];
		const [markdownBlob, markdownName] = mocks.downloadBlob.mock.calls[1];
		expect(plainName).toBe("plain.txt");
		expect(plainBlob).toBeInstanceOf(Blob);
		expect(plainBlob.type).toBe("text/plain;charset=utf-8");
		expect(markdownName).toBe("artifact.md");
		expect(markdownBlob.type).toBe("text/markdown");
		expect(artifactFileName(artifact("spec", { title: "Feature Plan" }))).toBe(
			"feature-plan.md",
		);
	});
});
