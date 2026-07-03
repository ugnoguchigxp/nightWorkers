import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ensureNightWorkersSchema } from '../api/db/bootstrap';
import * as repo from '../api/modules/nightworkers/nightworkers.repository';
import {
  getTaskBackgroundProcess,
  listTaskActivityEvents,
  listTaskBackgroundProcesses,
  startTaskBackgroundProcess,
  stopTaskBackgroundProcess,
} from '../api/modules/nightworkers/nightworkers.service';

let dummyRepoDir: string;

beforeAll(async () => {
  await ensureNightWorkersSchema();
});

beforeEach(async () => {
  dummyRepoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nightworkers-background-'));
  await fs.writeFile(path.join(dummyRepoDir, 'server.log'), 'ready\n', 'utf-8');
});

afterEach(async () => {
  await fs.rm(dummyRepoDir, { recursive: true, force: true });
});

describe('background processes', () => {
  it('persists start and stop state with activity records', async () => {
    const project = await repo.createRepository({
      name: `TEST: background process ${crypto.randomUUID()}`,
      localPath: dummyRepoDir,
      branch: 'main',
    });
    const task = await repo.createTask({
      repositoryId: project.id,
      title: 'TEST: background process task',
      status: 'running',
    });

    const processRecord = await startTaskBackgroundProcess({
      taskId: task.id,
      command: 'tail -f server.log',
    });
    expect(processRecord).toMatchObject({
      repositoryId: project.id,
      taskId: task.id,
      command: 'tail -f server.log',
      status: 'running',
    });

    const listed = await listTaskBackgroundProcesses({ taskId: task.id });
    expect(listed.map((item) => item.id)).toContain(processRecord.id);

    const retrieved = await getTaskBackgroundProcess(processRecord.id);
    expect(retrieved).toMatchObject({
      id: processRecord.id,
      command: 'tail -f server.log',
    });

    const stopped = await stopTaskBackgroundProcess(processRecord.id);
    expect(stopped).toMatchObject({
      id: processRecord.id,
      status: 'stopped',
      stopReason: 'user_requested',
    });

    const replay = await listTaskActivityEvents(task.id);
    expect(replay.events.map((event) => event.kind)).toEqual(
      expect.arrayContaining(['tool.call', 'tool.result'])
    );
    expect(replay.events.at(-1)?.payloadJson).toMatchObject({
      backgroundProcessId: processRecord.id,
      status: 'stopped',
      workRecordCard: { executionMode: 'background' },
    });
  });

  it('throws NotFoundError when entity is not found in resolveRepoRoot', async () => {
    await expect(
      startTaskBackgroundProcess({
        repositoryId: 'non-existent-repo',
        command: 'tail -f server.log',
      })
    ).rejects.toThrow('Repository not found');

    await expect(
      startTaskBackgroundProcess({
        taskId: 'non-existent-task',
        command: 'tail -f server.log',
      })
    ).rejects.toThrow('Task not found');

    await expect(
      startTaskBackgroundProcess({
        runId: 'non-existent-run',
        command: 'tail -f server.log',
      })
    ).rejects.toThrow('Run not found');

    await expect(
      startTaskBackgroundProcess({
        command: 'tail -f server.log',
      })
    ).rejects.toThrow('Repository not found');
  });

  it('handles runId resolution variants in resolveRepoRoot', async () => {
    const project = await repo.createRepository({
      name: `TEST: runId project ${crypto.randomUUID()}`,
      localPath: dummyRepoDir,
      branch: 'main',
    });
    const task = await repo.createTask({
      repositoryId: project.id,
      title: 'TEST: runId task',
      status: 'running',
    });

    const runWithRepo = await repo.createTaskRun({
      taskId: task.id,
      repositoryId: project.id,
      status: 'running',
    });
    const process1 = await startTaskBackgroundProcess({
      runId: runWithRepo.id,
      command: 'tail -f server.log',
    });
    expect(process1.repositoryId).toBe(project.id);
    await stopTaskBackgroundProcess(process1.id);

    const runWithoutRepo = await repo.createTaskRun({
      taskId: task.id,
      status: 'running',
    });
    const process2 = await startTaskBackgroundProcess({
      runId: runWithoutRepo.id,
      command: 'tail -f server.log',
    });
    expect(process2.repositoryId).toBe(project.id);
    await stopTaskBackgroundProcess(process2.id);
  });

  it('throws NotFoundError for non-existent background processes', async () => {
    await expect(stopTaskBackgroundProcess('non-existent-proc')).rejects.toThrow(
      'Background process not found'
    );
  });
});
