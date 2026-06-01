import { type RunCommandInput, type RunCommandOutput, runCommandTool } from './run-command';
import type { WorkerToolResult } from './types';

export interface RunVerificationInput extends RunCommandInput {
  reason: string;
}

export interface RunVerificationOutput extends RunCommandOutput {
  reason: string;
  verified: boolean;
}

export async function runVerificationTool(
  input: RunVerificationInput
): Promise<WorkerToolResult<RunVerificationOutput>> {
  const startedAt = new Date().toISOString();
  const { reason, ...cmdInput } = input;

  const result = await runCommandTool(cmdInput);

  const verified = result.ok && result.payload.exitCode === 0;

  return {
    ok: result.ok,
    toolName: 'run_verification',
    startedAt,
    finishedAt: new Date().toISOString(),
    payload: {
      ...result.payload,
      reason,
      verified,
    },
    error: result.error,
    artifactIds: result.artifactIds,
  };
}
