import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	type CoverageMetric,
	criticalBranchAreas,
} from "../scripts/coverage/coverage-policy";

const scriptsRoot = path.join(process.cwd(), "scripts", "coverage");
let temporaryRoot: string | null = null;

afterEach(() => {
	if (!temporaryRoot) return;
	fs.rmSync(temporaryRoot, { recursive: true, force: true });
	temporaryRoot = null;
});

const metric = (pct: number): CoverageMetric => ({
	total: 100,
	covered: pct,
	skipped: 0,
	pct,
});

const totals = () => ({
	statements: metric(100),
	branches: metric(100),
	functions: metric(100),
	lines: metric(100),
});

function writeJson(relativePath: string, value: unknown) {
	if (!temporaryRoot) throw new Error("temporary coverage root is unavailable");
	const filePath = path.join(temporaryRoot, relativePath);
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function runCoverageScript(script: string) {
	if (!temporaryRoot) throw new Error("temporary coverage root is unavailable");
	return execFileSync("bun", [path.join(scriptsRoot, script)], {
		cwd: temporaryRoot,
		encoding: "utf8",
	});
}

describe("coverage report scripts", () => {
	it("combines split reports and writes passing global and critical evidence", () => {
		temporaryRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "nightworkers-coverage-"),
		);
		const backend = {
			total: totals(),
			...Object.fromEntries(
				Object.values(criticalBranchAreas).map(({ file }) => [
					path.join(process.cwd(), file),
					{ branches: metric(100) },
				]),
			),
		};
		writeJson("coverage/backend/coverage-summary.json", backend);
		writeJson("coverage/frontend/coverage-summary.json", { total: totals() });

		runCoverageScript("combine-summary.ts");
		runCoverageScript("check-global-coverage.ts");
		runCoverageScript("check-critical-branches.ts");

		const combined = JSON.parse(
			fs.readFileSync(
				path.join(temporaryRoot, "coverage", "coverage-summary.json"),
				"utf8",
			),
		) as {
			schemaVersion: number;
			generatedAt: string;
			total: { branches: CoverageMetric };
		};
		const globalReport = JSON.parse(
			fs.readFileSync(
				path.join(temporaryRoot, "coverage", "global-thresholds.json"),
				"utf8",
			),
		) as { passed: boolean };
		const criticalReport = JSON.parse(
			fs.readFileSync(
				path.join(temporaryRoot, "coverage", "critical-branches.json"),
				"utf8",
			),
		) as { passed: boolean; results: unknown[] };

		expect(combined.schemaVersion).toBe(1);
		expect(combined.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		expect(combined.total.branches.pct).toBe(100);
		expect(globalReport.passed).toBe(true);
		expect(criticalReport.passed).toBe(true);
		expect(criticalReport.results).toHaveLength(
			Object.keys(criticalBranchAreas).length,
		);
	});
});
