import crypto from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import * as repo from "../api/modules/nightworkers/nightworkers.repository";
import {
	renderMockBlueprintMarkdown,
	summarizeMockBlueprintForDataModel,
} from "../api/services/blueprints/mock-draft";
import { generatePlanModeMockBlueprintDraft } from "../api/services/blueprints/mock-llm-draft";
import {
	buildMockBlueprintSectionCatalog,
	buildMockBlueprintStructuredOutputJsonSchema,
	buildMockBlueprintSystemPrompt,
	buildMockBlueprintUserPrompt,
	mockBlueprintPromptDiagnostics,
} from "../api/services/structured-generation/prompts/mock-blueprint";
import {
	getMockBlueprintDatasetKindsForSection,
	type MockBlueprint,
	type MockBlueprintDataset,
	mockBlueprintSchema,
	renderableMockBlueprintSectionNames,
} from "../shared/schemas/mock-blueprint.schema";
import { BlueprintArtifactViewer } from "../src/modules/blueprint-preview/ArtifactBlueprintViewers";
import { getBlueprintMetaDebugData } from "../src/modules/blueprint-preview/BlueprintPreview";
import {
	mockBlueprintToPreviewBlueprint,
	mockBlueprintToPreviewBlueprintSafely,
} from "../src/modules/blueprint-preview/mockBlueprintAdapter";
import { canUseBlueprintSideColumn } from "../src/modules/blueprint-preview/sidebarPlacement";
import { representativeMockBlueprint } from "./fixtures/mock-blueprint";

beforeAll(async () => {
	await ensureNightWorkersSchema();
});

