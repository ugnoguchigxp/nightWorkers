import path from "node:path";
import {
	DEFAULT_TEST_QUALITY_SETTINGS,
	readTestQualitySettingsFile,
	type TestQualitySettings,
} from "../settings/test-quality-settings";
import { gitDiffTool } from "../worker-tools/git";
import { runVerificationTool } from "../worker-tools/run-verification";
import type { WorkerToolResult } from "../worker-tools/types";
import {
	type CoverageGateResult,
	evaluateCoverageSummaryFile,
} from "./coverage-gate";
import { inspectProjectQualityPrerequisites } from "./project-quality-prerequisites";
import {
	evaluateSourceDiffGuard,
	type SourceDiffGuardResult,
} from "./source-diff-guard";

export type CoverageAutonomyBudget = {
	warningTotalTokens: number;
	stopTotalTokens: number;
	warningEstimatedCostUsd: number;
	stopEstimatedCostUsd: number;
	warningWallClockMinutes: number;
	stopWallClockMinutes: number;
};

export const DEFAULT_COVERAGE_AUTONOMY_BUDGET: CoverageAutonomyBudget = {
	warningTotalTokens: 50_000,
	stopTotalTokens: 200_000,
	warningEstimatedCostUsd: 0.5,
	stopEstimatedCostUsd: 2.0,
	warningWallClockMinutes: 20,
	stopWallClockMinutes: 45,
};

export type CoverageAutonomyState = {
	attempts: number;
	startedAt: string;
	previousResults: CoverageGateResult[];
};

export type CoverageAutonomyGateStatus =
	| "disabled"
	| "passed"
	| "continue"
	| "needs_human";

export type CoverageAutonomyGateResult = {
	version: 1;
	status: CoverageAutonomyGateStatus;
	settings: TestQualitySettings;
	command: string | null;
	attempt: number;
	maxIterations: number;
	shouldContinue: boolean;
	allowFinalize: boolean;
	message: string;
	configError?: string;
	coverage?: CoverageGateResult;
	prerequisites?: ReturnType<typeof inspectProjectQualityPrerequisites>;
	sourceGuard?: SourceDiffGuardResult;
	commandResult?: {
		ok: boolean;
		exitCode: number;
		stdoutPreview: string;
		stderrPreview: string;
		logArtifactPath?: string;
	};
	budget: {
		warning: boolean;
		stop: boolean;
		wallClockMinutes: number;
		tokenUsageAvailable: boolean;
		costAvailable: boolean;
		reasons: string[];
	};
};

const coverageCommand =
	"bun run test:coverage -- --coverage.reporter=json-summary --coverage.reporter=text";
const summaryPath = path.join("coverage", "coverage-summary.json");

