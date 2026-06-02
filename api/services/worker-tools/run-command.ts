import { exec } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
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
const MAX_OUTPUT_CHARS = 20000;

async function writeCommandOutputArtifact(input: {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  classification: string;
  startedAt: string;
  finishedAt: string;
}): Promise<string> {
  const dir = path.join(os.tmpdir(), 'nightworkers-command-artifacts');
  await fs.mkdir(dir, { recursive: true });
  const digest = crypto
    .createHash('sha256')
    .update(`${input.startedAt}\n${input.command}\n${input.stdout}\n${input.stderr}`)
    .digest('hex')
    .slice(0, 20);
  const filePath = path.join(dir, `${digest}.json`);
  await fs.writeFile(filePath, JSON.stringify(input, null, 2), 'utf-8');
  return filePath;
}

async function buildCommandOutput(input: {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  classification: string;
  startedAt: string;
  finishedAt: string;
}): Promise<RunCommandOutput> {
  let finalStdout = input.stdout;
  let finalStderr = input.stderr;
  let truncated = false;
  let logArtifactPath: string | undefined;

  if (input.stdout.length > MAX_OUTPUT_CHARS) {
    finalStdout = `${input.stdout.substring(0, MAX_OUTPUT_CHARS)}\n[... stdout truncated by tool limit ...]`;
    truncated = true;
  }
  if (input.stderr.length > MAX_OUTPUT_CHARS) {
    finalStderr = `${input.stderr.substring(0, MAX_OUTPUT_CHARS)}\n[... stderr truncated by tool limit ...]`;
    truncated = true;
  }

  if (truncated) {
    logArtifactPath = await writeCommandOutputArtifact(input);
  }

  return {
    command: input.command,
    exitCode: input.exitCode,
    stdout: finalStdout,
    stderr: finalStderr,
    classification: input.classification,
    truncated,
    logArtifactPath,
  };
}

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
    const finishedAt = new Date().toISOString();

    return {
      ok: true,
      toolName: 'run_command',
      startedAt,
      finishedAt,
      payload: await buildCommandOutput({
        command,
        exitCode: 0,
        classification: safety.classification,
        stdout,
        stderr,
        startedAt,
        finishedAt,
      }),
    };
  } catch (err: any) {
    const exitCode = err.code ?? 1;
    const stdout = err.stdout ?? '';
    const stderr = err.stderr ?? '';
    const finishedAt = new Date().toISOString();

    const message = err.killed
      ? `Command timed out after ${effectiveTimeoutSeconds}s`
      : `Command failed: ${err.message}`;

    return {
      ok: false,
      toolName: 'run_command',
      startedAt,
      finishedAt,
      payload: await buildCommandOutput({
        command,
        exitCode,
        classification: safety.classification,
        stdout,
        stderr,
        startedAt,
        finishedAt,
      }),
      error: {
        code: err.killed ? 'COMMAND_TIMEOUT' : 'COMMAND_FAILED',
        message,
      },
    };
  }
}
