import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { evaluateE2eScenarioCoverage } from "./e2e-scenario-coverage.mjs";

const root = process.cwd();
const resultsDirectory = path.join(root, "test-results");
const playwrightReportPath = path.join(resultsDirectory, "e2e-results.json");
const coverageReportPath = path.join(resultsDirectory, "e2e-coverage.json");
const catalogPath = path.join(root, "tests/e2e/scenario-catalog.json");
const isolatedRunnerPath = path.join(root, "scripts/run-playwright.mjs");

await fs.mkdir(resultsDirectory, { recursive: true });
await Promise.all([
	fs.rm(playwrightReportPath, { force: true }),
	fs.rm(coverageReportPath, { force: true }),
]);

const child = spawn(
	process.execPath,
	[
		isolatedRunnerPath,
		"test",
		"--grep-invert",
		"@agent-live",
		"--reporter=list,json,html",
	],
	{
		cwd: root,
		env: {
			...process.env,
			PLAYWRIGHT_JSON_OUTPUT_FILE: playwrightReportPath,
			PLAYWRIGHT_HTML_OPEN: "never",
		},
		stdio: "inherit",
	},
);

const playwrightExitCode = await new Promise((resolve) => {
	child.once("error", (error) => {
		console.error(error);
		resolve(1);
	});
	child.once("close", (code) => resolve(code ?? 1));
});

const catalog = JSON.parse(await fs.readFile(catalogPath, "utf8"));
let report = null;
try {
	report = JSON.parse(await fs.readFile(playwrightReportPath, "utf8"));
} catch (error) {
	console.error(`[e2e-coverage] unable to read Playwright JSON: ${error.message}`);
}

const coverage = evaluateE2eScenarioCoverage({
	catalog,
	report,
	playwrightExitCode,
});
await fs.writeFile(
	coverageReportPath,
	`${JSON.stringify(coverage, null, 2)}\n`,
	"utf8",
);

console.log("");
console.log("[e2e-coverage] summary");
console.log(`status: ${coverage.passed ? "PASS" : "FAIL"}`);
console.log(
	`required: ${coverage.summary.automatedScenarios}/${coverage.summary.requiredScenarios}`,
);
console.log(`P0 coverage: ${coverage.summary.p0Coverage}%`);
console.log(`weighted coverage: ${coverage.summary.weightedCoverage}%`);
console.log(`executed pass rate: ${coverage.summary.executedPassRate}%`);
console.log(`P0 flakes: ${coverage.summary.p0Flakes}`);
console.log(`planned scenarios: ${coverage.summary.plannedScenarios}`);
console.log(`artifact: ${coverageReportPath}`);
for (const issue of coverage.issues) {
	console.error(`[e2e-coverage] ${issue.code}: ${issue.message}`);
}

process.exitCode = coverage.passed ? 0 : 1;
