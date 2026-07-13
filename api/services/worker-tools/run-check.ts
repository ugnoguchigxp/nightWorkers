import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getLatestVerificationDocumentForTask } from "../../modules/nightworkers/nightworkers.verification.repository";
import {
	recordVerificationEvidence,
	runCompletionCheck,
} from "../../modules/nightworkers/nightworkers.verification.service";
import { parseJUnitXmlCases } from "../verification/adapters/junit";
import {
	buildCommandLevelEvidence,
	inferVerificationRunner,
} from "../verification/normalized-evidence";
import {
	type RunCommandInput,
	type RunCommandOutput,
	runCommandTool,
} from "./run-command";
import type { WorkerToolResult } from "./types";

export type RunCheckKind =
	| "lint"
	| "format_check"
	| "typecheck"
	| "test"
	| "coverage"
	| "build"
	| "verify"
	| "completion_check"
	| "other";

export interface RunCheckInput extends RunCommandInput {
	taskId?: string;
	runId?: string;
	verificationDocumentId?: string;
	checkKind: RunCheckKind;
	conditionIds?: string[];
	displayMode?: "summary" | "error_excerpt" | "full";
	captureMode?: "full";
	runnerHint?: string;
}

export interface RunCheckOutput extends RunCommandOutput {
	checkKind: RunCheckKind;
	managedEvidence: boolean;
	llmSummary: string;
	rawStdoutArtifactId: string;
	rawStderrArtifactId: string;
	verificationDocumentId?: string | null;
	evidenceRunId?: string;
	checklist?: {
		complete: boolean;
		failedRequired: number;
		unknownRequired: number;
	} | null;
}

export type CompletionCheckOutput = {
	llmSummary: string;
	result: Awaited<ReturnType<typeof runCompletionCheck>>;
};

export async function runCheckTool(
	input: RunCheckInput,
): Promise<WorkerToolResult<RunCheckOutput>> {
	const startedAt = new Date().toISOString();
	const command = await resolveRunCheckCommand(input);
	const commandResult = await runCommandTool({
		...input,
		command,
		compressionMode: "off",
	});
	const finishedAt = commandResult.finishedAt;
	const payload = commandResult.payload;
	const rawStdoutArtifactId = await writeRawCheckArtifact({
		stream: "stdout",
		command,
		content: payload.stdout,
		startedAt,
		finishedAt,
	});
	const rawStderrArtifactId = await writeRawCheckArtifact({
		stream: "stderr",
		command,
		content: payload.stderr,
		startedAt,
		finishedAt,
	});
	const verificationDocumentId =
		input.verificationDocumentId ||
		(input.taskId
			? (await getLatestVerificationDocumentForTask(input.taskId))?.id
			: null);
	const junitCases =
		/<testsuites?\b/i.test(payload.stdout) ||
		/<testsuites?\b/i.test(payload.stderr)
			? parseJUnitXmlCases(`${payload.stdout}\n${payload.stderr}`)
			: [];
	const resolvedCwd = path.resolve(input.repoRoot, input.cwd || "");
	const evidenceCwd = await fs.realpath(resolvedCwd).catch(() => resolvedCwd);
	const evidence =
		input.taskId && input.runId && shouldRecordRunCheckEvidence(commandResult)
			? buildCommandLevelEvidence({
					runId: input.runId,
					taskId: input.taskId,
					command,
					cwd: evidenceCwd,
					startedAt,
					finishedAt,
					exitCode: payload.exitCode,
					runner: inferVerificationRunner({
						command: input.command,
						runnerHint: input.runnerHint,
					}),
					rawStdoutArtifactId,
					rawStderrArtifactId,
					conditionIds: input.conditionIds,
					cases: junitCases,
				})
			: null;
	const recorded =
		evidence && input.taskId
			? await recordVerificationEvidence({
					taskId: input.taskId,
					runId: input.runId,
					verificationDocumentId,
					checkKind: input.checkKind,
					fullGate:
						input.checkKind === "verify" ||
						input.checkKind === "coverage" ||
						input.checkKind === "build",
					evidence,
				})
			: null;
	const llmSummary = formatRunCheckSummary({
		checkKind: input.checkKind,
		exitCode: payload.exitCode,
		stdout: payload.stdout,
		stderr: payload.stderr,
		error: commandResult.error,
	});
	return {
		ok: commandResult.ok,
		toolName: "run_check",
		startedAt,
		finishedAt,
		payload: {
			...payload,
			stdout: input.displayMode === "full" ? payload.stdout : "",
			stderr: input.displayMode === "full" ? payload.stderr : "",
			checkKind: input.checkKind,
			managedEvidence: Boolean(recorded),
			llmSummary,
			rawStdoutArtifactId,
			rawStderrArtifactId,
			verificationDocumentId,
			evidenceRunId: recorded?.evidenceRun.id,
			checklist: recorded?.checklist
				? {
						complete: recorded.checklist.complete,
						failedRequired: recorded.checklist.failedRequired.length,
						unknownRequired: recorded.checklist.unknownRequired.length,
					}
				: null,
		},
		error: commandResult.error,
		artifactIds: [rawStdoutArtifactId, rawStderrArtifactId],
	};
}

