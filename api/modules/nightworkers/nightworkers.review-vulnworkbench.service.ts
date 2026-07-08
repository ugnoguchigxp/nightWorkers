import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { ReviewTarget } from "./nightworkers.review-mode.model";
import { toErrorMessage } from "./run-orchestration/utils";

const execFileAsync = promisify(execFile);

export type VulnWorkbenchCliSettings = {
	enabled: boolean;
	cwd: string;
	projectIdByRepositoryId: Record<string, string>;
	defaultProfile: "baseline" | "detailed-security";
	timeoutSeconds: number;
};

export type VulnWorkbenchSecurityResult = {
	ok: boolean;
	projectId: string | null;
	scanRunId: string | null;
	profile: "baseline" | "detailed-security";
	commandsRun: Array<{
		command: string;
		exitCode: number | null;
		summary: string;
	}>;
	reportPath: string | null;
	findingCount: number;
	highOrCriticalCount: number;
	improvementRequest: string | null;
	error: string | null;
};

type BunCommandResult = {
	command: VulnWorkbenchSecurityResult["commandsRun"][number];
	output: string;
	scanRunId: string | null;
};

export type VulnWorkbenchCommandRunner = (
	cwd: string,
	args: string[],
	timeoutSeconds: number,
) => Promise<BunCommandResult>;

export function readVulnWorkbenchCliSettings(
	env: NodeJS.ProcessEnv = process.env,
): VulnWorkbenchCliSettings {
	return {
		enabled: env.NIGHTWORKERS_VULNWORKBENCH_ENABLED !== "false",
		cwd:
			env.NIGHTWORKERS_VULNWORKBENCH_CWD ||
			"/Users/y.noguchi/Code/vulnWorkbench",
		projectIdByRepositoryId: parseProjectMap(
			env.NIGHTWORKERS_VULNWORKBENCH_PROJECTS,
		),
		defaultProfile:
			env.NIGHTWORKERS_VULNWORKBENCH_PROFILE === "detailed-security"
				? "detailed-security"
				: "baseline",
		timeoutSeconds: readPositiveInt(
			env.NIGHTWORKERS_VULNWORKBENCH_TIMEOUT_SECONDS,
			600,
		),
	};
}

export async function runVulnWorkbenchSecurityDiagnostic(input: {
	target: Pick<ReviewTarget, "repositoryId" | "targetFiles">;
	artifactDir: string;
	settings?: VulnWorkbenchCliSettings;
	runCommand?: VulnWorkbenchCommandRunner;
}): Promise<VulnWorkbenchSecurityResult> {
	const settings = input.settings ?? readVulnWorkbenchCliSettings();
	const profile = resolveProfile(settings, input.target);
	const timeoutSeconds = resolveTimeoutSeconds(settings, profile);
	const runCommand = input.runCommand ?? runBunCommand;
	const projectId =
		settings.projectIdByRepositoryId[input.target.repositoryId] ?? null;
	if (!settings.enabled) {
		return unconfiguredResult(
			profile,
			"vulnWorkbench security diagnostic is disabled.",
		);
	}
	if (!projectId) {
		return unconfiguredResult(
			profile,
			"vulnWorkbench project id is not configured for this repository.",
		);
	}
	const reportPath = path.join(
		input.artifactDir,
		profile === "detailed-security"
			? "vulnworkbench-detailed-report.md"
			: "vulnworkbench-report.md",
	);
	const commandsRun: VulnWorkbenchSecurityResult["commandsRun"] = [];
	const scanArgs = [
		"run",
		"scan:profile",
		"--",
		"--project-id",
		projectId,
		"--profile",
		profile,
		"--timeout-sec",
		String(timeoutSeconds),
		"--report-output",
		reportPath,
	];
	const scan = await runCommand(settings.cwd, scanArgs, timeoutSeconds);
	commandsRun.push(scan.command);
	if (scan.command.exitCode !== 0) {
		return {
			ok: false,
			projectId,
			scanRunId: scan.scanRunId,
			profile,
			commandsRun,
			reportPath,
			findingCount: 0,
			highOrCriticalCount: 0,
			improvementRequest: null,
			error: scan.command.summary,
		};
	}
	if (!scan.scanRunId) {
		return {
			ok: false,
			projectId,
			scanRunId: null,
			profile,
			commandsRun,
			reportPath,
			findingCount: 0,
			highOrCriticalCount: 0,
			improvementRequest: null,
			error: "vulnWorkbench scan did not return a scan run id.",
		};
	}
	const reviewArgs = [
		"run",
		"review:scan",
		"--",
		"--scan-run-id",
		scan.scanRunId,
		"--task",
		"scan_review",
	];
	const review = await runCommand(
		settings.cwd,
		reviewArgs,
		settings.timeoutSeconds,
	);
	commandsRun.push(review.command);
	const parsed = parseSecurityOutput([scan.output, review.output].join("\n"));
	return {
		ok: review.command.exitCode === 0,
		projectId,
		scanRunId: scan.scanRunId || review.scanRunId,
		profile,
		commandsRun,
		reportPath,
		findingCount: parsed.findingCount,
		highOrCriticalCount: parsed.highOrCriticalCount,
		improvementRequest: parsed.improvementRequest,
		error: review.command.exitCode === 0 ? null : review.command.summary,
	};
}

