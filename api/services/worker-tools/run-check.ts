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
	const commandResult = await runCommandTool({
		...input,
		compressionMode: "off",
	});
	const finishedAt = commandResult.finishedAt;
	const payload = commandResult.payload;
	const rawStdoutArtifactId = await writeRawCheckArtifact({
		stream: "stdout",
		command: input.command,
		content: payload.stdout,
		startedAt,
		finishedAt,
	});
	const rawStderrArtifactId = await writeRawCheckArtifact({
		stream: "stderr",
		command: input.command,
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
	const evidence =
		input.taskId && input.runId
			? buildCommandLevelEvidence({
					runId: input.runId,
					taskId: input.taskId,
					command: input.command,
					cwd: input.cwd || ".",
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
		rawStdoutArtifactId,
		rawStderrArtifactId,
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
	rawStdoutArtifactId: string;
	rawStderrArtifactId: string;
}) {
	if (input.exitCode === 0) {
		return [
			`OK ${input.checkKind}`,
			`exitCode=0`,
			`stdoutArtifact=${input.rawStdoutArtifactId}`,
			`stderrArtifact=${input.rawStderrArtifactId}`,
		].join("\n");
	}
	const excerpt = `${input.stderr}\n${input.stdout}`
		.split("\n")
		.map((line) => line.trimEnd())
		.filter(Boolean)
		.slice(0, 24)
		.join("\n");
	return [
		`ERROR ${input.checkKind}`,
		`exitCode=${input.exitCode}`,
		`stdoutArtifact=${input.rawStdoutArtifactId}`,
		`stderrArtifact=${input.rawStderrArtifactId}`,
		excerpt,
	]
		.filter(Boolean)
		.join("\n");
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
