import { exec } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { analyzeCommand } from './command-policy';
import { isPathSafe } from './path-policy';
import type { WorkerToolResult } from './types';

const execAsync = promisify(exec);

export interface RunCommandInput {
  command: string;
  repoRoot: string;
  cwd?: string; // Relative to repoRoot
  timeoutSeconds?: number;
  blockedCommands?: string[];
  allowedPaths?: string[];
  deniedPaths?: string[];
}

export interface RunCommandOutput {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  classification: string;
  truncated: boolean;
  logArtifactPath?: string;
}

export async function runCommandTool(
  input: RunCommandInput
): Promise<WorkerToolResult<RunCommandOutput>> {
  const startedAt = new Date().toISOString();
  const {
    command,
    repoRoot,
    cwd = '',
    timeoutSeconds = 60,
    blockedCommands = [],
    allowedPaths,
    deniedPaths,
  } = input;

  const absoluteRepoRoot = path.resolve(repoRoot);
  const targetCwd = cwd ? path.resolve(absoluteRepoRoot, cwd) : absoluteRepoRoot;

  // 1. Path Safety Check
  if (!isPathSafe(targetCwd, absoluteRepoRoot, allowedPaths, deniedPaths)) {
    return {
      ok: false,
      toolName: 'run_command',
      startedAt,
      finishedAt: new Date().toISOString(),
      payload: {
        command,
        exitCode: -1,
        stdout: '',
        stderr: '',
        classification: 'unknown',
        truncated: false,
      },
      error: {
        code: 'ACCESS_DENIED',
        message: `Command execution working directory is restricted by policy: ${cwd}`,
      },
    };
  }

  // 2. Command Safety Policy Check
  const safety = analyzeCommand(command, blockedCommands);
  if (!safety.allowed) {
    return {
      ok: false,
      toolName: 'run_command',
      startedAt,
      finishedAt: new Date().toISOString(),
      payload: {
        command,
        exitCode: -1,
        stdout: '',
        stderr: '',
        classification: safety.classification,
        truncated: false,
      },
      error: {
        code: 'DESTRUCTIVE_COMMAND',
        message: safety.reason || `Execution of command was blocked by policy: ${command}`,
      },
    };
  }

  try {
    const promise = execAsync(command, {
      cwd: targetCwd,
      timeout: timeoutSeconds * 1000,
      maxBuffer: 50 * 1024 * 1024, // 50MB buffer
    });

    const { stdout, stderr } = await promise;

    // Check outputs size
    const MAX_OUTPUT_CHARS = 20000;
    let finalStdout = stdout;
    let finalStderr = stderr;
    let truncated = false;

    if (stdout.length > MAX_OUTPUT_CHARS) {
      finalStdout = `${stdout.substring(0, MAX_OUTPUT_CHARS)}\n[... stdout truncated by tool limit ...]`;
      truncated = true;
    }
    if (stderr.length > MAX_OUTPUT_CHARS) {
      finalStderr = `${stderr.substring(0, MAX_OUTPUT_CHARS)}\n[... stderr truncated by tool limit ...]`;
      truncated = true;
    }

    return {
      ok: true,
      toolName: 'run_command',
      startedAt,
      finishedAt: new Date().toISOString(),
      payload: {
        command,
        exitCode: 0,
        stdout: finalStdout,
        stderr: finalStderr,
        classification: safety.classification,
        truncated,
      },
    };
  } catch (err: any) {
    const exitCode = err.code ?? 1;
    const stdout = err.stdout ?? '';
    const stderr = err.stderr ?? '';

    // Check outputs size
    const MAX_OUTPUT_CHARS = 20000;
    let finalStdout = stdout;
    let finalStderr = stderr;
    let truncated = false;

    if (stdout.length > MAX_OUTPUT_CHARS) {
      finalStdout = `${stdout.substring(0, MAX_OUTPUT_CHARS)}\n[... stdout truncated by tool limit ...]`;
      truncated = true;
    }
    if (stderr.length > MAX_OUTPUT_CHARS) {
      finalStderr = `${stderr.substring(0, MAX_OUTPUT_CHARS)}\n[... stderr truncated by tool limit ...]`;
      truncated = true;
    }

    const message = err.killed
      ? `Command timed out after ${timeoutSeconds}s`
      : `Command failed: ${err.message}`;

    return {
      ok: false,
      toolName: 'run_command',
      startedAt,
      finishedAt: new Date().toISOString(),
      payload: {
        command,
        exitCode,
        stdout: finalStdout,
        stderr: finalStderr,
        classification: safety.classification,
        truncated,
      },
      error: {
        code: err.killed ? 'COMMAND_TIMEOUT' : 'COMMAND_FAILED',
        message,
      },
    };
  }
}
