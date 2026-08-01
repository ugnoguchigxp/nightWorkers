import fs from "node:fs";
import path from "node:path";
import {
	coverageExclusionReasons,
	coverageReportPaths,
} from "../../vitest.coverage";
import {
	COVERAGE_METRICS,
	type CoverageMetric,
	type CoverageMetricName,
} from "./coverage-policy";

type Summary = Record<
	string,
	Record<CoverageMetricName, CoverageMetric> & Record<string, CoverageMetric>
>;

const root = process.cwd();
const inputs = {
	backend: readSummary(`${coverageReportPaths.backend}/coverage-summary.json`),
	frontend: readSummary(
		`${coverageReportPaths.frontend}/coverage-summary.json`,
	),
};
const total = Object.fromEntries(
	COVERAGE_METRICS.map((metric) => {
		const backend = inputs.backend.total[metric];
		const frontend = inputs.frontend.total[metric];
		const combined = {
			total: backend.total + frontend.total,
			covered: backend.covered + frontend.covered,
			skipped: backend.skipped + frontend.skipped,
			pct: 100,
		};
		combined.pct = combined.total
			? Math.round((combined.covered / combined.total) * 10_000) / 100
			: 100;
		return [metric, combined];
	}),
);
const output = {
	schemaVersion: 1,
	generatedAt: new Date().toISOString(),
	total,
	segments: {
		backend: inputs.backend.total,
		frontend: inputs.frontend.total,
	},
	scope: {
		backendFiles: Object.keys(inputs.backend).filter((key) => key !== "total")
			.length,
		frontendFiles: Object.keys(inputs.frontend).filter((key) => key !== "total")
			.length,
		backendLines: inputs.backend.total.lines.total,
		frontendLines: inputs.frontend.total.lines.total,
		exclusionReasons: coverageExclusionReasons,
	},
};
fs.mkdirSync(path.join(root, coverageReportPaths.root), { recursive: true });
fs.writeFileSync(
	path.join(root, coverageReportPaths.root, "coverage-summary.json"),
	`${JSON.stringify(output, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);

function readSummary(relativePath: string): Summary {
	return JSON.parse(
		fs.readFileSync(path.join(root, relativePath), "utf8"),
	) as Summary;
}
