import { runCheckTool } from "./run-check";
import type { RunCommandInput, RunCommandOutput } from "./run-command";
import type { WorkerToolResult } from "./types";

export interface RunVerificationInput extends RunCommandInput {
	reason: string;
	taskId?: string;
	runId?: string;
	verificationDocumentId?: string;
}

export interface RunVerificationOutput extends RunCommandOutput {
	reason: string;
	verified: boolean;
}

export async function runVerificationTool(
	input: RunVerificationInput,
): Promise<WorkerToolResult<RunVerificationOutput>> {
	const startedAt = new Date().toISOString();
	const { reason, ...cmdInput } = input;

	const result = await runCheckTool({
		...cmdInput,
		checkKind: "verify",
		displayMode: "summary",
	});

	const verified = result.ok && result.payload.exitCode === 0;

	return {
		ok: result.ok,
		toolName: "run_verification",
		startedAt,
		finishedAt: new Date().toISOString(),
		payload: {
			command: result.payload.command,
			exitCode: result.payload.exitCode,
			signal: result.payload.signal,
			timedOut: result.payload.timedOut,
			stdout: result.payload.llmSummary,
			stderr: "",
			stdoutDigest: result.payload.stdoutDigest,
			stderrDigest: result.payload.stderrDigest,
			classification: result.payload.classification,
			cwd: result.payload.cwd,
			repositoryRoot: result.payload.repositoryRoot,
			truncated: true,
			compression: result.payload.compression,
			reason,
			verified,
		},
		error: result.error,
		artifactIds: result.artifactIds,
	};
}
