import { exec } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { analyzeCommand } from './command-policy';
import {
  enforceCommandPolicy,
  enforcePathPolicy,
  resolveCommandTimeout,
} from './tool-policy-enforcer';
import type { WorkerToolResult } from './types';

const execAsync = promisify(exec);

export interface RunCommandInput {
  command: string;
  repoRoot: string;
  cwd?: string; // Relative to repoRoot
  timeoutSeconds?: number;
  maxCommandSeconds?: number;
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
    maxCommandSeconds,
    blockedCommands = [],
    allowedPaths,
    deniedPaths,
  } = input;

  const absoluteRepoRoot = path.resolve(repoRoot);
  const targetCwd = cwd ? path.resolve(absoluteRepoRoot, cwd) : absoluteRepoRoot;

  // 1. Path Safety Check
  const pathDecision = enforcePathPolicy(targetCwd, {
    repoRoot: absoluteRepoRoot,
    allowedPaths,
    deniedPaths,
  });
  if (!pathDecision.allowed) {
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
        message:
          pathDecision.message ||
          `Command execution working directory is restricted by policy: ${cwd}`,
      },
    };
  }

  // 2. Command Safety Policy Check
  const cmdDecision = enforceCommandPolicy(command, {
    repoRoot: absoluteRepoRoot,
    blockedCommands,
  });
  const safety = analyzeCommand(command, blockedCommands);
  if (!cmdDecision.allowed) {
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
        code: 'DESTRUCTIVE_COMMAND',
        message: cmdDecision.message || `Execution of command was blocked by policy: ${command}`,
      },
    };
  }

  const effectiveTimeoutSeconds = resolveCommandTimeout(timeoutSeconds, {
    repoRoot: absoluteRepoRoot,
    blockedCommands,
    allowedPaths,
    deniedPaths,
    maxCommandSeconds,
  });

  try {
    const promise = execAsync(command, {
      cwd: targetCwd,
      timeout: effectiveTimeoutSeconds * 1000,
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
      ? `Command timed out after ${effectiveTimeoutSeconds}s`
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