describe("Mock Blueprint", () => {
	it("validates renderable section selections and compatible mock datasets", () => {
		const parsed = mockBlueprintSchema.parse(representativeMockBlueprint);

		expect(parsed.artifactKind).toBe("mock_blueprint");
		expect(
			parsed.meta.selectedSections.map((section) => section.sectionType),
		).toEqual(
			parsed.screens.flatMap((screen) =>
				screen.sections.map((section) => section.componentName),
			),
		);
		for (const screen of parsed.screens) {
			for (const section of screen.sections) {
				expect(renderableMockBlueprintSectionNames).toContain(
					section.componentName,
				);
				expect(
					getMockBlueprintDatasetKindsForSection(section.componentName),
				).toContain(section.dataset.kind);
			}
		}
	});

	it("rejects incompatible section and dataset combinations", () => {
		expect(() =>
			mockBlueprintSchema.parse({
				...representativeMockBlueprint,
				screens: [
					{
						...representativeMockBlueprint.screens[0],
						sections: [
							{
								...representativeMockBlueprint.screens[0].sections[0],
								componentName: "DataTableSection",
								dataset: {
									kind: "navigation",
									items: [{ label: "Queue" }, { label: "Reviews" }],
								},
							},
						],
					},
				],
			}),
		).toThrow(/does not support navigation/);
	});

	it("requires root meta and minimum mock datasets for reviewable previews", () => {
		expect(() =>
			mockBlueprintSchema.parse(mockBlueprintFixtureWithoutMeta()),
		).toThrow(/meta/);

		expect(() =>
			mockBlueprintSchema.parse({
				...representativeMockBlueprint,
				screens: [
					{
						...representativeMockBlueprint.screens[0],
						sections: [
							{
								...representativeMockBlueprint.screens[0].sections[2],
								dataset: {
									kind: "table",
									columns: [{ key: "title", label: "Title" }],
									rows: [],
								},
							},
						],
					},
				],
			}),
		).toThrow(/Too small/);
	});

	it("accepts natural mock data keys and scalar row values", () => {
		const parsed = mockBlueprintSchema.parse({
			...representativeMockBlueprint,
			screens: [
				{
					...representativeMockBlueprint.screens[0],
					sections: [
						{
							...representativeMockBlueprint.screens[0].sections[2],
							dataset: {
								kind: "table",
								columns: [
									{ key: "due_date", label: "Due Date" },
									{ key: "riskScore", label: "Risk Score" },
									{ key: "blocked", label: "Blocked" },
								],
								rows: [
									{ due_date: "2026-07-02", riskScore: 7, blocked: false },
									{ due_date: "2026-07-03", riskScore: 5, blocked: false },
									{ due_date: "2026-07-04", riskScore: 8, blocked: true },
									{ due_date: "2026-07-05", riskScore: 3, blocked: false },
									{ due_date: "2026-07-06", riskScore: 6, blocked: false },
								],
							},
						},
					],
				},
			],
		});

		const dataset = parsed.screens[0].sections[0].dataset;
		expect(dataset.kind).toBe("table");
		if (dataset.kind !== "table") throw new Error("Expected table dataset.");
		expect(dataset.rows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ riskScore: 7, blocked: false }),
			]),
		);
		expect(dataset.rows.length).toBeGreaterThanOrEqual(5);
	});

	it("adapts mock datasets into the existing Blueprint preview model", () => {
		const preview = mockBlueprintToPreviewBlueprint(
			representativeMockBlueprint,
		);
		const screen = preview.screens[0];
		const sections = Array.isArray(screen.sections) ? screen.sections : [];

		expect(preview).toMatchObject({
			id: representativeMockBlueprint.id,
			name: representativeMockBlueprint.name,
			version: 1,
			meta: representativeMockBlueprint.meta,
		});
		expect(sections).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					componentName: "DataTableSection",
					props: expect.objectContaining({
						columns: expect.any(Array),
						rows: expect.any(Array),
					}),
				}),
			]),
		);
	});

	it("drops empty sidebar layouts when mock sections do not need side columns", () => {
		const preview = mockBlueprintToPreviewBlueprint({
			...representativeMockBlueprint,
			screens: [
				{
					...representativeMockBlueprint.screens[0],
					layout: { template: "sidebar_right" },
					sections: representativeMockBlueprint.screens[0].sections
						.filter((section) => section.region !== "sidebar")
						.map((section) => ({ ...section, region: "main" })),
				},
			],
		});

		expect(preview.screens[0].layout).toEqual({ template: "single_column" });
	});

	it("keeps non-sidebar content out of side columns even when region asks for it", () => {
		const preview = mockBlueprintToPreviewBlueprint({
			...representativeMockBlueprint,
			screens: [
				{
					...representativeMockBlueprint.screens[0],
					layout: { template: "two_column" },
					sections: representativeMockBlueprint.screens[0].sections
						.filter((section) => section.region !== "sidebar")
						.map((section) => ({ ...section, region: "aside" })),
				},
			],
		});

		expect(preview.screens[0].layout).toEqual({ template: "single_column" });
		expect(preview.screens[0].sections).toEqual(
			expect.arrayContaining([expect.objectContaining({ region: "main" })]),
		);
		expect(preview.screens[0].sections).not.toEqual(
			expect.arrayContaining([expect.objectContaining({ region: "aside" })]),
		);
	});

	it("allows side columns only for sidebar-named sections or sidebar components", () => {
		expect(
			canUseBlueprintSideColumn({ componentName: "SidebarMenuSection" }),
		).toBe(true);
		expect(canUseBlueprintSideColumn({ name: "サイドメニュー" })).toBe(true);
		expect(canUseBlueprintSideColumn({ id: "project-sidebar" })).toBe(true);
		expect(
			canUseBlueprintSideColumn({
				componentName: "DataTableSection",
				name: "Tasks",
			}),
		).toBe(false);
	});

	it("returns null instead of throwing for invalid preview input", () => {
		expect(
			mockBlueprintToPreviewBlueprintSafely({
				artifactKind: "mock_blueprint",
				id: "broken",
				name: "Broken",
				version: 1,
			}),
		).toBeNull();
	});

	it("renders markdown without AppBlueprint implementation-heavy sections", () => {
		const markdown = renderMockBlueprintMarkdown(representativeMockBlueprint);

		expect(markdown).toContain("# Operations Mock Console");
		expect(markdown).toContain("DataTableSection");
		expect(markdown).toContain("Dataset: `table`");
		expect(markdown).not.toContain("## Data Model");
		expect(markdown).not.toContain("## Implementation Tasks");
	});

	it("covers all dataset kind formatting variants in compactDatasetSample", () => {
		const kinds: Array<[MockBlueprintDataset["kind"], MockBlueprintDataset]> = [
			["navigation", { kind: "navigation", items: [{ label: "Nav1" }] }],
			[
				"table",
				{ kind: "table", columns: [{ key: "col1" }], rows: [{ col1: "Val1" }] },
			],
			["form", { kind: "form", fields: [{ label: "F1", type: "text" }] }],
			["cards", { kind: "cards", cards: [{ title: "Card1" }] }],
			["kanban", { kind: "kanban", columns: [{ title: "Col1", cards: [] }] }],
			["timeline", { kind: "timeline", items: [{ title: "Time1" }] }],
			["article", { kind: "article", title: "Art1" }],
			[
				"metrics",
				{ kind: "metrics", metrics: [{ label: "Met1", value: "10" }] },
			],
			["media", { kind: "media", items: [{ title: "Med1" }] }],
			["map", { kind: "map", points: [{ label: "Map1" }] }],
			["code", { kind: "code", files: [{ path: "File1" }] }],
			["chat", { kind: "chat", messages: [{ author: "User", body: "Hello" }] }],
			["generic", { kind: "generic", items: [{ title: "Gen1" }] }],
		];

		for (const [kind, dataset] of kinds) {
			const baseScreen = representativeMockBlueprint.screens[0];
			const baseSection = baseScreen.sections[0];
			const mockBlueprint: MockBlueprint = {
				...representativeMockBlueprint,
				name: `Test Blueprint ${kind}`,
				screens: [
					{
						...baseScreen,
						sections: [
							{
								...baseSection,
								dataset,
							},
						],
					},
				],
				generationNotes: ["Note1"],
			};

			const markdown = renderMockBlueprintMarkdown(mockBlueprint);
			expect(markdown).toContain(`Dataset: \`${kind}\``);

			const summary = summarizeMockBlueprintForDataModel(mockBlueprint);
			expect(summary).toContain(`dataset=${kind}`);
		}
	});

	it("keeps the prompt schema compact while exposing the section allowlist", () => {
		const schema = buildMockBlueprintStructuredOutputJsonSchema();
		const prompt = buildMockBlueprintSystemPrompt({
			jsonSchema: schema,
			sectionCatalog: buildMockBlueprintSectionCatalog(),
		});
		const diagnostics = mockBlueprintPromptDiagnostics({
			systemPrompt: prompt,
			userPrompt: buildMockBlueprintUserPrompt({
				task: { id: "task-1", title: "BBS 作成" },
			}),
			schema,
		});

		expect(prompt).toContain("DataTableSection");
		expect(prompt).toContain("datasetKinds");
		expect(schema.required).toContain("meta");
		expect(
			schema.properties.meta.properties.selectedSections.items.required,
		).toEqual(expect.arrayContaining(["sectionType", "selectionReason"]));
		expect(diagnostics).toMatchObject({
			systemPromptBytes: expect.any(Number),
			userPromptBytes: expect.any(Number),
			systemPromptEstimatedTokens: expect.any(Number),
			userPromptEstimatedTokens: expect.any(Number),
			totalPromptEstimatedTokens: expect.any(Number),
			sectionAllowlistCount: renderableMockBlueprintSectionNames.length,
			schemaDigest: expect.any(String),
		});
		expect(Buffer.byteLength(JSON.stringify(schema), "utf8")).toBeLessThan(
			32_000,
		);
	});

	it("leaves screen selection to the model without domain-specific steering", () => {
		const prompt = buildMockBlueprintSystemPrompt({
			jsonSchema: buildMockBlueprintStructuredOutputJsonSchema(),
			sectionCatalog: buildMockBlueprintSectionCatalog(),
		});

		expect(prompt).not.toContain("BBS");
		expect(prompt).not.toContain("掲示板トップ");
		expect(prompt).not.toContain("掲示板 / forum / thread");
		expect(prompt).not.toContain("thread / 投稿 / 掲示板系 workflow");
		expect(prompt).not.toContain("Todo");
		expect(prompt).not.toContain("CRM");
		expect(prompt).toContain("主要な利用者、目的、操作、状態");
		expect(prompt).toContain("必要な画面とSectionを自由に選んでください");
	});

	it("frames spec context as constraints instead of implementation planning screens", () => {
		const prompt = buildMockBlueprintSystemPrompt({
			jsonSchema: buildMockBlueprintStructuredOutputJsonSchema(),
			sectionCatalog: buildMockBlueprintSectionCatalog(),
		});
		const userPrompt = buildMockBlueprintUserPrompt({
			task: {
				id: "bbs-task",
				title: "BBS 作成",
				description: "Hono + React/Vite と SQLite で BBS を作る",
			},
			projectStackContext:
				"- 既存 Project stack: TypeScript + React + Vite + Hono",
			specContext: "# Spec\n\n## Goal\nBBS を実装する。",
			prompt: "BBS の mock を作る",
		});

		expect(prompt).toContain("対象プロダクトの画面");
		expect(prompt).toContain("NightWorkersの仕様確認・進行管理画面を作らない");
		expect(prompt).toContain("技術情報は画面内容ではなく制約");
		expect(prompt).toContain("QuestionnaireとSpecの確定事項");
		expect(prompt).not.toContain("180 文字以上");
		expect(userPrompt).toContain("仕様書 / Spec（制約として参照）");
		expect(userPrompt).toContain("画面に出す題材ではなく");
		expect(userPrompt).toContain("## Project Stack Context");
		expect(userPrompt).toContain("TypeScript + React + Vite + Hono");
		expect(userPrompt).toContain("確認ノートの画面は生成しない");
	});

	it("lists every strict object property in required for structured output compatibility", () => {
		const schema = buildMockBlueprintStructuredOutputJsonSchema();

		expectStrictRequiredProperties(schema);
	});

	it("shows see meta in the preview toolbar and keeps meta details closed by default", () => {
		const markup = renderToStaticMarkup(
			createElement(BlueprintArtifactViewer, {
				sessionId: null,
				messageId: null,
				blueprint: {
					id: "meta-test",
					name: "Meta Test",
					meta: {
						intent: "Internal debug intent only",
						selectedSections: [
							{
								sectionType: "DataTableSection",
								selectionReason: "Debug reason only",
								extra: "must be dropped",
							},
						],
						generationNotes: ["must be dropped"],
					},
					screens: [{ id: "screen-1", name: "Screen", sections: [] }],
				},
				validation: null,
			}),
		);

		expect(markup).toMatch(/see meta|blueprint\.preview\.seeMeta/);
		expect(markup).not.toContain("Blueprint:");
		expect(markup).not.toContain("Not adopted");
		expect(markup).not.toContain("Internal debug intent only");
		expect(markup).not.toContain("Debug reason only");
		expect(markup).not.toContain("must be dropped");
		expect(markup).not.toContain("LLM Usage");
	});

	it("filters meta debug data to the currently displayed screen order", () => {
		const meta = getBlueprintMetaDebugData(
			{
				intent:
					"Thread based BBS with list, detail, create, edit, and delete workflows.",
				selectedSections: [
					{
						sectionType: "CardGridSection",
						selectionReason:
							"Should not be shown when this screen does not render it.",
					},
					{
						sectionType: "DataTableSection",
						selectionReason: "Show thread rows with edit and delete actions.",
					},
					{
						sectionType: "TabNavigationSection",
						selectionReason:
							"Should not be shown when this screen does not render it.",
					},
					{
						sectionType: "FormSection",
						selectionReason: "Create or edit a thread post.",
					},
				],
			},
			[
				{
					componentName: "TopMenuSection",
					intent: "Provide the primary global actions.",
				},
				{
					componentName: "DataTableSection",
					intent: "Fallback table intent.",
				},
				{
					componentName: "FormSection",
					intent: "Fallback form intent.",
				},
			],
		);

		expect(meta?.selectedSections).toEqual([
			{
				sectionType: "TopMenuSection",
				selectionReason: "Provide the primary global actions.",
			},
			{
				sectionType: "DataTableSection",
				selectionReason: "Show thread rows with edit and delete actions.",
			},
			{
				sectionType: "FormSection",
				selectionReason: "Create or edit a thread post.",
			},
		]);
	});

	it("renders LLM usage as secondary artifact viewer information when present", () => {
		const markup = renderToStaticMarkup(
			createElement(BlueprintArtifactViewer, {
				sessionId: null,
				messageId: null,
				blueprint: {
					id: "usage-test",
					name: "Usage Test",
					screens: [{ id: "screen-1", name: "Screen", sections: [] }],
				},
				validation: null,
				generation: {
					llmUsage: {
						label: "mock_blueprint",
						inputTokens: 12,
						outputTokens: 8,
						totalTokens: 20,
						provider: "fixture",
						model: "fixture-model",
					},
				},
			}),
		);

		expect(markup).toContain("artifact.llmUsage");
		expect(markup).toContain("20");
		expect(markup).toContain("fixture");
	});

	it("uses the fixture LLM provider to build and validate mock JSON", async () => {
		const originalProvider = process.env.ACTIVE_LLM_PROVIDER;
		const originalFixture = process.env.SUPERVISOR_FIXTURE_OUTPUT;
		const originalSettingsPath = process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
		process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = `/tmp/nightworkers-test-llm-settings-${crypto.randomUUID()}.json`;
		process.env.ACTIVE_LLM_PROVIDER = "fixture";
		process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify(
			representativeMockBlueprint,
		);

		try {
			const repository = await repo.createRepository({
				name: `TEST: Mock Blueprint ${crypto.randomUUID()}`,
				localPath: "/Users/y.noguchi/Code/nightWorkers",
				branch: "main",
			});
			const task = await repo.createTask({
				repositoryId: repository.id,
				title: "TEST: Mock Blueprint fixture task",
				description: "Validate mock blueprint fixture generation.",
				status: "draft",
			});
			const result = await generatePlanModeMockBlueprintDraft({
				taskId: task.id,
				title: "Operations Mock",
				prompt: "運用レビュー用の軽量 mock を作る",
			});

			expect(result.mockBlueprint).toMatchObject({
				artifactKind: "mock_blueprint",
				name: representativeMockBlueprint.name,
			});
			expect(result.generation.promptDiagnostics.schemaName).toBe(
				"mock_blueprint",
			);
			expect(
				result.generation.promptDiagnostics.sectionAllowlistCount,
			).toBeGreaterThan(10);
		} finally {
			if (originalProvider === undefined)
				delete process.env.ACTIVE_LLM_PROVIDER;
			else process.env.ACTIVE_LLM_PROVIDER = originalProvider;
			if (originalFixture === undefined)
				delete process.env.SUPERVISOR_FIXTURE_OUTPUT;
			else process.env.SUPERVISOR_FIXTURE_OUTPUT = originalFixture;
			if (originalSettingsPath === undefined)
				delete process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
			else process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = originalSettingsPath;
		}
	});

	it("preserves schema-valid model-selected ids", async () => {
		const originalProvider = process.env.ACTIVE_LLM_PROVIDER;
		const originalFixture = process.env.SUPERVISOR_FIXTURE_OUTPUT;
		const originalSettingsPath = process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
		process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = `/tmp/nightworkers-test-llm-settings-${crypto.randomUUID()}.json`;
		process.env.ACTIVE_LLM_PROVIDER = "fixture";

		try {
			const repository = await repo.createRepository({
				name: `TEST: Mock Blueprint UUID IDs ${crypto.randomUUID()}`,
				localPath: "/Users/y.noguchi/Code/nightWorkers",
				branch: "main",
			});
			const task = await repo.createTask({
				repositoryId: repository.id,
				title: "TEST: Mock Blueprint UUID id task",
				description: "Validate mock blueprint id normalization.",
				status: "draft",
			});
			process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({
				...representativeMockBlueprint,
				id: "model_selected_blueprint",
				screens: [
					{
						...representativeMockBlueprint.screens[0],
						id: "model_selected_screen",
						sections: [
							{
								...representativeMockBlueprint.screens[0].sections[0],
								id: "model_selected_section",
							},
						],
					},
				],
			});

			const result = await generatePlanModeMockBlueprintDraft({
				taskId: task.id,
				title: "Operations Mock",
				prompt: "BBS の軽量 mock を作る",
			});

			expect(result.mockBlueprint.id).toBe("model_selected_blueprint");
			const idPattern = /^[A-Za-z][A-Za-z0-9_-]*$/;
			expect(result.mockBlueprint.id).toMatch(idPattern);
			expect(result.mockBlueprint.screens[0].id).toBe("model_selected_screen");
			expect(result.mockBlueprint.screens[0].sections[0].id).toBe(
				"model_selected_section",
			);
		} finally {
			if (originalProvider === undefined)
				delete process.env.ACTIVE_LLM_PROVIDER;
			else process.env.ACTIVE_LLM_PROVIDER = originalProvider;
			if (originalFixture === undefined)
				delete process.env.SUPERVISOR_FIXTURE_OUTPUT;
			else process.env.SUPERVISOR_FIXTURE_OUTPUT = originalFixture;
			if (originalSettingsPath === undefined)
				delete process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
			else process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = originalSettingsPath;
		}
	});

	it("does not normalize dataset aliases or fabricate missing meta", async () => {
		const originalProvider = process.env.ACTIVE_LLM_PROVIDER;
		const originalFixture = process.env.SUPERVISOR_FIXTURE_OUTPUT;
		const originalSettingsPath = process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
		process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = `/tmp/nightworkers-test-llm-settings-${crypto.randomUUID()}.json`;
		process.env.ACTIVE_LLM_PROVIDER = "fixture";
		process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({
			...mockBlueprintFixtureWithoutMeta(),
			screens: [
				{
					...representativeMockBlueprint.screens[0],
					sections: [
						{
							...representativeMockBlueprint.screens[0].sections[1],
							componentName: "ControlPanelSection",
							dataset: {
								kind: "cards",
								items: [
									{
										title: "検索",
										summary: "キーワードで探す",
										meta: "全文検索",
									},
									{
										title: "状態",
										summary: "公開中・削除済みを確認",
										meta: "status",
									},
								],
							},
						},
						{
							...representativeMockBlueprint.screens[0].sections[2],
							componentName: "FormSection",
							dataset: {
								kind: "form",
								fields: [
									{
										name: "body",
										label: "本文",
										type: "textarea",
										required: true,
										placeholder: "返信内容を入力",
									},
								],
								submitLabel: "返信を投稿",
							},
						},
						{
							id: "activity",
							name: "返信履歴",
							componentName: "TimelineSection",
							region: "main",
							selectionReason: "時系列の返信を確認するため。",
							copy: {
								title: "返信履歴",
								description: "返信を時系列で確認します。",
							},
							dataset: {
								kind: "timeline",
								items: [
									{
										title: "返信 #1",
										timestamp: "2026-07-02 09:30",
										status: "active",
										summary: "最初の返信です。",
									},
								],
							},
						},
						{
							id: "article",
							name: "スレッド本文",
							componentName: "BlogPostSection",
							region: "main",
							selectionReason: "本文を読むため。",
							copy: {
								title: "お知らせ",
								description: "本文を表示します。",
							},
							dataset: {
								kind: "article",
								title: "お知らせ",
								author: "admin",
								publishedAt: "2026-07-02 09:10",
								body: "このBBSは最小構成で運用します。",
							},
						},
					],
				},
			],
		});

		try {
			const repository = await repo.createRepository({
				name: `TEST: Mock Blueprint Alias ${crypto.randomUUID()}`,
				localPath: "/Users/y.noguchi/Code/nightWorkers",
				branch: "main",
			});
			const task = await repo.createTask({
				repositoryId: repository.id,
				title: "TEST: Mock Blueprint alias task",
				description: "Validate mock blueprint alias normalization.",
				status: "draft",
			});
			const rawOutput = process.env.SUPERVISOR_FIXTURE_OUTPUT;
			await expect(
				generatePlanModeMockBlueprintDraft({
					taskId: task.id,
					title: "Operations Mock",
					prompt: "BBS の軽量 mock を作る",
				}),
			).rejects.toMatchObject({ rawOutput });
		} finally {
			if (originalProvider === undefined)
				delete process.env.ACTIVE_LLM_PROVIDER;
			else process.env.ACTIVE_LLM_PROVIDER = originalProvider;
			if (originalFixture === undefined)
				delete process.env.SUPERVISOR_FIXTURE_OUTPUT;
			else process.env.SUPERVISOR_FIXTURE_OUTPUT = originalFixture;
			if (originalSettingsPath === undefined)
				delete process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
			else process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = originalSettingsPath;
		}
	});

	it("does not delete invalid empty placeholders", async () => {
		const originalProvider = process.env.ACTIVE_LLM_PROVIDER;
		const originalFixture = process.env.SUPERVISOR_FIXTURE_OUTPUT;
		const originalSettingsPath = process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
		process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = `/tmp/nightworkers-test-llm-settings-${crypto.randomUUID()}.json`;
		process.env.ACTIVE_LLM_PROVIDER = "fixture";
		process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({
			...representativeMockBlueprint,
			meta: {
				intent: "Todo form placeholder normalization.",
				selectedSections: [
					{
						sectionType: "FormSection",
						selectionReason: "Todo の追加と編集を確認するため。",
					},
				],
			},
			screens: [
				{
					...representativeMockBlueprint.screens[0],
					sections: [
						{
							...representativeMockBlueprint.screens[0].sections[2],
							componentName: "FormSection",
							dataset: {
								kind: "form",
								fields: [
									{
										name: "title",
										label: "タスク名",
										type: "text",
										placeholder: "例: 請求書を送る",
									},
									{
										name: "dueDate",
										label: "期限",
										type: "date",
										placeholder: "",
									},
									{
										name: "completed",
										label: "完了",
										type: "checkbox",
										placeholder: "   ",
									},
								],
								submitLabel: "保存する",
							},
						},
					],
				},
			],
		});

		try {
			const repository = await repo.createRepository({
				name: `TEST: Mock Blueprint Empty Placeholder ${crypto.randomUUID()}`,
				localPath: "/Users/y.noguchi/Code/nightWorkers",
				branch: "main",
			});
			const task = await repo.createTask({
				repositoryId: repository.id,
				title: "TEST: Mock Blueprint empty placeholder task",
				description: "Validate empty placeholder normalization.",
				status: "draft",
			});
			const rawOutput = process.env.SUPERVISOR_FIXTURE_OUTPUT;
			await expect(
				generatePlanModeMockBlueprintDraft({
					taskId: task.id,
					title: "Todo Mock",
					prompt: "todo form with optional date and completed fields",
				}),
			).rejects.toMatchObject({ rawOutput });
		} finally {
			if (originalProvider === undefined)
				delete process.env.ACTIVE_LLM_PROVIDER;
			else process.env.ACTIVE_LLM_PROVIDER = originalProvider;
			if (originalFixture === undefined)
				delete process.env.SUPERVISOR_FIXTURE_OUTPUT;
			else process.env.SUPERVISOR_FIXTURE_OUTPUT = originalFixture;
			if (originalSettingsPath === undefined)
				delete process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
			else process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = originalSettingsPath;
		}
	});

	it("does not fabricate copy or table rows", async () => {
		const originalProvider = process.env.ACTIVE_LLM_PROVIDER;
		const originalFixture = process.env.SUPERVISOR_FIXTURE_OUTPUT;
		const originalSettingsPath = process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
		process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = `/tmp/nightworkers-test-llm-settings-${crypto.randomUUID()}.json`;
		process.env.ACTIVE_LLM_PROVIDER = "fixture";
		process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({
			...mockBlueprintFixtureWithoutMeta(),
			screens: [
				{
					...representativeMockBlueprint.screens[0],
					sections: [
						{
							...representativeMockBlueprint.screens[0].sections[2],
							copy: undefined,
							dataset: {
								kind: "table",
								columns: [],
								rows: [],
							},
						},
					],
				},
			],
		});

		try {
			const repository = await repo.createRepository({
				name: `TEST: Mock Blueprint Empty Dataset ${crypto.randomUUID()}`,
				localPath: "/Users/y.noguchi/Code/nightWorkers",
				branch: "main",
			});
			const task = await repo.createTask({
				repositoryId: repository.id,
				title: "TEST: Mock Blueprint empty dataset task",
				description: "Validate mock blueprint dataset repair.",
				status: "draft",
			});
			const rawOutput = process.env.SUPERVISOR_FIXTURE_OUTPUT;
			await expect(
				generatePlanModeMockBlueprintDraft({
					taskId: task.id,
					title: "Empty Dataset Repair Mock",
					prompt: "empty dataset repair",
				}),
			).rejects.toMatchObject({ rawOutput });
		} finally {
			if (originalProvider === undefined)
				delete process.env.ACTIVE_LLM_PROVIDER;
			else process.env.ACTIVE_LLM_PROVIDER = originalProvider;
			if (originalFixture === undefined)
				delete process.env.SUPERVISOR_FIXTURE_OUTPUT;
			else process.env.SUPERVISOR_FIXTURE_OUTPUT = originalFixture;
			if (originalSettingsPath === undefined)
				delete process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
			else process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = originalSettingsPath;
		}
	});

	it("does not pad empty datasets", async () => {
		const originalProvider = process.env.ACTIVE_LLM_PROVIDER;
		const originalFixture = process.env.SUPERVISOR_FIXTURE_OUTPUT;
		const originalSettingsPath = process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
		process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = `/tmp/nightworkers-test-llm-settings-${crypto.randomUUID()}.json`;
		process.env.ACTIVE_LLM_PROVIDER = "fixture";
		process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({
			...mockBlueprintFixtureWithoutMeta(),
			screens: [
				{
					...representativeMockBlueprint.screens[0],
					sections: [
						emptyDatasetSection("nav", "SidebarMenuSection", "navigation", {
							items: [],
						}),
						emptyDatasetSection("form", "FormSection", "form", { fields: [] }),
						emptyDatasetSection("cards", "CardGridSection", "cards", {
							cards: [],
						}),
						emptyDatasetSection("timeline", "TimelineSection", "timeline", {
							items: [],
						}),
						emptyDatasetSection("chat", "ChatPanelSection", "chat", {
							messages: [],
						}),
						emptyDatasetSection(
							"metrics",
							"AnalyticsDashboardSection",
							"metrics",
							{ metrics: [] },
						),
					],
				},
			],
		});

		try {
			const repository = await repo.createRepository({
				name: `TEST: Mock Blueprint Empty Non Table ${crypto.randomUUID()}`,
				localPath: "/Users/y.noguchi/Code/nightWorkers",
				branch: "main",
			});
			const task = await repo.createTask({
				repositoryId: repository.id,
				title: "TEST: Mock Blueprint empty non-table dataset task",
				description: "Validate non-table mock blueprint dataset repair.",
				status: "draft",
			});
			const rawOutput = process.env.SUPERVISOR_FIXTURE_OUTPUT;
			await expect(
				generatePlanModeMockBlueprintDraft({
					taskId: task.id,
					title: "Empty Non Table Dataset Repair Mock",
					prompt: "empty non-table dataset repair",
				}),
			).rejects.toMatchObject({ rawOutput });
		} finally {
			if (originalProvider === undefined)
				delete process.env.ACTIVE_LLM_PROVIDER;
			else process.env.ACTIVE_LLM_PROVIDER = originalProvider;
			if (originalFixture === undefined)
				delete process.env.SUPERVISOR_FIXTURE_OUTPUT;
			else process.env.SUPERVISOR_FIXTURE_OUTPUT = originalFixture;
			if (originalSettingsPath === undefined)
				delete process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
			else process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = originalSettingsPath;
		}
	});

	it("preserves explicit meta without adding selected sections", async () => {
		const originalProvider = process.env.ACTIVE_LLM_PROVIDER;
		const originalFixture = process.env.SUPERVISOR_FIXTURE_OUTPUT;
		const originalSettingsPath = process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
		process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = `/tmp/nightworkers-test-llm-settings-${crypto.randomUUID()}.json`;
		process.env.ACTIVE_LLM_PROVIDER = "fixture";
		process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({
			...representativeMockBlueprint,
			meta: {
				intent: "Explicit operator review intent.",
				selectedSections: [
					{
						sectionType: "SidebarMenuSection",
						selectionReason: "Explicit navigation reason from the provider.",
					},
				],
			},
		});

		try {
			const repository = await repo.createRepository({
				name: `TEST: Mock Blueprint Partial Meta ${crypto.randomUUID()}`,
				localPath: "/Users/y.noguchi/Code/nightWorkers",
				branch: "main",
			});
			const task = await repo.createTask({
				repositoryId: repository.id,
				title: "TEST: Mock Blueprint partial meta task",
				description: "Validate mock blueprint meta completion.",
				status: "draft",
			});
			const result = await generatePlanModeMockBlueprintDraft({
				taskId: task.id,
				title: "Partial Meta Mock",
				prompt: "partial meta repair",
			});

			expect(result.mockBlueprint.meta.intent).toBe(
				"Explicit operator review intent.",
			);
			expect(result.mockBlueprint.meta.selectedSections).toEqual([
				{
					sectionType: "SidebarMenuSection",
					selectionReason: "Explicit navigation reason from the provider.",
				},
			]);
		} finally {
			if (originalProvider === undefined)
				delete process.env.ACTIVE_LLM_PROVIDER;
			else process.env.ACTIVE_LLM_PROVIDER = originalProvider;
			if (originalFixture === undefined)
				delete process.env.SUPERVISOR_FIXTURE_OUTPUT;
			else process.env.SUPERVISOR_FIXTURE_OUTPUT = originalFixture;
			if (originalSettingsPath === undefined)
				delete process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
			else process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = originalSettingsPath;
		}
	});

	it("repairs raw mock JSON when the model appends malformed trailing fragments", async () => {
		const originalProvider = process.env.ACTIVE_LLM_PROVIDER;
		const originalFixture = process.env.SUPERVISOR_FIXTURE_OUTPUT;
		const originalSettingsPath = process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
		process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = `/tmp/nightworkers-test-llm-settings-${crypto.randomUUID()}.json`;
		process.env.ACTIVE_LLM_PROVIDER = "fixture";
		const malformedOutput = `${JSON.stringify(representativeMockBlueprint)},{"trailing":true}`;
		process.env.SUPERVISOR_FIXTURE_OUTPUT = malformedOutput;

		try {
			const repository = await repo.createRepository({
				name: `TEST: Mock Blueprint Raw Repair ${crypto.randomUUID()}`,
				localPath: "/Users/y.noguchi/Code/nightWorkers",
				branch: "main",
			});
			const task = await repo.createTask({
				repositoryId: repository.id,
				title: "TEST: Mock Blueprint raw repair task",
				description: "Validate raw mock blueprint repair.",
				status: "draft",
			});
			const result = await generatePlanModeMockBlueprintDraft({
				taskId: task.id,
				title: "Raw Repair Mock",
				prompt: "raw repair",
			});

			expect(result.mockBlueprint).toEqual(representativeMockBlueprint);
			expect(result.mockBlueprint.screens).toHaveLength(1);
			expect(result.generation.jsonRepair?.repairKind).toBe(
				"extracted_candidate",
			);
		} finally {
			if (originalProvider === undefined)
				delete process.env.ACTIVE_LLM_PROVIDER;
			else process.env.ACTIVE_LLM_PROVIDER = originalProvider;
			if (originalFixture === undefined)
				delete process.env.SUPERVISOR_FIXTURE_OUTPUT;
			else process.env.SUPERVISOR_FIXTURE_OUTPUT = originalFixture;
			if (originalSettingsPath === undefined)
				delete process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
			else process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = originalSettingsPath;
		}
	});
});

