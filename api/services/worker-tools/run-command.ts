import { exec } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { toDeepRecord } from '../../../shared/json-record';
import { analyzeCommand } from './command-policy';
import { compressCommandStream, type ToolOutputCompressionMetadata } from './output-compression';
import {
  enforceCommandPolicy,
  enforcePathPolicy,
  resolveCommandTimeout,
} from './tool-policy-enforcer';
import type { WorkerToolResult } from './types';

const execAsync = promisify(exec);
const MAX_OUTPUT_CHARS = 20000;
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
  compressionMode?: 'auto' | 'off';
}): Promise<RunCommandOutput> {
  const shouldCompress =
    input.compressionMode !== 'off' &&
    (input.stdout.length > MAX_OUTPUT_CHARS || input.stderr.length > MAX_OUTPUT_CHARS);
  const logArtifactPath = shouldCompress ? await writeCommandOutputArtifact(input) : undefined;

  if (!shouldCompress) {
    return {
      command: input.command,
      exitCode: input.exitCode,
      stdout: input.stdout,
      stderr: input.stderr,
      classification: input.classification,
      truncated: false,
    };
  }

  const stdoutCompression = compressCommandStream({
    streamName: 'stdout',
    content: input.stdout,
    command: input.command,
    exitCode: input.exitCode,
    artifactPath: logArtifactPath,
  });
  const stderrCompression = compressCommandStream({
    streamName: 'stderr',
    content: input.stderr,
    command: input.command,
    exitCode: input.exitCode,
    artifactPath: logArtifactPath,
  });

  const compression: RunCommandOutput['compression'] = {};
  if (stdoutCompression.compression) compression.stdout = stdoutCompression.compression;
  if (stderrCompression.compression) compression.stderr = stderrCompression.compression;

  return {
    command: input.command,
    exitCode: input.exitCode,
    stdout: stdoutCompression.content,
    stderr: stderrCompression.content,
    classification: input.classification,
    truncated: stdoutCompression.truncated || stderrCompression.truncated,
    logArtifactPath,
    compression: compression.stdout || compression.stderr ? compression : undefined,
  };
}

export interface RunCommandInput {
  command: string;
  repoRoot: string;
  cwd?: string; // Relative to repoRoot
  timeoutSeconds?: number;
  maxCommandSeconds?: number;
  compressionMode?: 'auto' | 'off';
  blockedCommands?: string[];
  allowedPaths?: string[];
  externalAllowedPaths?: string[];
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
  compression?: {
    stdout?: ToolOutputCompressionMetadata;
    stderr?: ToolOutputCompressionMetadata;
  };
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
    compressionMode = 'off',
    blockedCommands = [],
    allowedPaths,
    externalAllowedPaths,
    deniedPaths,
  } = input;

  const absoluteRepoRoot = path.resolve(repoRoot);
  const targetCwd = cwd ? path.resolve(absoluteRepoRoot, cwd) : absoluteRepoRoot;

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
    externalAllowedPaths,
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
  if (safety.classification === 'background') {
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
        code: 'BACKGROUND_COMMAND_REQUIRED',
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
    const promise = execAsync(command, {
      cwd: targetCwd,
      timeout: effectiveTimeoutSeconds * 1000,
      maxBuffer: MAX_EXEC_BUFFER_BYTES,
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
        compressionMode,
      }),
    };
  } catch (err) {
    const error = toDeepRecord(err);
    const exitCode = typeof error.code === 'number' ? error.code : 1;
    const stdout = typeof error.stdout === 'string' ? error.stdout : '';
    const stderr = typeof error.stderr === 'string' ? error.stderr : '';
    const finishedAt = new Date().toISOString();

    const message = error.killed
      ? `Command timed out after ${effectiveTimeoutSeconds}s`
      : `Command failed: ${String(error.message || err)}`;

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
        compressionMode,
      }),
      error: {
        code: error.killed ? 'COMMAND_TIMEOUT' : 'COMMAND_FAILED',
        message,
      },
    };
  }
}
