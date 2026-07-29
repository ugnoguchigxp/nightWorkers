import { exec } from "node:child_process";
import crypto from "node:crypto";
import { Stats } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { getDeepRecordString, toDeepRecord } from "../../../shared/json-record";
import { DEFAULT_MODEL_VISIBLE_TEXT_LIMIT_CHARS } from "../model-visible-payload";
import {
	isCredentialFileEnvironmentKey,
	isRegistryCredentialEnvironmentKey,
} from "../security/secret-redaction";
import { analyzeCommand } from "./command-policy";
import {
	compressCommandStream,
	type ToolOutputCompressionMetadata,
} from "./output-compression";
import {
	enforceCommandPolicy,
	enforcePathPolicy,
	resolveCommandTimeout,
} from "./tool-policy-enforcer";
import type { WorkerToolResult } from "./types";

const execAsync = promisify(exec);
const MAX_OUTPUT_CHARS = DEFAULT_MODEL_VISIBLE_TEXT_LIMIT_CHARS;
const MAX_EXEC_BUFFER_BYTES = 10 * 1024 * 1024;

async function writeCommandOutputArtifact(input: {
	command: string;
	exitCode: number;
	stdout: string;
	stderr: string;
	classification: string;
	startedAt: string;
	finishedAt: string;
}): Promise<string> {
	const dir = path.join(os.tmpdir(), "nightworkers-command-artifacts");
	await fs.mkdir(dir, { recursive: true });
	const digest = crypto
		.createHash("sha256")
		.update(
			`${input.startedAt}\n${input.command}\n${input.stdout}\n${input.stderr}`,
		)
		.digest("hex")
		.slice(0, 20);
	const filePath = path.join(dir, `${digest}.json`);
	await fs.writeFile(filePath, JSON.stringify(input, null, 2), "utf-8");
	return filePath;
}

async function buildCommandOutput(input: {
	command: string;
	exitCode: number;
	signal: string | null;
	timedOut: boolean;
	stdout: string;
	stderr: string;
	classification: string;
	cwd: string;
	repositoryRoot: string;
	startedAt: string;
	finishedAt: string;
	compressionMode?: "auto" | "off";
}): Promise<RunCommandOutput> {
	const shouldCompress =
		input.compressionMode !== "off" &&
		(input.stdout.length > MAX_OUTPUT_CHARS ||
			input.stderr.length > MAX_OUTPUT_CHARS);
	const logArtifactPath = shouldCompress
		? await writeCommandOutputArtifact(input)
		: undefined;

	if (!shouldCompress) {
		return {
			command: input.command,
			exitCode: input.exitCode,
			signal: input.signal,
			timedOut: input.timedOut,
			stdout: input.stdout,
			stderr: input.stderr,
			stdoutDigest: streamDigest(input.stdout),
			stderrDigest: streamDigest(input.stderr),
			classification: input.classification,
			cwd: input.cwd,
			repositoryRoot: input.repositoryRoot,
			truncated: false,
		};
	}

	const stdoutCompression = compressCommandStream({
		streamName: "stdout",
		content: input.stdout,
		command: input.command,
		exitCode: input.exitCode,
		artifactPath: logArtifactPath,
	});
	const stderrCompression = compressCommandStream({
		streamName: "stderr",
		content: input.stderr,
		command: input.command,
		exitCode: input.exitCode,
		artifactPath: logArtifactPath,
	});

	const compression: RunCommandOutput["compression"] = {};
	if (stdoutCompression.compression)
		compression.stdout = stdoutCompression.compression;
	if (stderrCompression.compression)
		compression.stderr = stderrCompression.compression;

	return {
		command: input.command,
		exitCode: input.exitCode,
		signal: input.signal,
		timedOut: input.timedOut,
		stdout: stdoutCompression.content,
		stderr: stderrCompression.content,
		stdoutDigest: streamDigest(input.stdout),
		stderrDigest: streamDigest(input.stderr),
		classification: input.classification,
		cwd: input.cwd,
		repositoryRoot: input.repositoryRoot,
		truncated: stdoutCompression.truncated || stderrCompression.truncated,
		logArtifactPath,
		compression:
			compression.stdout || compression.stderr ? compression : undefined,
	};
}

