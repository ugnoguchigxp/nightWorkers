import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import "../src/i18n/setup";
import {
	coverageAxesFromQualityRun,
	QualityReportPanel,
} from "../src/modules/quality/components/QualityReportPanel";
import { coverageRowsFromSummary } from "../src/modules/quality/model/qualityRows";

describe("QualityReportPanel", () => {
	const allRun = {
		id: "11111111-1111-4111-8111-111111111111",
		repositoryId: "22222222-2222-4222-8222-222222222222",
		runType: "all" as const,
		status: "completed" as const,
		command: "bun run test && bun run test:coverage && bun run test:e2e",
		exitCode: 0,
		startedAt: new Date("2026-07-04T00:00:00.000Z"),
		completedAt: new Date("2026-07-04T00:00:02.000Z"),
		outputArtifactId: null,
		latestOutput: "unit\ncoverage\ne2e",
		coverageSummary: {
			total: {
				statements: { pct: 88.2 },
				branches: { pct: 81.4 },
				functions: { pct: 90 },
				lines: { pct: 87.5 },
			},
			"src/checkout.ts": {
				statements: { pct: 75 },
				branches: {},
				functions: { pct: 80 },
				lines: { pct: 72 },
				uncoveredLines: [12, 18],
			},
		},
		coverageGate: {
			enabled: true,
			passed: true,
			targetPercent: 80,
			metrics: [
				{
					metric: "lines" as const,
					actualPercent: 87.5,
					targetPercent: 80,
					deltaPercent: 7.5,
					passed: true,
				},
			],
			failedMetrics: [],
			measuredAt: "2026-07-04T00:00:02.000Z",
		},
		e2eSummary: {
			status: "passed" as const,
			total: 1,
			passed: 1,
			failed: 0,
			skipped: 0,
			durationMs: 120,
			suites: [
				{
					title: "checkout.spec.ts",
					status: "passed" as const,
					tests: 1,
					durationMs: 120,
					lastFailure: null,
				},
			],
		},
		errorMessage: null,
		createdAt: new Date("2026-07-04T00:00:00.000Z"),
		updatedAt: new Date("2026-07-04T00:00:02.000Z"),
	};

	const runnableCapability = {
		runnable: true,
		missingCapabilities: [],
		command: "bun run test",
	};

	it("renders all-run coverage and E2E data through explicit overview fields", () => {
		const markup = renderToStaticMarkup(
			<QualityReportPanel
				quality={{
					capabilities: {
						projectType: "typescript",
						unit: runnableCapability,
						coverage: {
							...runnableCapability,
							command: "bun run test:coverage",
						},
						e2e: { ...runnableCapability, command: "bun run test:e2e" },
						all: {
							...runnableCapability,
							command:
								"bun run test && bun run test:coverage && bun run test:e2e",
						},
					},
					latestUnitRun: null,
					latestE2eRun: null,
					latestCoverageRun: allRun,
					latestE2eResultRun: allRun,
					latestAllRun: allRun,
					recentRuns: [allRun],
					runningRuns: [],
				}}
				coverageRows={coverageRowsFromSummary(allRun.coverageSummary)}
				e2eRows={[
					{
						suite: "checkout.spec.ts",
						status: "PASS",
						tests: "1",
						duration: "0s",
						lastFailure: "—",
					},
				]}
				busy={false}
				onRun={vi.fn()}
			/>,
		);

		expect(markup).toContain("src/checkout.ts");
		expect(markup).toContain("72.0");
		expect(markup).toContain("—");
		expect(markup).toContain("checkout.spec.ts");
		expect(markup).toContain("bun run test &amp;&amp; bun run test:coverage");
		expect(markup).toContain("Coverage Gate: PASS / target 80%");
		expect(markup).toContain("コマンド出力");
	});

	it("builds overview coverage gate axes from coverage summary when the gate is disabled", () => {
		const axes = coverageAxesFromQualityRun({
			...allRun,
			coverageGate: {
				enabled: false,
				passed: true,
				targetPercent: 80,
				metrics: [],
				failedMetrics: [],
				measuredAt: "2026-07-04T00:00:02.000Z",
				reason: "coverage_gate_disabled",
			},
		});

		expect(axes).toEqual([
			{ labelKey: "projectDetail.coverage.statements", value: 88.2 },
			{ labelKey: "projectDetail.coverage.branches", value: 81.4 },
			{ labelKey: "projectDetail.coverage.functions", value: 90 },
			{ labelKey: "projectDetail.coverage.lines", value: 87.5 },
		]);
	});

	it("shows capability and run errors instead of an unqualified empty table", () => {
		const failedRun = {
			...allRun,
			status: "failed" as const,
			exitCode: 1,
			errorMessage: "boom",
		};
		const markup = renderToStaticMarkup(
			<QualityReportPanel
				quality={{
					capabilities: {
						projectType: "typescript",
						unit: runnableCapability,
						coverage: { runnable: false, missingCapabilities: ["coverage"] },
						e2e: runnableCapability,
						all: { runnable: false, missingCapabilities: ["coverage"] },
					},
					latestUnitRun: null,
					latestE2eRun: null,
					latestCoverageRun: null,
					latestE2eResultRun: failedRun,
					latestAllRun: failedRun,
					recentRuns: [failedRun],
					runningRuns: [],
				}}
				coverageRows={[]}
				e2eRows={[]}
				busy={false}
				onRun={vi.fn()}
			/>,
		);

		expect(markup).toContain("不足している capability: coverage");
		expect(markup).toContain("boom");
		expect(markup).toContain("exit 1");
	});
});