export async function evaluateCoverageAutonomyGate(input: {
	repoRoot: string;
	state?: CoverageAutonomyState | null;
	safetyPolicy?: {
		blockedCommands?: string[];
		allowedPaths?: string[];
		externalAllowedPaths?: string[];
		deniedPaths?: string[];
		maxCommandSeconds?: number;
	};
	now?: Date;
}): Promise<{
	result: CoverageAutonomyGateResult;
	nextState: CoverageAutonomyState;
}> {
	const now = input.now ?? new Date();
	const state = input.state ?? {
		attempts: 0,
		startedAt: now.toISOString(),
		previousResults: [],
	};
	const attempt = state.attempts + 1;
	const nextBaseState: CoverageAutonomyState = {
		...state,
		attempts: attempt,
	};
	const settings = safeReadSettings(input.repoRoot);
	if (!settings.ok) {
		return {
			result: {
				version: 1,
				status: "needs_human",
				settings: {
					...DEFAULT_TEST_QUALITY_SETTINGS,
					coverageGateEnabled: true,
				},
				command: null,
				attempt,
				maxIterations: DEFAULT_TEST_QUALITY_SETTINGS.coverageMaxIterations,
				shouldContinue: false,
				allowFinalize: true,
				message: "Coverage gate configuration could not be read safely.",
				configError: settings.error,
				budget: buildBudgetResult(state.startedAt, now, false),
			},
			nextState: nextBaseState,
		};
	}
	const testSettings = settings.value;

	if (!testSettings.coverageGateEnabled) {
		return {
			result: {
				version: 1,
				status: "disabled",
				settings: testSettings,
				command: null,
				attempt,
				maxIterations: testSettings.coverageMaxIterations,
				shouldContinue: false,
				allowFinalize: true,
				message: "Coverage gate is disabled for this Project.",
				budget: buildBudgetResult(state.startedAt, now, false),
			},
			nextState: nextBaseState,
		};
	}

	const prerequisites = inspectProjectQualityPrerequisites(input.repoRoot);
	if (!prerequisites.ready) {
		return {
			result: {
				version: 1,
				status: "needs_human",
				settings: testSettings,
				command: coverageCommand,
				attempt,
				maxIterations: testSettings.coverageMaxIterations,
				shouldContinue: false,
				allowFinalize: true,
				message:
					"Coverage gate cannot run because package.json must define both verify and test:coverage scripts.",
				prerequisites,
				budget: buildBudgetResult(state.startedAt, now, false),
			},
			nextState: nextBaseState,
		};
	}

	const sourceGuard = await readSourceGuard(input.repoRoot);
	if (!sourceGuard.passed) {
		return {
			result: {
				version: 1,
				status: "needs_human",
				settings: testSettings,
				command: coverageCommand,
				attempt,
				maxIterations: testSettings.coverageMaxIterations,
				shouldContinue: false,
				allowFinalize: true,
				message:
					"Coverage gate blocked finalize because production source diff contains test-only or coverage-ignore patterns.",
				prerequisites,
				sourceGuard,
				budget: buildBudgetResult(state.startedAt, now, false),
			},
			nextState: nextBaseState,
		};
	}

	const command = await runCoverage(input.repoRoot, input.safetyPolicy);
	const commandResult = summarizeCommandResult(command);
	if (!command.ok || command.payload.exitCode !== 0) {
		const budget = buildBudgetResult(
			state.startedAt,
			now,
			attempt >= testSettings.coverageMaxIterations,
		);
		return {
			result: {
				version: 1,
				status: budget.stop ? "needs_human" : "continue",
				settings: testSettings,
				command: coverageCommand,
				attempt,
				maxIterations: testSettings.coverageMaxIterations,
				shouldContinue: !budget.stop,
				allowFinalize: budget.stop,
				message: budget.stop
					? "Coverage command failed and the coverage autonomy stop threshold was reached."
					: "Coverage command failed. Fix the failing tests before finalizing.",
				prerequisites,
				sourceGuard,
				commandResult,
				budget,
			},
			nextState: nextBaseState,
		};
	}

	let coverage: CoverageGateResult;
	try {
		coverage = evaluateCoverageSummaryFile(
			testSettings,
			path.join(input.repoRoot, summaryPath),
		);
	} catch (err) {
		const budget = buildBudgetResult(
			state.startedAt,
			now,
			attempt >= testSettings.coverageMaxIterations,
		);
		return {
			result: {
				version: 1,
				status: budget.stop ? "needs_human" : "continue",
				settings: testSettings,
				command: coverageCommand,
				attempt,
				maxIterations: testSettings.coverageMaxIterations,
				shouldContinue: !budget.stop,
				allowFinalize: budget.stop,
				message:
					err instanceof Error
						? `Coverage summary could not be evaluated: ${err.message}`
						: "Coverage summary could not be evaluated.",
				prerequisites,
				sourceGuard,
				commandResult,
				budget,
			},
			nextState: nextBaseState,
		};
	}

	const previousResults = [...state.previousResults, coverage].slice(-3);
	const nextState = { ...nextBaseState, previousResults };
	if (coverage.passed) {
		return {
			result: {
				version: 1,
				status: "passed",
				settings: testSettings,
				command: coverageCommand,
				attempt,
				maxIterations: testSettings.coverageMaxIterations,
				shouldContinue: false,
				allowFinalize: true,
				message: "Coverage gate passed.",
				coverage,
				prerequisites,
				sourceGuard,
				commandResult,
				budget: buildBudgetResult(state.startedAt, now, false),
			},
			nextState,
		};
	}

	const stagnated = isStagnated(previousResults);
	const budget = buildBudgetResult(
		state.startedAt,
		now,
		attempt >= testSettings.coverageMaxIterations,
	);
	const failedMetrics = coverage.failedMetrics.join(", ");
	return {
		result: {
			version: 1,
			status: budget.stop ? "needs_human" : "continue",
			settings: testSettings,
			command: coverageCommand,
			attempt,
			maxIterations: testSettings.coverageMaxIterations,
			shouldContinue: !budget.stop,
			allowFinalize: budget.stop,
			message: budget.stop
				? `Coverage gate is still below target for ${failedMetrics}; stop threshold reached.`
				: stagnated
					? `Coverage gate is below target for ${failedMetrics} and did not improve. Run a narrow context_compile for the blocked coverage target, then add focused tests.`
					: `Coverage gate is below target for ${failedMetrics}; add focused tests and try again.`,
			coverage,
			prerequisites,
			sourceGuard,
			commandResult,
			budget,
		},
		nextState,
	};
}

