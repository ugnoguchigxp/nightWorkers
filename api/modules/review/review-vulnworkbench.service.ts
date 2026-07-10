import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
	type SecurityOracleResult,
	securityOracleResultSchema,
} from "../../../shared/schemas/security-oracle.schema";
import {
	buildVulnWorkbenchCliEnv,
	DEFAULT_VULNWORKBENCH_CWD,
	resolveVulnWorkbenchBunExecutable,
} from "../../services/vulnworkbench-cli-runtime";
import { toErrorMessage } from "../nightworkers/run-orchestration/utils";
import type { ReviewTarget } from "./review-mode.model";

const execFileAsync = promisify(execFile);
const ORACLE_PROFILE = "agent-output";

export type VulnWorkbenchCliSettings = {
	enabled: boolean;
	cwd: string;
	timeoutSeconds: number;
};

export type VulnWorkbenchSecurityResult = {
	ok: boolean;
	status: SecurityOracleResult["status"];
	projectId: string | null;
	projectPath: string | null;
	scanRunId: string | null;
	profile: string;
	topFindings: VulnWorkbenchTopFinding[];
	findingsTruncated: boolean;
	blockingFingerprints: string[];
	commandsRun: Array<{
		command: string;
		exitCode: number | null;
		summary: string;
	}>;
	findingCount: number;
	highOrCriticalCount: number;
	improvementRequest: string | null;
	error: string | null;
};

export type VulnWorkbenchTopFinding = {
	id: string | null;
	fingerprint: string;
	severity: string;
	tool: string;
	ruleId: string;
	title: string;
	location: {
		path: string;
		line: number | null;
	} | null;
	recommendation: string;
};

type BunCommandResult = {
	command: VulnWorkbenchSecurityResult["commandsRun"][number];
	output: string;
	scanRunId: string | null;
};

type OracleSecurityPayload = SecurityOracleResult;

export type VulnWorkbenchCommandRunner = (
	cwd: string,
	args: string[],
	timeoutSeconds: number,
) => Promise<BunCommandResult>;

export { buildVulnWorkbenchCliEnv };

export function readVulnWorkbenchCliSettings(
	env: NodeJS.ProcessEnv = process.env,
): VulnWorkbenchCliSettings {
	return {
		enabled: env.NIGHTWORKERS_VULNWORKBENCH_ENABLED !== "false",
		cwd: env.NIGHTWORKERS_VULNWORKBENCH_CWD || DEFAULT_VULNWORKBENCH_CWD,
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
			status: "runtime_error",
			projectId: null,
			projectPath: input.target.repoRoot,
			scanRunId: oracle.scanRunId,
			profile,
			topFindings: [],
			findingsTruncated: false,
			blockingFingerprints: [],
			commandsRun,
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
			result.findingCount > 0
				? formatActionableFindings(result)
				: "scanner-backed finding は検出されませんでした。",
			"",
			"scan summary:",
			`- profile: ${result.profile}`,
			result.projectPath ? `- projectPath: ${result.projectPath}` : null,
			`- scanRunId: ${result.scanRunId ?? "(unknown)"}`,
			`- findingCount: ${result.findingCount}`,
			`- highOrCriticalCount: ${result.highOrCriticalCount}`,
			result.improvementRequest
				? `- improvementRequest: ${result.improvementRequest}`
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
		const result = await execFileAsync(
			resolveVulnWorkbenchBunExecutable(),
			args,
			{
				cwd,
				env: buildVulnWorkbenchCliEnv(),
				timeout: Math.max(1, timeoutSeconds) * 1000,
				maxBuffer: 20 * 1024 * 1024,
			},
		);
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
		status: "config_error",
		projectId: null,
		projectPath,
		scanRunId: null,
		profile,
		topFindings: [],
		findingsTruncated: false,
		blockingFingerprints: [],
		commandsRun: [],
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
			const parsed = securityOracleResultSchema.safeParse(
				JSON.parse(candidate),
			);
			if (parsed.success) return parsed.data;
		} catch {}
	}
	try {
		const parsed = securityOracleResultSchema.safeParse(JSON.parse(trimmed));
		return parsed.success ? parsed.data : null;
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
	const project = payload.project;
	const scan = payload.scan;
	const review = payload.review;
	const error = payload.error;
	const status = payload.status;
	const diagnosticCompleted =
		status === "completed" ||
		status === "security_action_required" ||
		status === "inconclusive";
	const projectPath = project?.repoPath ?? fallbacks.fallbackProjectPath;
	const scanRunId = scan?.scanRunId ?? fallbacks.fallbackScanRunId;
	const errorMessage = error?.message
		? error.message
		: review.error
			? review.error
			: diagnosticCompleted
				? null
				: fallbacks.fallbackError;
	return {
		ok: diagnosticCompleted && !!scan,
		status,
		projectId: project?.id ?? null,
		projectPath,
		scanRunId,
		profile: scan?.profile ?? fallbacks.fallbackProfile,
		topFindings: parseTopFindings(scan?.findings),
		findingsTruncated: scan?.findingsTruncated ?? false,
		blockingFingerprints: scan?.blockingFingerprints ?? [],
		commandsRun: fallbacks.commandsRun,
		findingCount: scan?.findingCount ?? 0,
		highOrCriticalCount: scan?.highOrCriticalCount ?? 0,
		improvementRequest: review.improvementRequest ?? null,
		error: errorMessage,
	};
}

function parseTopFindings(value: unknown): VulnWorkbenchTopFinding[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((item): VulnWorkbenchTopFinding | null => {
			if (!isRecord(item)) return null;
			const location = isRecord(item.location) ? item.location : null;
			const locationPath =
				typeof location?.path === "string" ? location.path : null;
			return {
				id: typeof item.id === "string" ? item.id : null,
				fingerprint:
					typeof item.fingerprint === "string" ? item.fingerprint : "",
				severity: typeof item.severity === "string" ? item.severity : "unknown",
				tool: typeof item.tool === "string" ? item.tool : "unknown",
				ruleId: typeof item.ruleId === "string" ? item.ruleId : "unknown-rule",
				title: typeof item.title === "string" ? item.title : "Untitled finding",
				location: locationPath
					? {
							path: locationPath,
							line: typeof location?.line === "number" ? location.line : null,
						}
					: null,
				recommendation:
					typeof item.recommendation === "string"
						? item.recommendation
						: "検出箇所を確認し、scanner rule が求める制御を追加してください。",
			};
		})
		.filter((item): item is VulnWorkbenchTopFinding => item !== null)
		.slice(0, 10);
}

function formatActionableFindings(result: VulnWorkbenchSecurityResult) {
	if (result.topFindings.length === 0) {
		return "対応が必要な検出がありますが、vulnWorkbench から finding 本文を取得できませんでした。";
	}
	const lines = ["対応が必要な検出:"];
	for (const [index, finding] of result.topFindings.entries()) {
		const location = finding.location
			? `${finding.location.path}${finding.location.line ? `:${finding.location.line}` : ""}`
			: "(location unavailable)";
		lines.push(
			`${index + 1}. [${finding.severity}] ${finding.title}`,
			`   場所: ${location}`,
			`   根拠: ${finding.tool} / ${finding.ruleId}`,
			`   対応: ${finding.recommendation}`,
		);
	}
	if (result.findingCount > result.topFindings.length) {
		lines.push(
			`ほか ${result.findingCount - result.topFindings.length} 件は、この出力には含まれていません。`,
		);
	}
	return lines.join("\n");
}

function summarizeOutput(output: string) {
	return output.replace(/\s+/g, " ").trim().slice(0, 500);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}
