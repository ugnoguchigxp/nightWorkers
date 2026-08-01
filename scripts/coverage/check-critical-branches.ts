import fs from "node:fs";
import path from "node:path";
import { coverageReportPaths } from "../../vitest.coverage";
import { evaluateCriticalBranchCoverage } from "./coverage-policy";

const summaryPath = path.join(
	process.cwd(),
	coverageReportPaths.backend,
	"coverage-summary.json",
);
const reportPath = path.join(
	process.cwd(),
	coverageReportPaths.root,
	"critical-branches.json",
);
const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8")) as unknown;
const report = evaluateCriticalBranchCoverage(summary);
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

if (!report.passed) {
	throw new Error(
		`Critical branch coverage failed: ${report.failures.join(", ")}`,
	);
}
