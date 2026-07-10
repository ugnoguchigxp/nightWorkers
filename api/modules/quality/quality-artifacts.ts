import fs from "node:fs";
import path from "node:path";
import {
	type E2ESummary,
	e2eSummarySchema,
	type ProjectQualityCapabilities,
} from "../../../shared/schemas/quality.schema";
import { ValidationError } from "../../lib/errors";
import {
	evaluateCoverageGate,
	readCoverageSummaryFile,
} from "../../services/quality/coverage-gate";
import { readTestQualitySettingsFile } from "../../services/settings/test-quality-settings";

const COVERAGE_SUMMARY_REPORTER_ARGS =
	"--coverage.reporter=json-summary --coverage.reporter=text";
const E2E_JSON_OUTPUT_PATH = path.join("test-results", "e2e-results.json");
const PLAYWRIGHT_JSON_REPORTER_ARGS = "--reporter=list,json";
const E2E_ARTIFACT_PATHS = [
	E2E_JSON_OUTPUT_PATH,
	path.join("playwright-report", "results.json"),
	path.join("playwright-report", "test-results.json"),
];

type PlaywrightSuiteSummary = E2ESummary["suites"][number] & {
	failedTests: number;
};

export function coverageCommandWithSummaryReporter(
	capabilities: ProjectQualityCapabilities,
) {
	const command = capabilities.coverage.command;
	if (!command) return undefined;
	if (command.includes("--coverage.reporter=json-summary")) return command;
	if (/\bbun\s+run\b/.test(command))
		return `${command} -- ${COVERAGE_SUMMARY_REPORTER_ARGS}`;
	return `${command} ${COVERAGE_SUMMARY_REPORTER_ARGS}`;
}

export function e2eCommandWithJsonReporter(command: string) {
	const commandWithReporter =
		command.includes("--reporter") && command.includes("json")
			? command
			: appendCommandArgs(command, PLAYWRIGHT_JSON_REPORTER_ARGS);
	if (commandWithReporter.includes("PLAYWRIGHT_JSON_OUTPUT_FILE="))
		return commandWithReporter;
	return `PLAYWRIGHT_JSON_OUTPUT_FILE=${shellQuote(E2E_JSON_OUTPUT_PATH)} ${commandWithReporter}`;
}

function appendCommandArgs(command: string, args: string) {
	if (/\bbun\s+run\b/.test(command)) return `${command} -- ${args}`;
	return `${command} ${args}`;
}

function shellQuote(value: string) {
	return `'${value.replace(/'/g, "'\\''")}'`;
}

