import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	type CoverageMetric,
	criticalBranchAreas,
	evaluateCriticalBranchCoverage,
	evaluateGlobalCoverage,
	globalCoverageThresholds,
} from "../scripts/coverage/coverage-policy";
import {
	backendCoverage,
	coverageReportPaths,
	frontendCoverage,
} from "../vitest.coverage";

const metric = (pct: number, total = 100): CoverageMetric => ({
	total,
	covered: Math.round((pct / 100) * total),
	skipped: 0,
	pct,
});

const passingGlobalSummary = () => ({
	total: Object.fromEntries(
		Object.keys(globalCoverageThresholds).map((name) => [name, metric(100)]),
	),
});

const passingBackendSummary = () =>
	Object.fromEntries(
		Object.values(criticalBranchAreas).map(({ file }) => [
			`/workspace/nightWorkers/${file}`,
			{ branches: metric(100) },
		]),
	);

describe("release coverage policy", () => {
	it("keeps generated reports under one root and execution scripts in source", () => {
		const ignoreRules = fs
			.readFileSync(path.join(process.cwd(), ".gitignore"), "utf8")
			.split(/\r?\n/);
		expect(ignoreRules).toContain("/coverage/");
		expect(ignoreRules).not.toContain("coverage/");
		expect(coverageReportPaths).toEqual({
			root: "coverage",
			backend: "coverage/backend",
			frontend: "coverage/frontend",
		});
		expect(backendCoverage.reportsDirectory).toBe("./coverage/backend");
		expect(frontendCoverage.reportsDirectory).toBe("./coverage/frontend");
		for (const file of [
			"scripts/coverage/combine-summary.ts",
			"scripts/coverage/check-global-coverage.ts",
			"scripts/coverage/check-critical-branches.ts",
		]) {
			expect(fs.existsSync(path.join(process.cwd(), file)), file).toBe(true);
		}
	});

	it("keeps every critical area bound to a current production file", () => {
		for (const { file } of Object.values(criticalBranchAreas)) {
			expect(fs.existsSync(path.join(process.cwd(), file)), file).toBe(true);
		}
	});

	it("passes the documented global thresholds", () => {
		const report = evaluateGlobalCoverage(passingGlobalSummary());

		expect(report.passed).toBe(true);
		expect(report.thresholds).toEqual({
			statements: 80,
			branches: 75,
			functions: 80,
			lines: 80,
		});
		expect(report.failures).toEqual([]);
	});

	it("reports every global metric below its threshold", () => {
		const summary = passingGlobalSummary();
		summary.total.statements = metric(79.99);
		summary.total.branches = metric(74.99);

		const report = evaluateGlobalCoverage(summary);

		expect(report.passed).toBe(false);
		expect(report.failures).toEqual([
			"statements=79.99% < 80%",
			"branches=74.99% < 75%",
		]);
	});

	it("aggregates missing, unmeasured, and below-threshold critical branches", () => {
		const summary = passingBackendSummary();
		const queue = criticalBranchAreas.queue.file;
		const queueKey = Object.keys(summary).find((file) => file.endsWith(queue));
		expect(queueKey).toBeDefined();
		if (!queueKey) return;
		const queueValue = summary[queueKey];
		delete summary[queueKey];
		summary[`C:\\workspace\\nightWorkers\\${queue.replaceAll("/", "\\")}`] =
			queueValue;

		const reviewKey = Object.keys(summary).find((file) =>
			file.endsWith(criticalBranchAreas.review.file),
		);
		const secretKey = Object.keys(summary).find((file) =>
			file.endsWith(criticalBranchAreas.secretPersistence.file),
		);
		const desktopKey = Object.keys(summary).find((file) =>
			file.endsWith(criticalBranchAreas.desktopBootstrap.file),
		);
		expect(reviewKey).toBeDefined();
		expect(secretKey).toBeDefined();
		expect(desktopKey).toBeDefined();
		if (!reviewKey || !secretKey || !desktopKey) return;
		summary[reviewKey] = { branches: metric(79) };
		delete summary[secretKey];
		summary[desktopKey] = { branches: metric(100, 0) };

		const report = evaluateCriticalBranchCoverage(summary);

		expect(report.passed).toBe(false);
		expect(
			report.results.find((result) => result.area === "queue")?.status,
		).toBe("passed");
		expect(report.failures).toEqual([
			"review=79% < 80%",
			`secretPersistence: file missing (${criticalBranchAreas.secretPersistence.file})`,
			`desktopBootstrap: branches unmeasured (${criticalBranchAreas.desktopBootstrap.file})`,
		]);
	});

	it("rejects malformed global summaries", () => {
		expect(() => evaluateGlobalCoverage({ total: { statements: {} } })).toThrow(
			"total.statements must be a coverage metric",
		);
	});
});