export function warningFindingForVulnWorkbenchResult(
	result: VulnWorkbenchSecurityResult,
) {
	if (result.ok) return null;
	return {
		severity: "warning" as const,
		title: result.projectId
			? "vulnWorkbench security diagnostic could not complete"
			: "vulnWorkbench security diagnostic was not configured",
		body:
			result.error ||
			"Security diagnostic did not produce scanner-backed evidence.",
		evidenceRefsJson: [],
		sourceSection: "review_run",
	};
}

export function findingForVulnWorkbenchResult(
	result: VulnWorkbenchSecurityResult,
) {
	const warning = warningFindingForVulnWorkbenchResult(result);
	if (warning) return warning;
	return {
		severity:
			result.findingCount > 0 ? ("warning" as const) : ("info" as const),
		title:
			result.findingCount > 0
				? "vulnWorkbench security diagnostic reported scanner-backed findings"
				: "vulnWorkbench security diagnostic completed",
		body: [
			`profile: ${result.profile}`,
			`scanRunId: ${result.scanRunId ?? "(unknown)"}`,
			`findingCount: ${result.findingCount}`,
			`highOrCriticalCount: ${result.highOrCriticalCount}`,
			result.reportPath ? `reportPath: ${result.reportPath}` : null,
			result.improvementRequest
				? `improvementRequest: ${result.improvementRequest}`
				: null,
		]
			.filter(Boolean)
			.join("\n"),
		evidenceRefsJson: [],
		sourceSection: "review_run",
	};
}

function resolveProfile(
	settings: VulnWorkbenchCliSettings,
	target: Pick<ReviewTarget, "targetFiles">,
): "baseline" | "detailed-security" {
	if (settings.defaultProfile === "detailed-security")
		return "detailed-security";
	const sensitive = target.targetFiles.some((file) =>
		/(auth|security|secret|token|password|permission|middleware|api\/)/i.test(
			file.path,
		),
	);
	return sensitive ? "detailed-security" : "baseline";
}

function resolveTimeoutSeconds(
	settings: VulnWorkbenchCliSettings,
	profile: VulnWorkbenchSecurityResult["profile"],
) {
	return profile === "detailed-security"
		? Math.max(settings.timeoutSeconds, 1200)
		: settings.timeoutSeconds;
}

async function runBunCommand(
	cwd: string,
	args: string[],
	timeoutSeconds: number,
): Promise<BunCommandResult> {
	const commandText = `bun ${args.join(" ")}`;
	try {
		const result = await execFileAsync("bun", args, {
			cwd,
			timeout: Math.max(1, timeoutSeconds) * 1000,
			maxBuffer: 20 * 1024 * 1024,
		});
		const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
		return {
			command: {
				command: commandText,
				exitCode: 0,
				summary: summarizeOutput(output) || "Command completed.",
			},
			output,
			scanRunId: extractScanRunId(output),
		};
	} catch (error) {
		const record = error as {
			code?: unknown;
			stdout?: string;
			stderr?: string;
		};
		const output = [record.stdout, record.stderr].filter(Boolean).join("\n");
		return {
			command: {
				command: commandText,
				exitCode: typeof record.code === "number" ? record.code : null,
				summary: summarizeOutput(output) || toErrorMessage(error),
			},
			output,
			scanRunId: extractScanRunId(output),
		};
	}
}

function unconfiguredResult(
	profile: VulnWorkbenchSecurityResult["profile"],
	error: string,
): VulnWorkbenchSecurityResult {
	return {
		ok: false,
		projectId: null,
		scanRunId: null,
		profile,
		commandsRun: [],
		reportPath: null,
		findingCount: 0,
		highOrCriticalCount: 0,
		improvementRequest: null,
		error,
	};
}

function parseProjectMap(value: string | undefined) {
	if (!value?.trim()) return {};
	try {
		const parsed = JSON.parse(value);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
			return {};
		return Object.fromEntries(
			Object.entries(parsed).filter(
				(entry): entry is [string, string] =>
					typeof entry[0] === "string" && typeof entry[1] === "string",
			),
		);
	} catch {
		return {};
	}
}

function readPositiveInt(value: string | undefined, fallback: number) {
	const parsed = Number.parseInt(value || "", 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function extractScanRunId(output: string) {
	return (
		/(?:scanRunId|scan_run_id|scan-run-id)[":=\s]+([a-zA-Z0-9_-]+)/.exec(
			output,
		)?.[1] ?? null
	);
}

function parseSecurityOutput(output: string) {
	const findingCount = readFirstNumber(output, /findingCount[":=\s]+(\d+)/i);
	const highOrCriticalCount = readFirstNumber(
		output,
		/highOrCriticalCount[":=\s]+(\d+)/i,
	);
	const improvementRequest =
		/improvementRequest[":=\s]+(.+)/i.exec(output)?.[1]?.trim() ?? null;
	return { findingCount, highOrCriticalCount, improvementRequest };
}

function readFirstNumber(output: string, pattern: RegExp) {
	const value = pattern.exec(output)?.[1];
	return value ? Number.parseInt(value, 10) || 0 : 0;
}

function summarizeOutput(output: string) {
	return output.replace(/\s+/g, " ").trim().slice(0, 500);
}