export interface RunCommandInput {
	command: string;
	repoRoot: string;
	cwd?: string; // Relative to repoRoot
	timeoutSeconds?: number;
	maxCommandSeconds?: number;
	compressionMode?: "auto" | "off";
	blockedCommands?: string[];
	allowedPaths?: string[];
	externalAllowedPaths?: string[];
	deniedPaths?: string[];
	environment?: Record<string, string>;
}

export interface RunCommandOutput {
	command: string;
	exitCode: number;
	signal: string | null;
	timedOut: boolean;
	stdout: string;
	stderr: string;
	stdoutDigest: string;
	stderrDigest: string;
	classification: string;
	cwd: string;
	repositoryRoot: string;
	truncated: boolean;
	logArtifactPath?: string;
	compression?: {
		stdout?: ToolOutputCompressionMetadata;
		stderr?: ToolOutputCompressionMetadata;
	};
}

export async function runCommandTool(
	input: RunCommandInput,
): Promise<WorkerToolResult<RunCommandOutput>> {
	const startedAt = new Date().toISOString();
	const {
		command,
		repoRoot,
		cwd = "",
		timeoutSeconds = 60,
		maxCommandSeconds,
		compressionMode = "auto",
		blockedCommands = [],
		allowedPaths,
		externalAllowedPaths,
		deniedPaths,
		environment,
	} = input;

	const absoluteRepoRoot = path.resolve(repoRoot);
	const targetCwd = cwd
		? path.resolve(absoluteRepoRoot, cwd)
		: absoluteRepoRoot;

	// 1. Path Safety Check
	const pathDecision = enforcePathPolicy(targetCwd, {
		repoRoot: absoluteRepoRoot,
		allowedPaths,
		externalAllowedPaths,
		deniedPaths,
	});
	if (!pathDecision.allowed) {
		return {
			ok: false,
			toolName: "run_command",
			startedAt,
			finishedAt: new Date().toISOString(),
			payload: emptyCommandOutput({
				command,
				classification: "unknown",
				cwd: targetCwd,
				repositoryRoot: absoluteRepoRoot,
			}),
			error: {
				code: "ACCESS_DENIED",
				message:
					pathDecision.message ||
					`Command execution working directory is restricted by policy: ${cwd}`,
			},
		};
	}

	const cwdStat = await fs.stat(targetCwd).catch((error: unknown) => error);
	if (getDeepRecordString(cwdStat, "code") === "ENOENT") {
		return {
			ok: false,
			toolName: "run_command",
			startedAt,
			finishedAt: new Date().toISOString(),
			payload: emptyCommandOutput({
				command,
				classification: "unknown",
				cwd: targetCwd,
				repositoryRoot: absoluteRepoRoot,
			}),
			error: {
				code: "COMMAND_CWD_NOT_FOUND",
				message: `Command working directory not found: ${cwd || "."}`,
			},
		};
	}
	if (
		cwdStat instanceof Stats &&
		typeof cwdStat.isDirectory === "function" &&
		!cwdStat.isDirectory()
	) {
		return {
			ok: false,
			toolName: "run_command",
			startedAt,
			finishedAt: new Date().toISOString(),
			payload: emptyCommandOutput({
				command,
				classification: "unknown",
				cwd: targetCwd,
				repositoryRoot: absoluteRepoRoot,
			}),
			error: {
				code: "COMMAND_CWD_NOT_DIRECTORY",
				message: `Command working directory is not a directory: ${cwd || "."}`,
			},
		};
	}

	// 2. Command Safety Policy Check
	const cmdDecision = enforceCommandPolicy(command, {
		repoRoot: absoluteRepoRoot,
		blockedCommands,
		externalAllowedPaths,
	});
	const safety = analyzeCommand(command, blockedCommands);
	if (!cmdDecision.allowed) {
		return {
			ok: false,
			toolName: "run_command",
			startedAt,
			finishedAt: new Date().toISOString(),
			payload: emptyCommandOutput({
				command,
				classification: "unknown",
				cwd: targetCwd,
				repositoryRoot: absoluteRepoRoot,
			}),
			error: {
				code: "DESTRUCTIVE_COMMAND",
				message:
					cmdDecision.message ||
					`Execution of command was blocked by policy: ${command}`,
			},
		};
	}
	if (safety.classification === "background") {
		return {
			ok: false,
			toolName: "run_command",
			startedAt,
			finishedAt: new Date().toISOString(),
			payload: emptyCommandOutput({
				command,
				classification: safety.classification,
				cwd: targetCwd,
				repositoryRoot: absoluteRepoRoot,
			}),
			error: {
				code: "BACKGROUND_COMMAND_REQUIRED",
				message: `Long-running command must be started with run_background_command: ${command}`,
			},
		};
	}

	const effectiveTimeoutSeconds = resolveCommandTimeout(timeoutSeconds, {
		repoRoot: absoluteRepoRoot,
		blockedCommands,
		allowedPaths,
		externalAllowedPaths,
		deniedPaths,
		maxCommandSeconds,
	});

	try {
		const managedCommand =
			process.platform === "win32" ? command : `set -o pipefail\n${command}`;
		const promise = execAsync(managedCommand, {
			cwd: targetCwd,
			timeout: effectiveTimeoutSeconds * 1000,
			maxBuffer: MAX_EXEC_BUFFER_BYTES,
			...(environment
				? { env: buildAgentCommandEnvironment(environment) }
				: {}),
			...(process.platform === "win32" ? {} : { shell: "/bin/bash" }),
		});

		const { stdout, stderr } = await promise;
		const finishedAt = new Date().toISOString();

		return {
			ok: true,
			toolName: "run_command",
			startedAt,
			finishedAt,
			payload: await buildCommandOutput({
				command,
				exitCode: 0,
				signal: null,
				timedOut: false,
				classification: safety.classification,
				stdout,
				stderr,
				cwd: targetCwd,
				repositoryRoot: absoluteRepoRoot,
				startedAt,
				finishedAt,
				compressionMode,
			}),
		};
	} catch (err) {
		const error = toDeepRecord(err);
		const rawError =
			err && typeof err === "object" ? (err as Record<string, unknown>) : {};
		const exitCode = typeof error.code === "number" ? error.code : 1;
		const stdout = typeof error.stdout === "string" ? error.stdout : "";
		const stderr = typeof error.stderr === "string" ? error.stderr : "";
		const signal = typeof rawError.signal === "string" ? rawError.signal : null;
		const timedOut = rawError.killed === true;
		const finishedAt = new Date().toISOString();

		const message = timedOut
			? `Command timed out after ${effectiveTimeoutSeconds}s`
			: `Command failed: ${String(error.message || err)}`;

		return {
			ok: false,
			toolName: "run_command",
			startedAt,
			finishedAt,
			payload: await buildCommandOutput({
				command,
				exitCode,
				signal,
				timedOut,
				classification: safety.classification,
				stdout,
				stderr,
				cwd: targetCwd,
				repositoryRoot: absoluteRepoRoot,
				startedAt,
				finishedAt,
				compressionMode,
			}),
			error: {
				code: timedOut ? "COMMAND_TIMEOUT" : "COMMAND_FAILED",
				message,
			},
		};
	}
}

function buildAgentCommandEnvironment(
	workspaceEnvironment: Record<string, string>,
) {
	const base = Object.fromEntries(
		Object.entries(process.env).filter(
			(entry): entry is [string, string] =>
				typeof entry[1] === "string" &&
				!isCredentialFileEnvironmentKey(entry[0]) &&
				!isRegistryCredentialEnvironmentKey(entry[0], entry[1]),
		),
	);
	const safeWorkspaceEnvironment = Object.fromEntries(
		Object.entries(workspaceEnvironment).filter(
			([key, value]) => !isRegistryCredentialEnvironmentKey(key, value),
		),
	);
	return { ...base, ...safeWorkspaceEnvironment };
}

function streamDigest(value: string) {
	return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function emptyCommandOutput(input: {
	command: string;
	classification: string;
	cwd: string;
	repositoryRoot: string;
}): RunCommandOutput {
	return {
		...input,
		exitCode: -1,
		signal: null,
		timedOut: false,
		stdout: "",
		stderr: "",
		stdoutDigest: streamDigest(""),
		stderrDigest: streamDigest(""),
		truncated: false,
	};
}
