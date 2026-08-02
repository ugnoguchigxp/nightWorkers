import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type {
	ExpectedEvidence,
	VerificationRunner,
} from "../../../shared/schemas/verification-checklist.schema";
import { AppError } from "../../lib/errors";
import {
	isAutomatedEvidenceKind,
	resolveExecutionCaseIdentities,
	runCompletionCheck,
	validateRunCheckEvidenceScope,
} from "../../modules/codingAgent";
import { getLatestActiveVerificationDocumentForTask } from "../../modules/nightworkers/nightworkers.verification.repository";
import { recordVerificationEvidence } from "../../modules/nightworkers/nightworkers.verification.service";
import { parseJUnitXmlCases } from "../verification/adapters/junit";
import { parseVitestJsonCases } from "../verification/adapters/vitest-json";
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
	evidenceKinds?: ExpectedEvidence[];
	displayMode?: "summary" | "error_excerpt" | "full";
	captureMode?: "full";
	runnerHint?: VerificationRunner;
}

export interface RunCheckOutput extends RunCommandOutput {
	checkKind: RunCheckKind;
	managedEvidence: boolean;
	llmSummary: string;
	rawStdoutArtifactId: string;
	rawStderrArtifactId: string;
	verificationDocumentId?: string | null;
	evidenceRunId?: string;
	evidenceKinds: ExpectedEvidence[];
	structuredCaseCount: number;
	resolvedCaseCount: number;
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
	const verificationDocumentId =
		input.verificationDocumentId ||
		(input.taskId
			? (await getLatestActiveVerificationDocumentForTask(input.taskId))?.id
			: null);
	const command = await resolveRunCheckCommand(input);
	let runner = await resolveRunCheckRunner(input, command);
	const evidenceKinds = normalizeRunCheckEvidenceKinds(input, runner);
	if (input.taskId && verificationDocumentId) {
		await validateRunCheckEvidenceScope({
			taskId: input.taskId,
			runId: input.runId,
			verificationDocumentId,
			conditionIds: input.conditionIds ?? [],
			evidenceKinds,
			checkKind: input.checkKind,
		});
	}
	const sourceSnapshotBefore =
		input.taskId && input.runId
			? await captureWorkspaceSnapshot(input.repoRoot)
			: undefined;
	const commandResult = await runCommandTool({
		...input,
		command,
		compressionMode: "off",
	});
	const finishedAt = commandResult.finishedAt;
	const payload = commandResult.payload;
	const rawStdoutArtifactId = createCheckStreamDigest({
		stream: "stdout",
		command,
		content: payload.stdout,
	});
	const rawStderrArtifactId = createCheckStreamDigest({
		stream: "stderr",
		command,
		content: payload.stderr,
	});
	const junitCases =
		/<testsuites?\b/i.test(payload.stdout) ||
		/<testsuites?\b/i.test(payload.stderr)
			? parseJUnitXmlCases(`${payload.stdout}\n${payload.stderr}`)
			: [];
	const resolvedCwd = path.resolve(input.repoRoot, input.cwd || "");
	const evidenceCwd = await fs.realpath(resolvedCwd).catch(() => resolvedCwd);
	const automatedEvidenceKind = evidenceKinds.find(isAutomatedEvidenceKind);
	const vitestCases =
		junitCases.length === 0
			? parseVitestJsonCases({
					text: payload.stdout,
					evidenceKind: automatedEvidenceKind,
				})
			: [];
	if (vitestCases.length > 0 && runner === "unknown") runner = "vitest";
	const parsedCases =
		junitCases.length > 0
			? junitCases.map((testCase) => ({
					...testCase,
					runner,
					...(automatedEvidenceKind
						? { evidenceKind: automatedEvidenceKind }
						: {}),
				}))
			: vitestCases;
	const resolvedCases =
		input.taskId && input.runId && sourceSnapshotBefore
			? await resolveExecutionCaseIdentities({
					taskId: input.taskId,
					runId: input.runId,
					sourceStateHash: sourceSnapshotBefore.sourceStateHash,
					evidenceCwd,
					runner,
					evidenceKinds,
					cases: parsedCases,
				})
			: parsedCases;
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
					runner,
					rawStdoutArtifactId,
					rawStderrArtifactId,
					conditionIds: input.conditionIds,
					cases: resolvedCases,
					evidenceKinds,
				})
			: null;
	if (evidence && sourceSnapshotBefore) {
		const sourceSnapshotAfter = await captureWorkspaceSnapshot(input.repoRoot);
		evidence.sourceSnapshot = sourceSnapshotBefore;
		evidence.sourceMutatedDuringCheck =
			sourceSnapshotBefore.sourceStateHash !==
			sourceSnapshotAfter.sourceStateHash;
		evidence.testExecutionObserved =
			resolvedCases.length > 0 ||
			(payload.classification === "build_test" &&
				(input.checkKind === "test" || input.checkKind === "coverage"));
	}
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
			evidenceKinds,
			structuredCaseCount: parsedCases.length,
			resolvedCaseCount: resolvedCases.filter((testCase) => testCase.caseKey)
				.length,
			checklist: recorded?.checklist
				? {
						complete: recorded.checklist.complete,
						failedRequired: recorded.checklist.failedRequired.length,
						unknownRequired: recorded.checklist.unknownRequired.length,
					}
				: null,
		},
		error: commandResult.error,
		artifactIds: [],
	};
}

