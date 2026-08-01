import fs from "node:fs";
import path from "node:path";
import { coverageReportPaths } from "../../vitest.coverage";
import { evaluateGlobalCoverage } from "./coverage-policy";

const summaryPath = path.join(
	process.cwd(),
	coverageReportPaths.root,
	"coverage-summary.json",
);
const reportPath = path.join(
	process.cwd(),
	coverageReportPaths.root,
	"global-thresholds.json",
);
const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8")) as unknown;
const report = evaluateGlobalCoverage(summary);
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

if (!report.passed) {
	throw new Error(
		`Global coverage below threshold: ${report.failures.join(", ")}`,
	);
}