export function formatCoverageAutonomyFinalReport(
	result: CoverageAutonomyGateResult,
): string {
	if (result.status === "disabled") return "Coverage gate: disabled.";
	const lines = [
		"Coverage autonomy gate:",
		`- status: ${result.status}`,
		`- attempt: ${result.attempt}/${result.maxIterations}`,
		result.command ? `- command: ${result.command}` : null,
		result.coverage
			? `- coverage: ${result.coverage.metrics
					.map(
						(metric) =>
							`${metric.metric} ${metric.actualPercent}%/${metric.targetPercent}%`,
					)
					.join(", ")}`
			: null,
		result.sourceGuard
			? `- source guard: ${result.sourceGuard.passed ? "passed" : "blocked"}`
			: null,
		result.configError ? `- config error: ${result.configError}` : null,
		result.budget.warning || result.budget.stop
			? `- budget: ${result.budget.reasons.join(", ")}`
			: null,
		`- result: ${result.message}`,
	].filter(Boolean);
	return lines.join("\n");
}

function safeReadSettings(
	repoRoot: string,
): { ok: true; value: TestQualitySettings } | { ok: false; error: string } {
	try {
		return { ok: true, value: readTestQualitySettingsFile(repoRoot) };
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

async function readSourceGuard(
	repoRoot: string,
): Promise<SourceDiffGuardResult> {
	const diff = await gitDiffTool({ repoRoot });
	return evaluateSourceDiffGuard(diff.ok ? diff.payload.diff : "");
}

function runCoverage(
	repoRoot: string,
	safetyPolicy: Parameters<
		typeof evaluateCoverageAutonomyGate
	>[0]["safetyPolicy"],
) {
	return runVerificationTool({
		command: coverageCommand,
		reason: "coverage autonomy gate",
		repoRoot,
		timeoutSeconds: 600,
		compressionMode: "auto",
		blockedCommands: safetyPolicy?.blockedCommands,
		allowedPaths: safetyPolicy?.allowedPaths,
		externalAllowedPaths: safetyPolicy?.externalAllowedPaths,
		deniedPaths: safetyPolicy?.deniedPaths,
		maxCommandSeconds: safetyPolicy?.maxCommandSeconds,
	});
}

function summarizeCommandResult(
	result: WorkerToolResult<{
		exitCode: number;
		stdout: string;
		stderr: string;
		logArtifactPath?: string;
	}>,
): CoverageAutonomyGateResult["commandResult"] {
	return {
		ok: result.ok,
		exitCode: result.payload.exitCode,
		stdoutPreview: truncate(result.payload.stdout),
		stderrPreview: truncate(result.payload.stderr),
		logArtifactPath: result.payload.logArtifactPath,
	};
}

function buildBudgetResult(startedAt: string, now: Date, stop: boolean) {
	const wallClockMinutes = Math.max(
		0,
		(now.getTime() - new Date(startedAt).getTime()) / 60000,
	);
	const warning =
		wallClockMinutes >=
		DEFAULT_COVERAGE_AUTONOMY_BUDGET.warningWallClockMinutes;
	const wallClockStop =
		wallClockMinutes >= DEFAULT_COVERAGE_AUTONOMY_BUDGET.stopWallClockMinutes ||
		stop;
	const reasons = [
		warning ? `wall_clock_warning=${wallClockMinutes.toFixed(1)}m` : null,
		wallClockStop
			? `wall_clock_or_iteration_stop=${wallClockMinutes.toFixed(1)}m`
			: null,
		"token_usage_unavailable",
		"cost_unavailable",
	].filter(Boolean) as string[];
	return {
		warning,
		stop: wallClockStop,
		wallClockMinutes,
		tokenUsageAvailable: false,
		costAvailable: false,
		reasons,
	};
}

function isStagnated(results: CoverageGateResult[]) {
	if (results.length < 2) return false;
	const [previous, current] = results.slice(-2);
	if (!previous || !current) return false;
	return current.metrics.every((metric) => {
		const previousMetric = previous.metrics.find(
			(item) => item.metric === metric.metric,
		);
		return previousMetric
			? metric.actualPercent <= previousMetric.actualPercent
			: false;
	});
}

function truncate(value: string, max = 2000) {
	return value.length > max ? `${value.slice(0, max)}\n...truncated...` : value;
}