async function captureWorkspaceSnapshot(repoRoot: string) {
	const { captureWorkspaceSourceSnapshot } = await import(
		"../../modules/codingAgent"
	);
	return captureWorkspaceSourceSnapshot(repoRoot);
}

export async function completionCheckTool(
	input: {
		taskId: string;
		runId: string;
		verificationDocumentId?: string;
		repoRoot?: string;
	},
	dependencies: { runCompletionCheck: typeof runCompletionCheck } = {
		runCompletionCheck,
	},
): Promise<WorkerToolResult<CompletionCheckOutput | null>> {
	const startedAt = new Date().toISOString();
	let result: Awaited<ReturnType<typeof runCompletionCheck>>;
	try {
		result = await dependencies.runCompletionCheck({
			...input,
			confirmEvidenceCheck: true,
		});
	} catch (error) {
		return completionCheckFailure(startedAt, error);
	}
	const llmSummary = result.ok
		? [
				"READY completion_check",
				`assurance=${result.assurance.status}`,
				`mapping=${result.mapping.status}`,
				`verify=${result.verify.status}`,
				`confirmation=${result.confirmation.status}`,
				"next=write_final_report",
			].join("\n")
		: [
				"NOT_READY completion_check",
				`reason=${result.reason || "unknown"}`,
				`assurance=${result.assurance.status}`,
				`mapping=${result.mapping.status} (${result.mapping.matched}/${result.mapping.total})`,
				`verify=${result.verify.status}`,
				`confirmation=${result.confirmation.status}`,
				`next=${result.suggestedAction}`,
			].join("\n");
	return {
		ok: true,
		toolName: "completion_check",
		startedAt,
		finishedAt: new Date().toISOString(),
		payload: { llmSummary, result },
	};
}

function completionCheckFailure(
	startedAt: string,
	error: unknown,
): WorkerToolResult<null> {
	const appError = error instanceof AppError ? error : null;
	const retryable = appError?.details?.retryable === true;
	return {
		ok: false,
		toolName: "completion_check",
		startedAt,
		finishedAt: new Date().toISOString(),
		payload: null,
		error: {
			code: appError?.code ?? "COMPLETION_CHECK_EXECUTION_FAILED",
			message: error instanceof Error ? error.message : String(error),
			retryable,
			...(retryable
				? { recoveryAction: "同じcompletion_checkを再実行してください。" }
				: {}),
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

function createCheckStreamDigest(input: {
	stream: "stdout" | "stderr";
	command: string;
	content: string;
}) {
	return `sha256:${crypto
		.createHash("sha256")
		.update([input.stream, input.command, input.content].join("\n"))
		.digest("hex")}`;
}

function normalizeRunCheckEvidenceKinds(
	input: RunCheckInput,
	runner: ReturnType<typeof inferVerificationRunner>,
): ExpectedEvidence[] {
	if (input.evidenceKinds?.length) {
		return Array.from(new Set(input.evidenceKinds));
	}
	if (input.checkKind === "lint") return ["lint"];
	if (input.checkKind === "format_check") return ["format_check"];
	if (input.checkKind === "typecheck") return ["typecheck"];
	if (input.checkKind === "coverage") return ["coverage"];
	if (input.checkKind === "build") return ["build"];
	if (input.checkKind === "test") {
		return runner === "playwright" ? ["e2e_test"] : ["automated_test"];
	}
	return [];
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

export async function resolveRunCheckRunner(
	input: RunCheckInput,
	resolvedCommand: string,
) {
	const scriptName = resolveRunCheckScriptName(
		input.command.trim(),
		input.checkKind,
	);
	const packageJson = scriptName
		? await readPackageJson(input.repoRoot, input.cwd)
		: null;
	const scriptCommand = scriptName ? packageJson?.scripts?.[scriptName] : null;
	return inferVerificationRunner({
		command: [input.command, resolvedCommand, scriptCommand]
			.filter((value): value is string => Boolean(value))
			.join("\n"),
		runnerHint: input.runnerHint,
	});
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
