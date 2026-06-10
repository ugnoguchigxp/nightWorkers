import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { backgroundProcesses, repositories, taskRuns, tasks } from '../../db/schema';
import {
  appendActivityArtifact,
  appendActivityEvent,
} from '../../modules/nightworkers/nightworkers.activity.repository';
import { analyzeCommand } from '../worker-tools/command-policy';
import { enforceCommandPolicy, enforcePathPolicy } from '../worker-tools/tool-policy-enforcer';

const MAX_LATEST_OUTPUT_CHARS = 12_000;
const MAX_ACTIVITY_OUTPUT_CHARS = 40_000;

type ManagedProcess = {
  child: ChildProcessWithoutNullStreams;
  output: string;
};

const managedProcesses = new Map<string, ManagedProcess>();

export type BackgroundProcessStatus = 'running' | 'completed' | 'failed' | 'stopped' | 'lost';

export type StartBackgroundCommandInput = {
  command: string;
  repoRoot: string;
  cwd?: string;
  repositoryId?: string;
  taskId?: string;
  runId?: string;
  allowedPaths?: string[];
  externalAllowedPaths?: string[];
  deniedPaths?: string[];
  blockedCommands?: string[];
};

function tail(value: string, maxChars = MAX_LATEST_OUTPUT_CHARS) {
  if (value.length <= maxChars) return value;
  return value.slice(value.length - maxChars);
}

function summarizeOutput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return tail(trimmed, 1200);
}

async function resolveOwnership(input: { repositoryId?: string; taskId?: string; runId?: string }) {
  if (input.runId) {
    const [run] = await db.select().from(taskRuns).where(eq(taskRuns.id, input.runId));
    if (!run) throw new Error('Run not found');
    if (run.repositoryId) {
      return { repositoryId: run.repositoryId, taskId: run.taskId, runId: run.id };
    }
    const [task] = await db.select().from(tasks).where(eq(tasks.id, run.taskId));
    if (!task) throw new Error('Task not found for run');
    return { repositoryId: task.repositoryId, taskId: task.id, runId: run.id };
  }

  if (input.taskId) {
    const [task] = await db.select().from(tasks).where(eq(tasks.id, input.taskId));
    if (!task) throw new Error('Task not found');
    return { repositoryId: task.repositoryId, taskId: task.id, runId: input.runId };
  }

  if (input.repositoryId) {
    const [repository] = await db
      .select()
      .from(repositories)
      .where(eq(repositories.id, input.repositoryId));
    if (!repository) throw new Error('Repository not found');
    return { repositoryId: repository.id, taskId: null, runId: null };
  }

  throw new Error('Background command requires repositoryId, taskId, or runId.');
}

async function appendBackgroundActivity(input: {
  taskId?: string | null;
  runId?: string | null;
  kind: string;
  status: string;
  text: string;
  artifactId?: string | null;
  payloadJson?: Record<string, unknown>;
}) {
  if (!input.taskId) return null;
  return appendActivityEvent({
    taskId: input.taskId,
    runId: input.runId ?? null,
    kind: input.kind,
    source: 'tool',
    status: input.status,
    text: input.text,
    artifactId: input.artifactId ?? null,
    payloadJson: input.payloadJson,
  });
}

