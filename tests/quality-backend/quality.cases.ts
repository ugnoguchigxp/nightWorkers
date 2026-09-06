import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect } from "vitest";
import app from "../../api/app";
import { coverageCommandWithSummaryReporter } from "../../api/modules/quality/quality-artifacts";
import type { ProjectQualityCapabilities } from "../../shared/schemas/quality.schema";
import {
	createRepository,
	writeCoverageSummary,
	writePlaywrightSummary,
} from "../project-detail-backend/helpers";
import "../project-detail-backend/setup";

describe("Quality backend", () => {
	it("appends missing coverage reporters without duplicating a Bun argument separator", () => {
		const capabilities = {
			coverage: {
				runnable: true,
				missingCapabilities: [],
				command: "bun run test:coverage -- --coverage.reporter=json-summary",
			},
		} as ProjectQualityCapabilities;
		const command = coverageCommandWithSummaryReporter(capabilities);

		expect(command?.match(/ -- /g)).toHaveLength(1);
		expect(command).toContain("--coverage.reporter=text");
		expect(command).toContain("--coverage.reporter=html");
	});

	it("rejects quality runs when required capability is missing", async () => {
		const repoRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "nightworkers-detail-quality-"),
		);
		try {
			fs.writeFileSync(
				path.join(repoRoot, "package.json"),
				JSON.stringify({ scripts: { test: "echo unit" } }),
				"utf8",
			);
			const project = await createRepository(repoRoot);

			const qualityRes = await app.request(
				`http://localhost/api/repositories/${project.id}/quality`,
			);
			expect(qualityRes.status).toBe(200);
			const quality = await qualityRes.json();
			expect(quality.capabilities.e2e.runnable).toBe(false);

			const runRes = await app.request(
				`http://localhost/api/repositories/${project.id}/quality/runs`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ runType: "e2e" }),
				},
			);
			expect(runRes.status).toBe(400);

			const runsRes = await app.request(
				`http://localhost/api/repositories/${project.id}/quality/runs`,
			);
			expect(await runsRes.json()).toHaveLength(0);
		} finally {
			fs.rmSync(repoRoot, { recursive: true, force: true });
		}
	});

	it("persists quality run completion when coverage parsing fails", async () => {
		const repoRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "nightworkers-detail-coverage-"),
		);
		try {
			fs.mkdirSync(path.join(repoRoot, "coverage"));
			fs.writeFileSync(
				path.join(repoRoot, "coverage", "coverage-summary.json"),
				"{broken",
			);
			fs.writeFileSync(
				path.join(repoRoot, "package.json"),
				JSON.stringify({
					scripts: { test: "echo unit", "test:coverage": "echo coverage" },
				}),
				"utf8",
			);
			const project = await createRepository(repoRoot);

			const runRes = await app.request(
				`http://localhost/api/repositories/${project.id}/quality/runs`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ runType: "unit" }),
				},
			);
			expect(runRes.status).toBe(201);
			const run = await runRes.json();
			expect(run.status).toBe("completed");
			expect(run.errorMessage).toContain(
				"Failed to read coverage-summary.json",
			);

			const qualityRes = await app.request(
				`http://localhost/api/repositories/${project.id}/quality`,
			);
			const quality = await qualityRes.json();
			expect(quality.runningRuns).toHaveLength(0);
			expect(quality.latestUnitRun.id).toBe(run.id);
		} finally {
			fs.rmSync(repoRoot, { recursive: true, force: true });
		}
	});

	it("requests Vitest json-summary coverage artifacts for project quality runs", async () => {
		const repoRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "nightworkers-detail-coverage-reporter-"),
		);
		try {
			fs.mkdirSync(path.join(repoRoot, "scripts"), { recursive: true });
			fs.writeFileSync(
				path.join(
					repoRoot,
					"scripts",
					"write-coverage-if-summary-reporter.cjs",
				),
				[
					"const fs = require('node:fs');",
					"if (!process.argv.includes('--coverage.reporter=json-summary')) process.exit(0);",
					"fs.mkdirSync('coverage', { recursive: true });",
					"fs.writeFileSync(",
					"  'coverage/coverage-summary.json',",
					"  JSON.stringify({",
					"    total: {",
					"      statements: { pct: 91 },",
					"      branches: { pct: 90 },",
					"      functions: { pct: 92 },",
					"      lines: { pct: 93 }",
					"    }",
					"  })",
					");",
				].join("\n"),
				"utf8",
			);
			fs.writeFileSync(
				path.join(repoRoot, "package.json"),
				JSON.stringify({
					scripts: {
						test: "echo unit",
						"test:coverage":
							"node scripts/write-coverage-if-summary-reporter.cjs",
					},
				}),
				"utf8",
			);
			const project = await createRepository(repoRoot);

			const runRes = await app.request(
				`http://localhost/api/repositories/${project.id}/quality/runs`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ runType: "unit" }),
				},
			);

			expect(runRes.status).toBe(201);
			const run = await runRes.json();
			expect(run.status).toBe("completed");
			expect(run.command).toContain("--coverage.reporter=json-summary");
			expect(run.command).toContain("--coverage.reporter=html");
			expect(run.errorMessage).toBeNull();
			expect(run.coverageSummary.total.lines.pct).toBe(93);
		} finally {
			fs.rmSync(repoRoot, { recursive: true, force: true });
		}
	});

	it("runs coverage directly and reflects coverage-final.json even when tests fail", async () => {
		const repoRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "nightworkers-detail-coverage-final-"),
		);
		try {
			fs.mkdirSync(path.join(repoRoot, "scripts"), { recursive: true });
			fs.writeFileSync(
				path.join(repoRoot, "scripts", "write-coverage-final.cjs"),
				[
					"const fs = require('node:fs');",
					"const path = require('node:path');",
					`const file = path.join(${JSON.stringify(repoRoot)}, 'src', 'example.ts');`,
					"fs.mkdirSync('coverage/src', { recursive: true });",
					"fs.writeFileSync('coverage/index.html', '<html><body>index</body></html>');",
					"fs.writeFileSync('coverage/src/example.ts.html', '<html><body><pre>example</pre></body></html>');",
					"fs.writeFileSync('coverage/coverage-final.json', JSON.stringify({",
					"  [file]: {",
					"    path: file,",
					"    statementMap: { 0: { start: { line: 1 }, end: { line: 1 } }, 1: { start: { line: 2 }, end: { line: 2 } } },",
					"    s: { 0: 1, 1: 0 },",
					"    fnMap: { 0: { loc: { start: { line: 1 }, end: { line: 1 } } } },",
					"    f: { 0: 1 },",
					"    branchMap: { 0: { locations: [{ start: { line: 1 } }, { start: { line: 2 } }] } },",
					"    b: { 0: [1, 0] }",
					"  }",
					"}));",
					"process.exit(1);",
				].join("\n"),
				"utf8",
			);
			fs.writeFileSync(
				path.join(repoRoot, "package.json"),
				JSON.stringify({
					scripts: {
						test: 'node -e "process.exit(1)"',
						"test:coverage": "node scripts/write-coverage-final.cjs",
					},
				}),
				"utf8",
			);
			const project = await createRepository(repoRoot);

			const runRes = await app.request(
				`http://localhost/api/repositories/${project.id}/quality/runs`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ runType: "unit" }),
				},
			);

			expect(runRes.status).toBe(201);
			const run = await runRes.json();
			expect(run.status).toBe("failed");
			expect(run.command).not.toContain("bun run 'test' &&");
			expect(run.command).toContain("bun run 'test:coverage'");
			expect(run.errorMessage).toBeNull();
			expect(run.coverageSummary.total.lines).toMatchObject({
				total: 2,
				covered: 1,
				pct: 50,
			});
			const fileKey = Object.keys(run.coverageSummary).find((key) =>
				key.endsWith("/src/example.ts"),
			);
			expect(fileKey).toBeDefined();
			expect(run.coverageSummary[fileKey ?? ""]).toMatchObject({
				lines: { pct: 50 },
				statements: { pct: 50 },
				functions: { pct: 100 },
				branches: { pct: 50 },
				uncoveredLines: [2],
			});

			const qualityRes = await app.request(
				`http://localhost/api/repositories/${project.id}/quality`,
			);
			const quality = await qualityRes.json();
			expect(quality.latestCoverageRun.id).toBe(run.id);

			const reportRes = await app.request(
				`http://localhost/api/repositories/${project.id}/quality/runs/${run.id}/coverage-report?fileKey=${encodeURIComponent(fileKey ?? "")}`,
			);
			expect(await reportRes.json()).toMatchObject({
				available: true,
				reason: null,
			});
		} finally {
			fs.rmSync(repoRoot, { recursive: true, force: true });
		}
	});

	it("serves a sanitized fresh single-directory HTML coverage report", async () => {
		const repoRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "nightworkers-detail-coverage-html-"),
		);
		try {
			writeCoverageSummary(repoRoot);
			fs.mkdirSync(path.join(repoRoot, "coverage", "src"), { recursive: true });
			fs.mkdirSync(path.join(repoRoot, "src"), { recursive: true });
			fs.writeFileSync(
				path.join(repoRoot, "src", "checkout.ts"),
				"export const checkout = true;\n",
			);
			fs.writeFileSync(
				path.join(repoRoot, "coverage", "index.html"),
				"<html><body>index</body></html>",
			);
			fs.writeFileSync(
				path.join(repoRoot, "coverage", "src", "checkout.ts.html"),
				'<html><body><span class="cline-any cline-no">0x</span><pre>checkout</pre><img src="x" onerror="globalThis.pwned=true"><script>globalThis.pwned=true</script></body></html>',
			);
			fs.writeFileSync(
				path.join(repoRoot, "package.json"),
				JSON.stringify({
					scripts: { test: "echo unit", "test:coverage": "echo coverage" },
				}),
			);
			const project = await createRepository(repoRoot);
			const runRes = await app.request(
				`http://localhost/api/repositories/${project.id}/quality/runs`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ runType: "unit" }),
				},
			);
			const run = (await runRes.json()) as { id: string };
			const reportRes = await app.request(
				`http://localhost/api/repositories/${project.id}/quality/runs/${run.id}/coverage-report?fileKey=${encodeURIComponent("src/checkout.ts")}`,
			);

			expect(reportRes.status).toBe(200);
			const report = await reportRes.json();
			expect(report).toMatchObject({ available: true, reason: null });
			expect(report.html).toContain("cline-any cline-no");
			expect(report.html).not.toContain("<script");
			expect(report.html).not.toContain("onerror");
			expect(report.html).toContain(
				"table.coverage td span.cline-any { display: inline-block;",
			);
			expect(report.html).not.toContain(".cline-any { display: block;");

			const future = new Date(Date.now() + 10 * 60 * 1000);
			fs.utimesSync(
				path.join(repoRoot, "coverage", "src", "checkout.ts.html"),
				future,
				future,
			);
			const staleReportRes = await app.request(
				`http://localhost/api/repositories/${project.id}/quality/runs/${run.id}/coverage-report?fileKey=${encodeURIComponent("src/checkout.ts")}`,
			);
			expect(await staleReportRes.json()).toMatchObject({
				available: false,
				reason: "report_stale",
			});
		} finally {
			fs.rmSync(repoRoot, { recursive: true, force: true });
		}
	});

	it("does not expose split coverage reports through the file viewer", async () => {
		const repoRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "nightworkers-detail-coverage-split-"),
		);
		try {
			writeCoverageSummary(repoRoot);
			fs.mkdirSync(path.join(repoRoot, "coverage-backend"));
			fs.writeFileSync(
				path.join(repoRoot, "coverage-backend", "coverage-summary.json"),
				JSON.stringify({ total: { lines: { pct: 80 } } }),
			);
			fs.writeFileSync(
				path.join(repoRoot, "coverage", "index.html"),
				"<html><body>index</body></html>",
			);
			fs.writeFileSync(
				path.join(repoRoot, "package.json"),
				JSON.stringify({
					scripts: { test: "echo unit", "test:coverage": "echo coverage" },
				}),
			);
			const project = await createRepository(repoRoot);
			const runRes = await app.request(
				`http://localhost/api/repositories/${project.id}/quality/runs`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ runType: "unit" }),
				},
			);
			const run = (await runRes.json()) as { id: string };
			const reportRes = await app.request(
				`http://localhost/api/repositories/${project.id}/quality/runs/${run.id}/coverage-report?fileKey=${encodeURIComponent("src/checkout.ts")}`,
			);
			expect(await reportRes.json()).toMatchObject({
				available: false,
				reason: "not_single_report",
			});
		} finally {
			fs.rmSync(repoRoot, { recursive: true, force: true });
		}
	});

	it("keeps coverage JSON only on the latest completed run", async () => {
		const repoRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "nightworkers-detail-coverage-latest-"),
		);
		try {
			writeCoverageSummary(repoRoot);
			fs.writeFileSync(
				path.join(repoRoot, "package.json"),
				JSON.stringify({
					scripts: { test: "echo unit", "test:coverage": "echo coverage" },
				}),
				"utf8",
			);
			const project = await createRepository(repoRoot);

			const firstRes = await app.request(
				`http://localhost/api/repositories/${project.id}/quality/runs`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ runType: "unit" }),
				},
			);
			expect(firstRes.status).toBe(201);
			const firstRun = (await firstRes.json()) as { id: string };

			const secondRes = await app.request(
				`http://localhost/api/repositories/${project.id}/quality/runs`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ runType: "unit" }),
				},
			);
			expect(secondRes.status).toBe(201);
			const secondRun = (await secondRes.json()) as { id: string };

			const firstStored = await app.request(
				`http://localhost/api/repositories/${project.id}/quality/runs/${firstRun.id}`,
			);
			const secondStored = await app.request(
				`http://localhost/api/repositories/${project.id}/quality/runs/${secondRun.id}`,
			);
			expect(firstStored.status).toBe(200);
			expect(secondStored.status).toBe(200);
			expect((await firstStored.json()).coverageSummary).toBeNull();
			expect((await secondStored.json()).coverageSummary.total.lines.pct).toBe(
				87.5,
			);
		} finally {
			fs.rmSync(repoRoot, { recursive: true, force: true });
		}
	});

	it("uses all quality runs as the latest coverage and E2E display source", async () => {
		const repoRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "nightworkers-detail-quality-all-"),
		);
		try {
			writeCoverageSummary(repoRoot);
			writePlaywrightSummary(repoRoot);
			fs.writeFileSync(
				path.join(repoRoot, "package.json"),
				JSON.stringify({
					scripts: {
						test: "echo unit",
						"test:coverage": "echo coverage",
						"test:e2e": "echo e2e",
					},
				}),
				"utf8",
			);
			const project = await createRepository(repoRoot);

			const runRes = await app.request(
				`http://localhost/api/repositories/${project.id}/quality/runs`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ runType: "all" }),
				},
			);
			expect(runRes.status).toBe(201);
			const run = (await runRes.json()) as { id: string; runType: string };
			expect(run.runType).toBe("all");

			const qualityRes = await app.request(
				`http://localhost/api/repositories/${project.id}/quality`,
			);
			expect(qualityRes.status).toBe(200);
			const quality = await qualityRes.json();

			expect(quality.latestUnitRun).toBeNull();
			expect(quality.latestE2eRun).toBeNull();
			expect(quality.latestAllRun.id).toBe(run.id);
			expect(quality.latestCoverageRun.id).toBe(run.id);
			expect(quality.latestE2eResultRun.id).toBe(run.id);
			expect(
				quality.latestCoverageRun.coverageSummary["src/checkout.ts"].lines.pct,
			).toBe(72);
			expect(quality.latestE2eResultRun.e2eSummary.suites).toMatchObject([
				{ title: "checkout.spec.ts", tests: 1, status: "passed" },
			]);
			expect(
				quality.recentRuns.map((item: { id: string }) => item.id),
			).toContain(run.id);
		} finally {
			fs.rmSync(repoRoot, { recursive: true, force: true });
		}
	});

	it("keeps E2E runs visible when the structured artifact is missing", async () => {
		const repoRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "nightworkers-detail-e2e-missing-"),
		);
		try {
			fs.writeFileSync(
				path.join(repoRoot, "package.json"),
				JSON.stringify({
					scripts: { test: "echo unit", "test:e2e": "echo e2e" },
				}),
				"utf8",
			);
			const project = await createRepository(repoRoot);

			const runRes = await app.request(
				`http://localhost/api/repositories/${project.id}/quality/runs`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ runType: "e2e" }),
				},
			);
			expect(runRes.status).toBe(201);
			const run = await runRes.json();
			expect(run.errorMessage).toContain("E2E artifact not found");

			const qualityRes = await app.request(
				`http://localhost/api/repositories/${project.id}/quality`,
			);
			const quality = await qualityRes.json();
			expect(quality.latestE2eRun.id).toBe(run.id);
			expect(quality.latestE2eResultRun.id).toBe(run.id);
			expect(quality.latestE2eResultRun.e2eSummary).toMatchObject({
				status: "passed",
				total: 0,
				suites: [],
			});
		} finally {
			fs.rmSync(repoRoot, { recursive: true, force: true });
		}
	});

	it("requests Playwright JSON artifacts for E2E quality runs", async () => {
		const repoRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "nightworkers-detail-e2e-reporter-"),
		);
		try {
			fs.mkdirSync(path.join(repoRoot, "scripts"), { recursive: true });
			fs.writeFileSync(
				path.join(repoRoot, "scripts", "write-e2e-if-json-reporter.cjs"),
				[
					"const fs = require('node:fs');",
					"const path = require('node:path');",
					"const outputFile = process.env.PLAYWRIGHT_JSON_OUTPUT_FILE;",
					"const hasJsonReporter = process.argv.some((arg) => arg.includes('--reporter=') && arg.includes('json'));",
					"if (!outputFile || !hasJsonReporter) process.exit(0);",
					"fs.mkdirSync(path.dirname(outputFile), { recursive: true });",
					"fs.writeFileSync(",
					"  outputFile,",
					"  JSON.stringify({",
					"    suites: [",
					"      {",
					"        title: 'smoke.spec.ts',",
					"        specs: [",
					"          {",
					"            title: 'public screens render',",
					'            tests: [{ results: [{ status: "passed", duration: 120 }] }]',
					"          }",
					"        ]",
					"      }",
					"    ]",
					"  })",
					");",
				].join("\n"),
				"utf8",
			);
			fs.writeFileSync(
				path.join(repoRoot, "package.json"),
				JSON.stringify({
					scripts: {
						test: "echo unit",
						"test:e2e": "node scripts/write-e2e-if-json-reporter.cjs",
					},
				}),
				"utf8",
			);
			const project = await createRepository(repoRoot);

			const runRes = await app.request(
				`http://localhost/api/repositories/${project.id}/quality/runs`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ runType: "e2e" }),
				},
			);

			expect(runRes.status).toBe(201);
			const run = await runRes.json();
			expect(run.status).toBe("completed");
			expect(run.command).toContain("PLAYWRIGHT_JSON_OUTPUT_FILE");
			expect(run.command).toContain("--reporter=list,json");
			expect(run.errorMessage).toBeNull();
			expect(run.e2eSummary).toMatchObject({
				status: "passed",
				total: 1,
				passed: 1,
				failed: 0,
				suites: [{ title: "smoke.spec.ts", status: "passed", tests: 1 }],
			});
		} finally {
			fs.rmSync(repoRoot, { recursive: true, force: true });
		}
	});

	it("counts failed tests from E2E artifacts instead of failed suites only", async () => {
		const repoRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "nightworkers-detail-e2e-failed-"),
		);
		try {
			fs.mkdirSync(path.join(repoRoot, "playwright-report"), {
				recursive: true,
			});
			fs.writeFileSync(
				path.join(repoRoot, "playwright-report", "results.json"),
				JSON.stringify({
					suites: [
						{
							title: "checkout.spec.ts",
							specs: [
								{
									title: "loads checkout",
									tests: [
										{
											results: [
												{
													status: "failed",
													duration: 100,
													error: { message: "missing total" },
												},
											],
										},
									],
								},
								{
									title: "submits checkout",
									tests: [
										{
											results: [
												{
													status: "failed",
													duration: 200,
													error: { message: "button disabled" },
												},
											],
										},
									],
								},
								{
									title: "opens receipt",
									tests: [{ results: [{ status: "passed", duration: 50 }] }],
								},
								{
									title: "passes after retry",
									tests: [
										{
											results: [
												{
													status: "failed",
													duration: 30,
													error: { message: "first attempt" },
												},
												{ status: "passed", duration: 40 },
											],
										},
									],
								},
							],
						},
					],
				}),
				"utf8",
			);
			fs.writeFileSync(
				path.join(repoRoot, "package.json"),
				JSON.stringify({
					scripts: { test: "echo unit", "test:e2e": "echo e2e" },
				}),
				"utf8",
			);
			const project = await createRepository(repoRoot);

			const runRes = await app.request(
				`http://localhost/api/repositories/${project.id}/quality/runs`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ runType: "e2e" }),
				},
			);
			expect(runRes.status).toBe(201);
			const run = await runRes.json();
			expect(run.e2eSummary).toMatchObject({
				status: "failed",
				total: 4,
				passed: 2,
				failed: 2,
			});
			expect(run.e2eSummary.suites).toMatchObject([
				{
					title: "checkout.spec.ts",
					status: "failed",
					tests: 4,
					lastFailure: "button disabled",
				},
			]);
		} finally {
			fs.rmSync(repoRoot, { recursive: true, force: true });
		}
	});

	it("does not expose quality run detail through another repository route", async () => {
		const firstRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "nightworkers-detail-run-a-"),
		);
		const secondRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "nightworkers-detail-run-b-"),
		);
		try {
			for (const repoRoot of [firstRoot, secondRoot]) {
				fs.writeFileSync(
					path.join(repoRoot, "package.json"),
					JSON.stringify({ scripts: { test: "echo unit" } }),
					"utf8",
				);
			}
			const firstProject = await createRepository(firstRoot);
			const secondProject = await createRepository(secondRoot);

			const runRes = await app.request(
				`http://localhost/api/repositories/${firstProject.id}/quality/runs`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ runType: "unit" }),
				},
			);
			expect(runRes.status).toBe(201);
			const run = await runRes.json();

			const mismatchRes = await app.request(
				`http://localhost/api/repositories/${secondProject.id}/quality/runs/${run.id}`,
			);
			expect(mismatchRes.status).toBe(404);
		} finally {
			fs.rmSync(firstRoot, { recursive: true, force: true });
			fs.rmSync(secondRoot, { recursive: true, force: true });
		}
	});
});