describe("coverageRowsFromSummary", () => {
	it("keeps total and file rows while preserving unknown metric values", () => {
		const rows = coverageRowsFromSummary({
			total: {
				statements: { pct: 90 },
				branches: { pct: 80 },
				functions: { pct: 85 },
				lines: { pct: 88 },
			},
			"src/b.ts": {
				statements: { pct: 70 },
				branches: { pct: 60 },
				functions: { pct: 75 },
				lines: { pct: 72 },
			},
			"src/a.ts": {
				statements: { pct: 71 },
				branches: {},
				functions: { pct: 76 },
				lines: { pct: 73 },
				uncoveredLines: [4, "8", { invalid: true }],
			},
		});

		expect(rows.map((row) => row.file)).toEqual([
			"total",
			"src/a.ts",
			"src/b.ts",
		]);
		expect(rows[1].branches).toBeNull();
		expect(rows[1].uncovered).toBe("4, 8");
	});

	it("displays coverage files relative to the project root", () => {
		const rows = coverageRowsFromSummary(
			{
				total: {
					statements: { pct: 90 },
					branches: { pct: 80 },
					functions: { pct: 85 },
					lines: { pct: 88 },
				},
				"/Users/y.noguchi/Code/todolist/api/app/env.ts": {
					statements: { pct: 70 },
					branches: { pct: 60 },
					functions: { pct: 75 },
					lines: { pct: 72 },
				},
				"/tmp/outside.ts": {
					statements: { pct: 71 },
					branches: { pct: 61 },
					functions: { pct: 76 },
					lines: { pct: 73 },
				},
			},
			"/Users/y.noguchi/Code/todolist",
		);

		expect(rows.map((row) => row.file)).toEqual([
			"total",
			"/tmp/outside.ts",
			"api/app/env.ts",
		]);
	});

	it("ignores combined-report metadata that is not a coverage file", () => {
		const rows = coverageRowsFromSummary({
			total: {
				statements: { pct: 90 },
				branches: { pct: 80 },
				functions: { pct: 85 },
				lines: { pct: 88 },
			},
			segments: {
				backend: { lines: { pct: 90 } },
				frontend: { lines: { pct: 80 } },
			},
			scope: { backendFiles: 10, frontendFiles: 8 },
		});

		expect(rows.map((row) => row.file)).toEqual(["total"]);
	});
});
