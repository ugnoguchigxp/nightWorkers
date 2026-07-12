import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import "../src/i18n/setup";
import { CoverageFileDrawer } from "../src/modules/quality/components/CoverageFileDrawer";
import { QualityReportPanel } from "../src/modules/quality/components/QualityReportPanel";
import { coverageRowsFromSummary } from "../src/modules/quality/model/qualityRows";

describe("Quality screen coverage selection", () => {
	it("keeps raw row keys and renders selectable file rows only", () => {
		const rows = coverageRowsFromSummary(
			{
				total: {
					statements: { pct: 80 },
					branches: { pct: 70 },
					functions: { pct: 85 },
					lines: { pct: 79 },
				},
				"/repo/src/example.ts": {
					statements: { pct: 60 },
					branches: { pct: 50 },
					functions: { pct: 75 },
					lines: { pct: 62 },
					uncoveredLines: [10, 14],
				},
			},
			"/repo",
		);
		expect(rows[1]).toMatchObject({
			key: "/repo/src/example.ts",
			file: "src/example.ts",
		});

		const markup = renderToStaticMarkup(
			<QualityReportPanel
				quality={null}
				coverageRows={rows}
				e2eRows={[]}
				busy={false}
				selectedFileKeys={["/repo/src/example.ts"]}
				onRun={vi.fn()}
				onToggleFile={vi.fn()}
				onCreateTask={vi.fn()}
			/>,
		);
		expect(markup).toContain("選択ファイルからTask作成（1）");
		expect(markup).toContain("src/example.ts を選択");
		expect(markup.match(/type="checkbox"/g)).toHaveLength(1);
		expect(markup).toContain("checked");
		expect(markup).toContain("src/example.ts をViewerで開く");
		expect(markup).toContain("color:var(--nw-primary)");
		expect(markup).toContain("cursor-pointer");
	});

	it("renders a polite success notice", () => {
		const markup = renderToStaticMarkup(
			<QualityReportPanel
				quality={null}
				coverageRows={[]}
				e2eRows={[]}
				busy={false}
				notice="Draft Taskを作成しました"
				onRun={vi.fn()}
			/>,
		);
		expect(markup).toContain('aria-live="polite"');
		expect(markup).toContain("Draft Taskを作成しました");
	});

	it("does not label another quality action as task creation", () => {
		const markup = renderToStaticMarkup(
			<QualityReportPanel
				quality={null}
				coverageRows={[]}
				e2eRows={[]}
				busy={true}
				creatingTask={false}
				selectedFileKeys={["src/example.ts"]}
				onRun={vi.fn()}
			/>,
		);

		expect(markup).toContain("選択ファイルからTask作成（1）");
		expect(markup).not.toContain("Task作成中");
	});

	it("renders command output exactly once", () => {
		const run = {
			id: "00000000-0000-0000-0000-000000000001",
			repositoryId: "00000000-0000-0000-0000-000000000002",
			runType: "unit" as const,
			status: "completed" as const,
			command: "bun run test",
			exitCode: 0,
			startedAt: "2026-07-10T00:00:00.000Z",
			completedAt: "2026-07-10T00:01:00.000Z",
			outputArtifactId: null,
			latestOutput: "UNIQUE_QUALITY_OUTPUT",
			coverageSummary: null,
			e2eSummary: null,
			errorMessage: null,
			createdAt: "2026-07-10T00:00:00.000Z",
			updatedAt: "2026-07-10T00:01:00.000Z",
		};
		const markup = renderToStaticMarkup(
			<QualityReportPanel
				quality={{
					capabilities: {
						projectType: "typescript",
						unit: { runnable: true, missingCapabilities: [] },
						coverage: { runnable: true, missingCapabilities: [] },
						e2e: { runnable: false, missingCapabilities: ["e2e"] },
						all: { runnable: false, missingCapabilities: ["e2e"] },
					},
					latestUnitRun: run,
					latestE2eRun: null,
					latestCoverageRun: run,
					latestE2eResultRun: null,
					latestAllRun: null,
					recentRuns: [run],
					runningRuns: [],
				}}
				coverageRows={[]}
				e2eRows={[]}
				busy={false}
				onRun={vi.fn()}
			/>,
		);

		expect(markup.match(/UNIQUE_QUALITY_OUTPUT/g)).toHaveLength(1);
	});

	it("renders the coverage drawer with source and coverage report viewer tabs", () => {
		const markup = renderToStaticMarkup(
			<CoverageFileDrawer
				repositoryId="00000000-0000-4000-8000-000000000001"
				runId="00000000-0000-4000-8000-000000000002"
				row={{
					key: "/repo/src/example.ts",
					file: "src/example.ts",
					statements: 80,
					branches: 70,
					functions: 90,
					lines: 82,
					uncovered: "12",
				}}
				onClose={vi.fn()}
			/>,
		);

		expect(markup).toContain('role="dialog"');
		expect(markup).toContain("src/example.ts");
		expect(markup).toContain("Source");
		expect(markup).toContain("Coverage report");
		expect(markup).toContain("md:w-1/2");
		expect(markup).toContain("Viewerを読み込んでいます");
	});
});
