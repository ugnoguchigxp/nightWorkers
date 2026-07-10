import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
	ProjectCodeSizeSnapshot,
	ProjectStackProfile,
} from "../shared/schemas/tech-stack.schema";
import "../src/i18n/setup";
import {
	measureProjectCodeSize,
	TechStackPanel,
} from "../src/modules/techStack";

const stackProfile: ProjectStackProfile = {
	summary: "TypeScript + React + Hono",
	manifestStatus: "found",
	manifestPath: "/tmp/package.json",
	packageManager: "bun",
	technologies: [
		{
			name: "React",
			category: "frontend",
			packageName: "react",
			version: "19",
			source: "package_json",
			confidence: "high",
		},
	],
};

const sourceCategories = [
	"frontend",
	"backend",
	"batch",
	"script",
	"shared",
	"database",
	"desktop",
	"other",
] as const;
const testKinds = ["unit", "e2e", "other"] as const;

const snapshot: ProjectCodeSizeSnapshot = {
	id: "11111111-1111-4111-8111-111111111111",
	repositoryId: "22222222-2222-4222-8222-222222222222",
	schemaVersion: 1,
	algorithmVersion: "effective-lines-v1",
	measuredAt: "2026-07-10T00:00:00.000Z",
	scanDurationMs: 120,
	inventory: {
		source: "git",
		listedFiles: 8,
		skipped: {
			unsupportedExtension: 2,
			generatedPath: 0,
			tooLarge: 0,
			binary: 0,
			symlink: 0,
			missing: 0,
			unreadable: 0,
		},
	},
	git: {
		status: "available",
		head: "abcdef1234567890",
		shortHead: "abcdef1234",
		dirty: true,
	},
	totals: {
		totalFiles: 6,
		sourceFiles: 4,
		testFiles: 2,
		totalEffectiveLines: 120,
		sourceEffectiveLines: 90,
		testEffectiveLines: 30,
	},
	sourceBuckets: sourceCategories.map((category, index) => ({
		category,
		files: index === 0 ? 4 : 0,
		effectiveLines: index === 0 ? 90 : 0,
		roots:
			index === 0
				? [
						{
							path: "src",
							files: 4,
							effectiveLines: 90,
							classificationSource: "manifest_evidence" as const,
						},
					]
				: [],
	})),
	testBuckets: testKinds.map((kind) => ({
		kind,
		files: kind === "other" ? 0 : 1,
		effectiveLines: kind === "unit" ? 20 : kind === "e2e" ? 10 : 0,
		roots:
			kind === "other"
				? []
				: [
						{
							path: kind === "unit" ? "tests" : "tests/e2e",
							files: 1,
							effectiveLines: kind === "unit" ? 20 : 10,
							classificationSource: "test_path_rule" as const,
						},
					],
	})),
	warnings: [],
	createdAt: "2026-07-10T00:00:00.000Z",
	updatedAt: "2026-07-10T00:00:00.000Z",
};

describe("TechStackPanel", () => {
	it("uses the Tech Stack feature endpoint for measurement", async () => {
		const fetchMock = vi.fn<typeof fetch>(() =>
			Promise.resolve(new Response("{}")),
		);
		vi.stubGlobal("fetch", fetchMock);
		try {
			await measureProjectCodeSize("repo-1");
			expect(fetchMock).toHaveBeenCalledWith(
				"/api/repositories/repo-1/tech-stack/code-size/measure",
				expect.objectContaining({ method: "POST", body: "{}" }),
			);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("renders the combined size equation and separate source/test breakdowns", () => {
		const markup = renderToStaticMarkup(
			<TechStackPanel
				stackProfile={stackProfile}
				projectPath="/tmp/project"
				codeSizeSnapshot={snapshot}
				currentGitHead="different-head"
				measurementBusy={false}
				onMeasureCodeSize={vi.fn()}
			/>,
		);
		expect(markup).toContain("120 = 90 + 30");
		expect(markup).toContain("Frontend");
		expect(markup).toContain("Unitテスト");
		expect(markup).toContain("E2Eテスト");
		expect(markup).toContain("src");
		expect(markup).toContain("90 実ステップ");
		expect(markup).toContain("4 ファイル");
		expect(markup).toContain("保存後にHEADが更新されています");
	});

	it("renders an explicit empty state and disables measurement while busy", () => {
		const markup = renderToStaticMarkup(
			<TechStackPanel
				stackProfile={stackProfile}
				projectPath="/tmp/project"
				codeSizeSnapshot={null}
				currentGitHead={null}
				measurementBusy
				onMeasureCodeSize={vi.fn()}
			/>,
		);
		expect(markup).toContain("コードサイズはまだ計測されていません");
		expect(markup).toContain("disabled");
		expect(markup).toContain("計測中");
	});
});