async function markFinished(input: {
  id: string;
  status: BackgroundProcessStatus;
  exitCode?: number | null;
  signal?: string | null;
  stopReason?: string | null;
  output: string;
}) {
  const [updated] = await db
    .update(backgroundProcesses)
    .set({
      status: input.status,
      exitCode: input.exitCode ?? null,
      signal: input.signal ?? null,
      stopReason: input.stopReason ?? null,
      latestOutput: tail(input.output),
      endedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(backgroundProcesses.id, input.id))
    .returning();
  if (!updated) return null;

  let artifactId: string | null = null;
  if (updated.taskId && input.output.trim()) {
    const artifact = await appendActivityArtifact({
      taskId: updated.taskId,
      runId: updated.runId,
      kind: 'background_command_output',
      contentText: tail(input.output, MAX_ACTIVITY_OUTPUT_CHARS),
      metadataJson: {
        backgroundProcessId: updated.id,
        command: updated.command,
        status: input.status,
      },
    });
    artifactId = artifact.id;
    await db
      .update(backgroundProcesses)
      .set({ outputArtifactId: artifact.id, updatedAt: new Date() })
      .where(eq(backgroundProcesses.id, input.id));
  }

  await appendBackgroundActivity({
    taskId: updated.taskId,
    runId: updated.runId,
    kind: input.status === 'failed' || input.status === 'lost' ? 'tool.error' : 'tool.result',
    status: input.status === 'failed' || input.status === 'lost' ? 'failed' : 'completed',
    text:
      input.status === 'stopped'
        ? `Background command stopped: ${updated.command}`
        : `Background command ${input.status}: ${updated.command}`,
    artifactId,
    payloadJson: {
      workRecordCard: {
        type: input.status === 'failed' || input.status === 'lost' ? 'failure' : 'command',
        executionMode: 'background',
      },
      backgroundProcessId: updated.id,
      command: updated.command,
      cwd: updated.cwd,
      status: input.status,
      exitCode: input.exitCode ?? null,
      signal: input.signal ?? null,
      stopReason: input.stopReason ?? null,
      outputSummary: summarizeOutput(input.output),
    },
  });

  return updated;
}

async function reconcileLostProcesses() {
  const running = await db
    .select()
    .from(backgroundProcesses)
    .where(eq(backgroundProcesses.status, 'running'));
  for (const processRecord of running) {
    if (managedProcesses.has(processRecord.id)) continue;
    await markFinished({
      id: processRecord.id,
      status: 'lost',
      stopReason: 'api_process_restarted_or_tracking_lost',
      output: processRecord.latestOutput || '',
    });
  }
}

export async function startBackgroundCommand(input: StartBackgroundCommandInput) {
  const startedAt = new Date();
  const repoRoot = path.resolve(input.repoRoot);
  const targetCwd = input.cwd ? path.resolve(repoRoot, input.cwd) : repoRoot;
  const ownership = await resolveOwnership(input);

  const pathDecision = enforcePathPolicy(targetCwd, {
    repoRoot,
    allowedPaths: input.allowedPaths,
    externalAllowedPaths: input.externalAllowedPaths,
    deniedPaths: input.deniedPaths,
  });
  if (!pathDecision.allowed) {
    throw new Error(pathDecision.message || `Background command cwd denied: ${input.cwd || ''}`);
  }

  const commandDecision = enforceCommandPolicy(input.command, {
    repoRoot,
    blockedCommands: input.blockedCommands,
  });
  const safety = analyzeCommand(input.command, input.blockedCommands);
  if (!commandDecision.allowed) {
    throw new Error(commandDecision.message || `Background command blocked: ${input.command}`);
  }
  if (safety.classification !== 'background') {
    throw new Error(`Command is not classified as background-safe: ${input.command}`);
  }

  const id = crypto.randomUUID();
  const [created] = await db
    .insert(backgroundProcesses)
    .values({
      id,
      repositoryId: ownership.repositoryId,
      taskId: ownership.taskId,
      runId: ownership.runId,
      command: input.command,
      cwd: input.cwd || '',
      status: 'running',
      pid: null,
      startedAt,
      latestOutput: '',
      metadataJson: { classification: safety.classification },
    })
    .returning();

  const child = spawn(input.command, {
    cwd: targetCwd,
    shell: true,
    detached: true,
    stdio: 'pipe',
  });
  child.unref();

  await db
    .update(backgroundProcesses)
    .set({ pid: child.pid ?? null, updatedAt: new Date() })
    .where(eq(backgroundProcesses.id, id));
  created.pid = child.pid ?? null;

  const managed: ManagedProcess = { child, output: '' };
  managedProcesses.set(id, managed);

  await appendBackgroundActivity({
    taskId: created.taskId,
    runId: created.runId,
    kind: 'tool.call',
    status: 'started',
    text: `Background command started: ${created.command}`,
    payloadJson: {
      workRecordCard: { type: 'command', executionMode: 'background' },
      backgroundProcessId: id,
      command: created.command,
      cwd: created.cwd,
      pid: child.pid ?? null,
      status: 'running',
    },
  });

  child.on('error', (err) => {
    managedProcesses.delete(id);
    void (async () => {
      const [current] = await db
        .select({ status: backgroundProcesses.status })
        .from(backgroundProcesses)
        .where(eq(backgroundProcesses.id, id));
      if (current?.status !== 'running') return;
      await markFinished({
        id,
        status: 'failed',
        stopReason: err.message || 'background_process_spawn_error',
        output: managed.output,
      });
    })();
  });

  const onChunk = async (chunk: Buffer) => {
    managed.output = tail(`${managed.output}${chunk.toString()}`, MAX_ACTIVITY_OUTPUT_CHARS);
    await db
      .update(backgroundProcesses)
      .set({ latestOutput: tail(managed.output), updatedAt: new Date() })
      .where(eq(backgroundProcesses.id, id));
  };
  child.stdout.on('data', (chunk) => void onChunk(chunk));
  child.stderr.on('data', (chunk) => void onChunk(chunk));
  child.on('close', (code, signal) => {
    managedProcesses.delete(id);
    void (async () => {
      const [current] = await db
        .select({ status: backgroundProcesses.status })
        .from(backgroundProcesses)
        .where(eq(backgroundProcesses.id, id));
      if (current?.status !== 'running') return;
      const currentStatus: BackgroundProcessStatus = code === 0 ? 'completed' : 'failed';
      await markFinished({
        id,
        status: currentStatus,
        exitCode: code,
        signal,
        output: managed.output,
      });
    })();
  });

  return created;
}

export async function listBackgroundProcesses(filters?: {
  repositoryId?: string;
  taskId?: string;
  runId?: string;
}) {
  await reconcileLostProcesses();
  const predicates = [];
  if (filters?.repositoryId)
    predicates.push(eq(backgroundProcesses.repositoryId, filters.repositoryId));
  if (filters?.taskId) predicates.push(eq(backgroundProcesses.taskId, filters.taskId));
  if (filters?.runId) predicates.push(eq(backgroundProcesses.runId, filters.runId));
  const query = db.select().from(backgroundProcesses);
  if (predicates.length) {
    return query.where(and(...predicates)).orderBy(desc(backgroundProcesses.startedAt));
  }
  return query.orderBy(desc(backgroundProcesses.startedAt));
}

export async function getBackgroundProcess(id: string) {
  await reconcileLostProcesses();
  const [processRecord] = await db
    .select()
    .from(backgroundProcesses)
    .where(eq(backgroundProcesses.id, id));
  return processRecord ?? null;
}

export async function stopBackgroundProcess(id: string, reason = 'user_requested') {
  const [processRecord] = await db
    .select()
    .from(backgroundProcesses)
    .where(eq(backgroundProcesses.id, id));
  if (!processRecord) return null;
  if (processRecord.status !== 'running') {
    return processRecord;
  }
  const managed = managedProcesses.get(id);
  if (!managed) {
    return markFinished({
      id,
      status: 'lost',
      stopReason: 'api_process_restarted_or_tracking_lost',
      output: processRecord.latestOutput || '',
    });
  }

  try {
    if (processRecord.pid) {
      process.kill(-processRecord.pid, 'SIGTERM');
    } else {
      managed.child.kill('SIGTERM');
    }
  } catch (_err) {
    managed.child.kill('SIGTERM');
  }
  managedProcesses.delete(id);
  return markFinished({
    id,
    status: 'stopped',
    signal: 'SIGTERM',
    stopReason: reason,
    output: managed.output,
  });
}
