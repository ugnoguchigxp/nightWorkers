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
	resolveExecutionCaseIdentityDetails,
	resolveRunCheckEvidenceScope,
} from "../../modules/codingAgent";
import { getLatestActiveVerificationDocumentForTask } from "../../modules/nightworkers/nightworkers.verification.repository";
import { recordVerificationEvidence } from "../../modules/nightworkers/nightworkers.verification.service";
import {
	buildCommandLevelEvidence,
	inferVerificationRunner,
} from "../verification/normalized-evidence";
import {
	addStructuredReporter,
	createParsedArtifactDigest,
	evaluateStructuredTestCapture,
	parseStructuredTestArtifact,
	resolveManagedTestRunner,
} from "./run-check-structured-capture";
import {
	type RunCommandInput,
	type RunCommandOutput,
	runCommandTool,
} from "./run-command";
import type { WorkerToolResult } from "./types";

export { addStructuredReporter } from "./run-check-structured-capture";

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
	status: "passed" | "failed" | "evidence_error";
	reason?: string;
	retryable?: boolean;
	checklist?: {
		complete: boolean;
		failedRequired: number;
		unknownRequired: number;
	} | null;
}

export {
	type CompletionCheckOutput,
	completionCheckTool,
} from "./completion-check";

export async function runCheckTool(
	input: RunCheckInput,
): Promise<WorkerToolResult<RunCheckOutput>> {
	const startedAt = new Date().toISOString();
	try {
		return await runCheckToolInternal(input, startedAt);
	} catch (error) {
		if (!(error instanceof AppError)) throw error;
		const finishedAt = new Date().toISOString();
		const resolvedCwd = path.resolve(input.repoRoot, input.cwd || "");
		const retryable = error.details?.retryable === true;
		const status =
			error.code === "TEST_EVIDENCE_CAPTURE_FAILED" ||
			error.code === "TEST_IDENTITY_AMBIGUOUS"
				? "evidence_error"
				: "failed";
		return {
			ok: false,
			toolName: "run_check",
			startedAt,
			finishedAt,
			payload: {
				command: input.command,
				exitCode: -1,
				signal: null,
				timedOut: false,
				stdout: "",
				stderr: "",
				stdoutDigest: createCheckStreamDigest({
					stream: "stdout",
					command: input.command,
					content: "",
				}),
				stderrDigest: createCheckStreamDigest({
					stream: "stderr",
					command: input.command,
					content: "",
				}),
				classification: "precondition_rejected",
				cwd: resolvedCwd,
				repositoryRoot: path.resolve(input.repoRoot),
				truncated: false,
				checkKind: input.checkKind,
				managedEvidence: false,
				llmSummary: `ERROR ${input.checkKind}\nerrorCode=${error.code}`,
				rawStdoutArtifactId: createCheckStreamDigest({
					stream: "stdout",
					command: input.command,
					content: "",
				}),
				rawStderrArtifactId: createCheckStreamDigest({
					stream: "stderr",
					command: input.command,
					content: "",
				}),
				verificationDocumentId: input.verificationDocumentId ?? null,
				evidenceKinds: [],
				structuredCaseCount: 0,
				resolvedCaseCount: 0,
				checklist: null,
				status,
				reason: error.code,
				retryable,
			},
			error: {
				code: error.code,
				message: error.message,
				retryable,
				...(typeof error.details?.suggestedAction === "string"
					? { recoveryAction: error.details.suggestedAction }
					: {}),
			},
		};
	}
}

