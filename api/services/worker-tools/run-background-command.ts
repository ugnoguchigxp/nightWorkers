import { unknownErrorMessage } from '../../../shared/json-record';
import { startBackgroundCommand } from '../background-processes';
import type { WorkerToolResult } from './types';

export interface RunBackgroundCommandInput {
  command: string;
  repoRoot: string;
  cwd?: string;
  repositoryId?: string;
  taskId?: string;
  runId?: string;
  blockedCommands?: string[];
  allowedPaths?: string[];
  externalAllowedPaths?: string[];
  deniedPaths?: string[];
}

export interface RunBackgroundCommandOutput {
  backgroundProcessId: string;
  command: string;
  cwd: string;
  status: string;
  pid?: number | null;
}

export async function runBackgroundCommandTool(
  input: RunBackgroundCommandInput
): Promise<WorkerToolResult<RunBackgroundCommandOutput>> {
  const startedAt = new Date().toISOString();
  try {
    const processRecord = await startBackgroundCommand(input);
    return {
      ok: true,
      toolName: 'run_background_command',
      startedAt,
      finishedAt: new Date().toISOString(),
      payload: {
        backgroundProcessId: processRecord.id,
        command: processRecord.command,
        cwd: processRecord.cwd,
        status: processRecord.status,
        pid: processRecord.pid,
      },
    };
  } catch (err) {
    return {
      ok: false,
      toolName: 'run_background_command',
      startedAt,
      finishedAt: new Date().toISOString(),
      payload: {
        backgroundProcessId: '',
        command: input.command,
        cwd: input.cwd || '',
        status: 'failed',
        pid: null,
      },
      error: {
        code: 'BACKGROUND_COMMAND_FAILED',
        message: unknownErrorMessage(err, 'Background command failed.'),
      },
    };
  }
}