function expectStrictRequiredProperties(schema: unknown) {
	if (!schema || typeof schema !== "object" || Array.isArray(schema)) return;
	const record = schema as Record<string, unknown>;
	if (record.additionalProperties === false && isRecord(record.properties)) {
		const required = Array.isArray(record.required)
			? record.required.map(String)
			: [];
		expect(required.sort()).toEqual(Object.keys(record.properties).sort());
	}
	for (const value of Object.values(record)) {
		if (Array.isArray(value)) {
			for (const item of value) expectStrictRequiredProperties(item);
		} else {
			expectStrictRequiredProperties(value);
		}
	}
}

function mockBlueprintFixtureWithoutMeta() {
	return Object.fromEntries(
		Object.entries(representativeMockBlueprint).filter(
			([key]) => key !== "meta",
		),
	);
}

function emptyDatasetSection(
	id: string,
	componentName: string,
	kind: string,
	dataset: Record<string, unknown>,
) {
	return {
		id,
		name: `${id} section`,
		componentName,
		region: componentName === "SidebarMenuSection" ? "sidebar" : "main",
		selectionReason: `${id} section supports empty dataset repair.`,
		copy: {
			title: `${id} sample`,
			description: `${id} repair description`,
			primaryActionLabel: null,
			secondaryActionLabel: null,
			emptyStateTitle: null,
			emptyStateDescription: null,
		},
		dataset: { kind, ...dataset },
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