async function runCheckToolInternal(
	input: RunCheckInput,
	startedAt: string,
): Promise<WorkerToolResult<RunCheckOutput>> {
	const verificationDocumentId =
		input.verificationDocumentId ||
		(input.taskId
			? (await getLatestActiveVerificationDocumentForTask(input.taskId))?.id
			: null);
	const requestedCommand = await resolveRunCheckCommand(input);
	const sourceSnapshotBefore =
		input.taskId && (input.runId || verificationDocumentId)
			? await captureWorkspaceSnapshot(input.repoRoot)
			: undefined;
	let runner = await resolveRunCheckRunner(input, requestedCommand);
	let evidenceKinds = normalizeRunCheckEvidenceKinds(input, runner);
	let conditionIds = input.conditionIds ?? [];
	let caseScopes: Record<
		string,
		{
			conditionIds: string[];
			evidenceKind?:
				| "automated_test"
				| "unit_test"
				| "integration_test"
				| "e2e_test";
		}
	> = {};
	let mappedCaseKeys: string[] = [];
	let inventoryId: string | undefined;
	if (input.taskId && verificationDocumentId && sourceSnapshotBefore) {
		const scope = await resolveRunCheckEvidenceScope({
			taskId: input.taskId,
			runId: input.runId,
			verificationDocumentId,
			command: requestedCommand,
			declaredCommand: input.command.trim(),
			cwd: input.cwd,
			repoRoot: input.repoRoot,
			checkKind: input.checkKind,
			sourceStateHash: sourceSnapshotBefore.sourceStateHash,
		});
		conditionIds = scope.conditionIds;
		evidenceKinds = scope.evidenceKinds;
		caseScopes = scope.caseScopes;
		mappedCaseKeys = scope.mappedCaseKeys;
		inventoryId = scope.inventoryId ?? undefined;
		if (input.checkKind === "test") {
			runner = resolveManagedTestRunner(runner, scope.runner);
		}
	}
	const command =
		input.checkKind === "test" && mappedCaseKeys.length > 0
			? addStructuredReporter(requestedCommand, runner)
			: requestedCommand;
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
	const resolvedCwd = path.resolve(input.repoRoot, input.cwd || "");
	const evidenceCwd = await fs.realpath(resolvedCwd).catch(() => resolvedCwd);
	const automatedEvidenceKind = evidenceKinds.find(isAutomatedEvidenceKind);
	const structuredArtifact = parseStructuredTestArtifact({
		command,
		runner,
		stdout: payload.stdout,
		stderr: payload.stderr,
		evidenceKind: automatedEvidenceKind,
	});
	runner = structuredArtifact.runner;
	const parsedCases = structuredArtifact.cases;
	const identityResolution =
		input.taskId && input.runId && sourceSnapshotBefore
			? await resolveExecutionCaseIdentityDetails({
					taskId: input.taskId,
					runId: input.runId,
					sourceStateHash: sourceSnapshotBefore.sourceStateHash,
					evidenceCwd,
					runner,
					evidenceKinds,
					cases: parsedCases,
					caseScopes,
					inventoryId,
				})
			: {
					cases: parsedCases,
					inventoryId: null,
					ambiguousMappedCaseKeys: [],
					mismatchedMappedCaseKeys: [],
				};
	const resolvedCases = identityResolution.cases;
	const parsedArtifactId = structuredArtifact.recognized
		? createParsedArtifactDigest({
				command,
				format: structuredArtifact.format ?? "vitest-json",
				stdout: payload.stdout,
				stderr: payload.stderr,
			})
		: undefined;
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
					conditionIds,
					cases: resolvedCases,
					evidenceKinds,
					parsedArtifactId,
				})
			: null;
	if (evidence && sourceSnapshotBefore) {
		const sourceSnapshotAfter = await captureWorkspaceSnapshot(input.repoRoot);
		evidence.sourceSnapshot = sourceSnapshotBefore;
		evidence.sourceMutatedDuringCheck =
			sourceSnapshotBefore.sourceStateHash !==
			sourceSnapshotAfter.sourceStateHash;
		evidence.testExecutionObserved = parsedCases.length > 0;
	}
	const captureFailure = evaluateStructuredTestCapture({
		managedTest:
			input.checkKind === "test" &&
			mappedCaseKeys.length > 0 &&
			shouldRecordRunCheckEvidence(commandResult),
		commandExitCode: payload.exitCode,
		recognized: structuredArtifact.recognized,
		mappedCaseKeys,
		resolvedCases,
		ambiguousMappedCaseKeys: identityResolution.ambiguousMappedCaseKeys,
		mismatchedMappedCaseKeys: identityResolution.mismatchedMappedCaseKeys,
	});
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
	const error = captureFailure
		? {
				code: captureFailure.reason,
				message: captureFailure.message,
				retryable: false,
				recoveryAction: captureFailure.suggestedAction,
			}
		: commandResult.error;
	return {
		ok: commandResult.ok && !captureFailure,
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
			status: captureFailure
				? captureFailure.status
				: payload.exitCode === 0
					? "passed"
					: "failed",
			...(captureFailure
				? { reason: captureFailure.reason, retryable: false }
				: {}),
		},
		error,
		artifactIds: [],
	};
}

async function captureWorkspaceSnapshot(repoRoot: string) {
	const { captureWorkspaceSourceSnapshot } = await import(
		"../../modules/codingAgent"
	);
	return captureWorkspaceSourceSnapshot(repoRoot);
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
		const uniqueKinds = Array.from(new Set(input.evidenceKinds));
		const specificAutomatedKinds = uniqueKinds.filter(
			(kind) => isAutomatedEvidenceKind(kind) && kind !== "automated_test",
		);
		if (specificAutomatedKinds.length > 1) {
			throw new AppError(
				400,
				"AMBIGUOUS_AUTOMATED_EVIDENCE_KIND",
				"1回のrun_checkにはunit_test、integration_test、e2e_testのいずれか1種だけを指定してください。",
				{ evidenceKinds: uniqueKinds },
			);
		}
		if (specificAutomatedKinds.length === 1) {
			return uniqueKinds.filter((kind) => kind !== "automated_test");
		}
		return uniqueKinds;
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