export function readCoverageArtifacts(repositoryRoot: string) {
	const summaryPath = path.join(
		repositoryRoot,
		"coverage",
		"coverage-summary.json",
	);
	if (!fs.existsSync(summaryPath))
		return {
			coverageSummary: null,
			coverageGate: null,
			error: "coverage-summary.json not found",
		};
	try {
		const coverageSummary = readCoverageSummaryFile(summaryPath);
		const coverageGate = evaluateCoverageGate(
			readTestQualitySettingsFile(repositoryRoot),
			coverageSummary,
			{ summaryPath },
		);
		return { coverageSummary, coverageGate, error: null };
	} catch (error) {
		return {
			coverageSummary: null,
			coverageGate: null,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

function minimalE2eSummary(exitCode: number | null) {
	return e2eSummarySchema.parse({
		status:
			exitCode === 0 ? "passed" : exitCode === null ? "unknown" : "failed",
		total: 0,
		passed: 0,
		failed: exitCode === 0 ? 0 : 1,
		skipped: 0,
		durationMs: null,
		suites: [],
	});
}

export function readE2eArtifacts(
	repositoryRoot: string,
	exitCode: number | null,
) {
	const fallback = minimalE2eSummary(exitCode);
	const artifactPath = E2E_ARTIFACT_PATHS.map((candidate) =>
		path.join(repositoryRoot, candidate),
	).find((candidate) => fs.existsSync(candidate));
	if (!artifactPath) {
		return {
			e2eSummary: fallback,
			error: `E2E artifact not found (${E2E_ARTIFACT_PATHS.join(", ")})`,
		};
	}
	try {
		const parsed = JSON.parse(fs.readFileSync(artifactPath, "utf8")) as unknown;
		return {
			e2eSummary: parsePlaywrightJsonSummary(parsed, exitCode),
			error: null,
		};
	} catch (error) {
		return {
			e2eSummary: fallback,
			error: `Failed to read E2E artifact: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

function parsePlaywrightJsonSummary(
	input: unknown,
	exitCode: number | null,
): E2ESummary {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		throw new ValidationError("E2E artifact must be a JSON object");
	}
	const suites = collectPlaywrightSuites(input as Record<string, unknown>, []);
	const totals = suites.reduce(
		(acc, suite) => ({
			total: acc.total + suite.tests,
			failed: acc.failed + suite.failedTests,
			durationMs: acc.durationMs + (suite.durationMs ?? 0),
		}),
		{ total: 0, failed: 0, durationMs: 0 },
	);
	const failedCount = Math.min(totals.total, totals.failed);
	return e2eSummarySchema.parse({
		status:
			failedCount > 0
				? "failed"
				: exitCode === null
					? "unknown"
					: exitCode === 0
						? "passed"
						: "failed",
		total: totals.total,
		passed: Math.max(0, totals.total - failedCount),
		failed: failedCount,
		skipped: 0,
		durationMs: totals.durationMs > 0 ? totals.durationMs : null,
		suites: suites.map(({ failedTests: _failedTests, ...suite }) => suite),
	});
}

function collectPlaywrightSuites(
	node: Record<string, unknown>,
	pathParts: string[],
): PlaywrightSuiteSummary[] {
	const title =
		typeof node.title === "string" && node.title.trim()
			? node.title.trim()
			: null;
	const nextPath = title ? [...pathParts, title] : pathParts;
	const directSpecs = Array.isArray(node.specs) ? node.specs : [];
	const rows =
		directSpecs.length > 0
			? [summarizePlaywrightSuite(nextPath, directSpecs)]
			: [];
	const children = Array.isArray(node.suites) ? node.suites : [];
	for (const child of children) {
		if (child && typeof child === "object" && !Array.isArray(child)) {
			rows.push(
				...collectPlaywrightSuites(child as Record<string, unknown>, nextPath),
			);
		}
	}
	return rows.filter((suite) => suite.tests > 0);
}

function summarizePlaywrightSuite(
	pathParts: string[],
	specs: unknown[],
): PlaywrightSuiteSummary {
	let tests = 0;
	let failedTests = 0;
	let durationMs = 0;
	let lastFailure: string | null = null;
	for (const spec of specs) {
		if (!spec || typeof spec !== "object" || Array.isArray(spec)) continue;
		const specRecord = spec as Record<string, unknown>;
		const specTitle =
			typeof specRecord.title === "string" ? specRecord.title : "test";
		const testEntries = Array.isArray(specRecord.tests) ? specRecord.tests : [];
		for (const testEntry of testEntries) {
			if (
				!testEntry ||
				typeof testEntry !== "object" ||
				Array.isArray(testEntry)
			)
				continue;
			tests += 1;
			const testRecord = testEntry as Record<string, unknown>;
			const results = Array.isArray(testRecord.results)
				? testRecord.results
				: [];
			const resultRecords = results.filter(
				(result): result is Record<string, unknown> =>
					Boolean(result) &&
					typeof result === "object" &&
					!Array.isArray(result),
			);
			const finalResult = resultRecords[resultRecords.length - 1];
			if (
				finalResult?.status === "failed" ||
				finalResult?.status === "timedOut"
			) {
				failedTests += 1;
				lastFailure =
					firstString(finalResult.error) ??
					firstString(finalResult.errors) ??
					firstString(finalResult.errorMessage) ??
					specTitle;
			}
			durationMs += resultRecords.reduce(
				(sum, result) =>
					sum + (typeof result.duration === "number" ? result.duration : 0),
				0,
			);
		}
	}
	return {
		title: pathParts.length > 0 ? pathParts.join(" / ") : "E2E",
		status: failedTests > 0 ? "failed" : "passed",
		tests,
		durationMs: durationMs > 0 ? durationMs : null,
		lastFailure,
		failedTests,
	};
}

function firstString(value: unknown): string | null {
	if (typeof value === "string" && value.trim()) return value.trim();
	if (Array.isArray(value)) {
		for (const item of value) {
			const found = firstString(item);
			if (found) return found;
		}
	}
	if (value && typeof value === "object") {
		for (const key of ["message", "value", "name"] as const) {
			const found = firstString((value as Record<string, unknown>)[key]);
			if (found) return found;
		}
	}
	return null;
}
