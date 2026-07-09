import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { ReviewTarget } from "./nightworkers.review-mode.model";
import { toErrorMessage } from "./run-orchestration/utils";

const execFileAsync = promisify(execFile);
const ORACLE_PROFILE = "agent-output";

export type VulnWorkbenchCliSettings = {
	enabled: boolean;
	cwd: string;
	timeoutSeconds: number;
};

export type VulnWorkbenchSecurityResult = {
	ok: boolean;
	projectId: string | null;
	projectPath: string | null;
	scanRunId: string | null;
	profile: string;
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

type OracleSecurityPayload = {
	ok?: unknown;
	status?: unknown;
	project?: unknown;
	scan?: unknown;
	review?: unknown;
	nextAction?: unknown;
	error?: unknown;
};

export type VulnWorkbenchCommandRunner = (
	cwd: string,
	args: string[],
	timeoutSeconds: number,
) => Promise<BunCommandResult>;

export function buildVulnWorkbenchCliEnv(
	baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
	const allowedKeys = [
		"PATH",
		"TMPDIR",
		"TMP",
		"TEMP",
		"LANG",
		"LC_ALL",
	] as const;
	const env: NodeJS.ProcessEnv = {};
	for (const key of allowedKeys) {
		if (baseEnv[key]) env[key] = baseEnv[key];
	}
	env.PATH = buildVulnWorkbenchToolPath(baseEnv.PATH);
	return env;
}

export function readVulnWorkbenchCliSettings(
	env: NodeJS.ProcessEnv = process.env,
): VulnWorkbenchCliSettings {
	return {
		enabled: env.NIGHTWORKERS_VULNWORKBENCH_ENABLED !== "false",
		cwd:
			env.NIGHTWORKERS_VULNWORKBENCH_CWD ||
			"/Users/y.noguchi/Code/vulnWorkbench",
		timeoutSeconds: readPositiveInt(
			env.NIGHTWORKERS_VULNWORKBENCH_TIMEOUT_SECONDS,
			600,
		),
	};
}

export async function runVulnWorkbenchSecurityDiagnostic(input: {
	target: Pick<ReviewTarget, "repoRoot" | "targetFiles">;
	artifactDir: string;
	settings?: VulnWorkbenchCliSettings;
	runCommand?: VulnWorkbenchCommandRunner;
}): Promise<VulnWorkbenchSecurityResult> {
	const settings = input.settings ?? readVulnWorkbenchCliSettings();
	const profile = ORACLE_PROFILE;
	const timeoutSeconds = settings.timeoutSeconds;
	const runCommand = input.runCommand ?? runBunCommand;
	if (!settings.enabled) {
		return unconfiguredResult(
			profile,
			null,
			"vulnWorkbench security diagnostic is disabled.",
		);
	}
	if (!input.target.repoRoot.trim()) {
		return unconfiguredResult(
			profile,
			null,
			"Repository path is not available for vulnWorkbench security diagnostic.",
		);
	}

	const commandsRun: VulnWorkbenchSecurityResult["commandsRun"] = [];
	const oracleArgs = [
		"run",
		"api/cli/oracle-security.ts",
		"--project-path",
		input.target.repoRoot,
	];
	const oracle = await runCommand(settings.cwd, oracleArgs, timeoutSeconds);
	commandsRun.push(oracle.command);

	const payload = parseOracleSecurityPayload(oracle.output);
	if (!payload) {
		return {
			ok: false,
			projectId: null,
			projectPath: input.target.repoRoot,
			scanRunId: oracle.scanRunId,
			profile,
			commandsRun,
			reportPath: null,
			findingCount: 0,
			highOrCriticalCount: 0,
			improvementRequest: null,
			error:
				oracle.command.summary || "vulnWorkbench did not return JSON output.",
		};
	}

	return resultFromOraclePayload(payload, {
		commandsRun,
		fallbackProfile: profile,
		fallbackProjectPath: input.target.repoRoot,
		fallbackScanRunId: oracle.scanRunId,
		fallbackError:
			oracle.command.exitCode === 0 ? null : oracle.command.summary,
	});
}

export function warningFindingForVulnWorkbenchResult(
	result: VulnWorkbenchSecurityResult,
) {
	if (result.ok) return null;
	return {
		severity: "warning" as const,
		title: result.projectPath
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
			result.projectPath ? `projectPath: ${result.projectPath}` : null,
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

async function runBunCommand(
	cwd: string,
	args: string[],
	timeoutSeconds: number,
): Promise<BunCommandResult> {
	const commandText = `bun ${args.join(" ")}`;
	try {
		const result = await execFileAsync(process.execPath, args, {
			cwd,
			env: buildVulnWorkbenchCliEnv(),
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
	projectPath: string | null,
	error: string,
): VulnWorkbenchSecurityResult {
	return {
		ok: false,
		projectId: null,
		projectPath,
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

function readPositiveInt(value: string | undefined, fallback: number) {
	const parsed = Number.parseInt(value || "", 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function buildVulnWorkbenchToolPath(basePath: string | undefined): string {
	const entries = [
		...(basePath?.split(":").filter(Boolean) ?? []),
		path.dirname(process.execPath),
		"/opt/homebrew/bin",
		"/opt/homebrew/sbin",
		"/usr/local/bin",
		"/usr/bin",
		"/bin",
	];
	return [...new Set(entries)].join(":");
}

function extractScanRunId(output: string) {
	return (
		/(?:scanRunId|scan_run_id|scan-run-id)[":=\s]+([a-zA-Z0-9_-]+)/.exec(
			output,
		)?.[1] ?? null
	);
}

function parseOracleSecurityPayload(
	output: string,
): OracleSecurityPayload | null {
	const trimmed = output.trim();
	if (!trimmed) return null;
	const lines = trimmed
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
	for (const candidate of [...lines].reverse()) {
		try {
			const parsed = JSON.parse(candidate);
			return isRecord(parsed) ? parsed : null;
		} catch {}
	}
	try {
		const parsed = JSON.parse(trimmed);
		return isRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function resultFromOraclePayload(
	payload: OracleSecurityPayload,
	fallbacks: {
		commandsRun: VulnWorkbenchSecurityResult["commandsRun"];
		fallbackProfile: string;
		fallbackProjectPath: string;
		fallbackScanRunId: string | null;
		fallbackError: string | null;
	},
): VulnWorkbenchSecurityResult {
	const project = isRecord(payload.project) ? payload.project : null;
	const scan = isRecord(payload.scan) ? payload.scan : null;
	const review = isRecord(payload.review) ? payload.review : null;
	const error = isRecord(payload.error) ? payload.error : null;
	const status = typeof payload.status === "string" ? payload.status : null;
	const diagnosticCompleted =
		status === "completed" ||
		status === "security_action_required" ||
		status === "inconclusive";
	const parsed = parseSecurityOutput(JSON.stringify(payload));
	const projectPath =
		(typeof project?.repoPath === "string" ? project.repoPath : null) ??
		fallbacks.fallbackProjectPath;
	const scanRunId =
		(typeof scan?.scanRunId === "string" ? scan.scanRunId : null) ??
		fallbacks.fallbackScanRunId;
	const errorMessage =
		typeof error?.message === "string"
			? error.message
			: typeof review?.error === "string"
				? review.error
				: diagnosticCompleted
					? null
					: fallbacks.fallbackError;
	return {
		ok: diagnosticCompleted && !!scan,
		projectId: typeof project?.id === "string" ? project.id : null,
		projectPath,
		scanRunId,
		profile:
			(typeof scan?.profile === "string" ? scan.profile : null) ??
			fallbacks.fallbackProfile,
		commandsRun: fallbacks.commandsRun,
		reportPath: typeof scan?.reportPath === "string" ? scan.reportPath : null,
		findingCount:
			typeof scan?.findingCount === "number"
				? scan.findingCount
				: parsed.findingCount,
		highOrCriticalCount:
			typeof scan?.highOrCriticalCount === "number"
				? scan.highOrCriticalCount
				: parsed.highOrCriticalCount,
		improvementRequest:
			(typeof review?.improvementRequest === "string"
				? review.improvementRequest
				: null) ?? parsed.improvementRequest,
		error: errorMessage,
	};
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}
