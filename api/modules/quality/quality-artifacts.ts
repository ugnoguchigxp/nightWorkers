import fs from "node:fs";
import path from "node:path";
import {
	type E2ESummary,
	e2eSummarySchema,
	type ProjectQualityCapabilities,
} from "../../../shared/schemas/quality.schema";
import { ValidationError } from "../../lib/errors";

const COVERAGE_REPORTERS = ["json-summary", "text", "html"] as const;
const COVERAGE_SUMMARY_FILE = path.join("coverage", "coverage-summary.json");
const COVERAGE_FINAL_FILE = path.join("coverage", "coverage-final.json");
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
	const missingReporterArgs = COVERAGE_REPORTERS.filter(
		(reporter) =>
			!new RegExp(`--coverage\\.reporter(?:=|\\s+)${reporter}(?:\\s|$)`).test(
				command,
			),
	)
		.map((reporter) => `--coverage.reporter=${reporter}`)
		.join(" ");
	if (!missingReporterArgs) return command;
	if (/\bbun\s+run\b/.test(command) && !/\s--\s/.test(command))
		return `${command} -- ${missingReporterArgs}`;
	return `${command} ${missingReporterArgs}`;
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
	const summaryPath = path.join(repositoryRoot, COVERAGE_SUMMARY_FILE);
	if (fs.existsSync(summaryPath)) {
		try {
			const coverageSummary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
			return { coverageSummary, artifactPath: summaryPath, error: null };
		} catch (error) {
			return {
				coverageSummary: null,
				artifactPath: null,
				error: `Failed to read coverage-summary.json: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
	}

	const finalPath = path.join(repositoryRoot, COVERAGE_FINAL_FILE);
	if (!fs.existsSync(finalPath))
		return {
			coverageSummary: null,
			artifactPath: null,
			error: "coverage-summary.json not found",
		};
	try {
		const coverageSummary = summarizeIstanbulCoverage(
			JSON.parse(fs.readFileSync(finalPath, "utf8")),
		);
		return { coverageSummary, artifactPath: finalPath, error: null };
	} catch (error) {
		return {
			coverageSummary: null,
			artifactPath: null,
			error: `Failed to read coverage-final.json: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

type IstanbulLocation = {
	start?: { line?: unknown };
};

type IstanbulFileCoverage = {
	statementMap: Record<string, IstanbulLocation>;
	s: Record<string, unknown>;
	f: Record<string, unknown>;
	b: Record<string, unknown>;
};

type CoverageMetric = {
	total: number;
	covered: number;
	skipped: number;
	pct: number;
};

function summarizeIstanbulCoverage(input: unknown) {
	if (!input || typeof input !== "object" || Array.isArray(input))
		throw new ValidationError("coverage-final.json must be a JSON object");

	const fileSummaries = Object.fromEntries(
		Object.entries(input as Record<string, unknown>).map(([file, value]) => {
			const coverage = parseIstanbulFileCoverage(file, value);
			const lineCounts = new Map<number, number>();
			for (const [statementId, location] of Object.entries(
				coverage.statementMap,
			)) {
				const line = location.start?.line;
				if (typeof line !== "number" || !Number.isInteger(line) || line < 1)
					continue;
				const count = coverageCount(coverage.s[statementId]);
				lineCounts.set(line, Math.max(lineCounts.get(line) ?? 0, count));
			}
			const uncoveredLines = [...lineCounts.entries()]
				.filter(([, count]) => count === 0)
				.map(([line]) => line)
				.sort((left, right) => left - right);
			return [
				file,
				{
					lines: metricFromCounts([...lineCounts.values()]),
					statements: metricFromCounts(Object.values(coverage.s)),
					functions: metricFromCounts(Object.values(coverage.f)),
					branches: metricFromCounts(
						Object.values(coverage.b).flatMap((counts) =>
							Array.isArray(counts) ? counts : [counts],
						),
					),
					uncoveredLines,
				},
			];
		}),
	);
	const files = Object.values(fileSummaries);
	return {
		total: {
			lines: combineCoverageMetrics(files.map((file) => file.lines)),
			statements: combineCoverageMetrics(files.map((file) => file.statements)),
			functions: combineCoverageMetrics(files.map((file) => file.functions)),
			branches: combineCoverageMetrics(files.map((file) => file.branches)),
		},
		...fileSummaries,
	};
}

function parseIstanbulFileCoverage(
	file: string,
	input: unknown,
): IstanbulFileCoverage {
	if (!input || typeof input !== "object" || Array.isArray(input))
		throw new ValidationError(`Invalid Istanbul coverage entry: ${file}`);
	const record = input as Record<string, unknown>;
	return {
		statementMap: coverageRecord(record.statementMap, file, "statementMap"),
		s: coverageRecord(record.s, file, "s"),
		f: coverageRecord(record.f, file, "f"),
		b: coverageRecord(record.b, file, "b"),
	};
}

function coverageRecord(
	input: unknown,
	file: string,
	field: string,
): Record<string, never> {
	if (!input || typeof input !== "object" || Array.isArray(input))
		throw new ValidationError(
			`Invalid Istanbul coverage ${field} entry: ${file}`,
		);
	return input as Record<string, never>;
}

function coverageCount(input: unknown) {
	return typeof input === "number" && Number.isFinite(input) && input > 0
		? input
		: 0;
}

function metricFromCounts(counts: unknown[]): CoverageMetric {
	const normalized = counts.map(coverageCount);
	const total = normalized.length;
	const covered = normalized.filter((count) => count > 0).length;
	return {
		total,
		covered,
		skipped: 0,
		pct: coveragePercent(covered, total),
	};
}

function combineCoverageMetrics(metrics: CoverageMetric[]): CoverageMetric {
	const total = metrics.reduce((sum, metric) => sum + metric.total, 0);
	const covered = metrics.reduce((sum, metric) => sum + metric.covered, 0);
	return {
		total,
		covered,
		skipped: metrics.reduce((sum, metric) => sum + metric.skipped, 0),
		pct: coveragePercent(covered, total),
	};
}

function coveragePercent(covered: number, total: number) {
	if (total === 0) return 100;
	return Math.floor((covered / total) * 10_000) / 100;
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