export async function completionCheckTool(input: {
	taskId: string;
	verificationDocumentId?: string;
}): Promise<WorkerToolResult<CompletionCheckOutput>> {
	const startedAt = new Date().toISOString();
	const result = await runCompletionCheck(input);
	const llmSummary = result.ok
		? "OK completion_check"
		: [
				"ERROR completion_check",
				`reason=${result.reason || "unknown"}`,
				`failedRequired=${result.summary.failedRequired}`,
				`unknownRequired=${result.summary.unknownRequired}`,
				...result.failedRequired.map(
					(item) => `failed ${item.conditionId}: ${item.reason || item.text}`,
				),
				...result.unknownRequired.map(
					(item) => `unknown ${item.conditionId}: ${item.reason || item.text}`,
				),
			].join("\n");
	return {
		ok: result.ok,
		toolName: "completion_check",
		startedAt,
		finishedAt: new Date().toISOString(),
		payload: { llmSummary, result },
		error: result.ok
			? undefined
			: {
					code: result.reason || "COMPLETION_CHECK_FAILED",
					message: llmSummary,
				},
	};
}

function formatRunCheckSummary(input: {
	checkKind: RunCheckKind;
	exitCode: number;
	stdout: string;
	stderr: string;
	error?: WorkerToolResult<RunCommandOutput>["error"];
}) {
	if (input.exitCode === 0) {
		return [`OK ${input.checkKind}`, `exitCode=0`].join("\n");
	}
	const excerpt = stripTerminalControlSequences(
		`${input.stderr}\n${input.stdout}`,
	)
		.split("\n")
		.map((line) => line.trimEnd())
		.filter(Boolean)
		.slice(0, 24)
		.join("\n");
	const errorMessage = input.error?.message
		? stripTerminalControlSequences(input.error.message).trim()
		: "";
	const includeErrorMessage =
		Boolean(errorMessage) &&
		(input.error?.code !== "COMMAND_FAILED" || !excerpt);
	return [
		`ERROR ${input.checkKind}`,
		`exitCode=${input.exitCode}`,
		input.error?.code ? `errorCode=${input.error.code}` : null,
		includeErrorMessage ? `error=${errorMessage}` : null,
		excerpt,
	]
		.filter(Boolean)
		.join("\n");
}

function stripTerminalControlSequences(value: string) {
	const ansiEscape = String.fromCharCode(27);
	return value
		.replace(
			new RegExp(
				`${ansiEscape}\\][^\\u0007]*(?:\\u0007|${ansiEscape}\\\\)`,
				"g",
			),
			"",
		)
		.replace(
			new RegExp(
				`${ansiEscape}\\[[0-?]*[ -/]*[@-~]|\\u009B[0-?]*[ -/]*[@-~]`,
				"g",
			),
			"",
		);
}

async function writeRawCheckArtifact(input: {
	stream: "stdout" | "stderr";
	command: string;
	content: string;
	startedAt: string;
	finishedAt: string;
}) {
	const dir = path.join(os.tmpdir(), "nightworkers-check-artifacts");
	await fs.mkdir(dir, { recursive: true });
	const digest = crypto
		.createHash("sha256")
		.update(
			[
				input.stream,
				input.command,
				input.startedAt,
				input.finishedAt,
				input.content,
			].join("\n"),
		)
		.digest("hex")
		.slice(0, 24);
	const filePath = path.join(dir, `${digest}.${input.stream}.log`);
	await fs.writeFile(filePath, input.content, "utf-8");
	return filePath;
}

async function resolveRunCheckCommand(input: RunCheckInput) {
	const command = input.command.trim();
	const scriptName = resolveRunCheckScriptName(command, input.checkKind);
	if (!scriptName) return command;
	const packageJson = await readPackageJson(input.repoRoot, input.cwd);
	if (!packageJson?.scripts?.[scriptName]) return command;
	const packageManager = await detectPackageManager(input.repoRoot, input.cwd);
	return `${packageManager} run ${scriptName}`;
}

function resolveRunCheckScriptName(command: string, checkKind: RunCheckKind) {
	if (command === checkKind) return command;
	if (command === "format" && checkKind === "format_check") return "format";
	if (command === "format_check" && checkKind === "format_check")
		return "format";
	if (
		["test", "typecheck", "lint", "build", "coverage", "verify"].includes(
			command,
		)
	) {
		return command;
	}
	return null;
}

async function readPackageJson(repoRoot: string, cwd?: string) {
	const packageJsonPath = path.join(
		path.resolve(repoRoot, cwd || ""),
		"package.json",
	);
	const raw = await fs.readFile(packageJsonPath, "utf-8").catch(() => null);
	if (!raw) return null;
	try {
		return JSON.parse(raw) as { scripts?: Record<string, string> };
	} catch {
		return null;
	}
}

async function detectPackageManager(repoRoot: string, cwd?: string) {
	const root = path.resolve(repoRoot, cwd || "");
	const candidates: Array<[string, string]> = [
		["bun.lock", "bun"],
		["bun.lockb", "bun"],
		["pnpm-lock.yaml", "pnpm"],
		["yarn.lock", "yarn"],
		["package-lock.json", "npm"],
	];
	for (const [lockfile, manager] of candidates) {
		if (await fileExists(path.join(root, lockfile))) return manager;
	}
	return "bun";
}

async function fileExists(filePath: string) {
	return fs
		.stat(filePath)
		.then((stat) => stat.isFile())
		.catch(() => false);
}

function shouldRecordRunCheckEvidence(
	result: WorkerToolResult<RunCommandOutput>,
) {
	if (result.ok) return true;
	return (
		result.error?.code === "COMMAND_FAILED" ||
		result.error?.code === "COMMAND_TIMEOUT"
	);
}
