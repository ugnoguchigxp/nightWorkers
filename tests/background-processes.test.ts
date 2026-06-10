import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ensureNightWorkersSchema } from '../api/db/bootstrap';
import * as repo from '../api/modules/nightworkers/nightworkers.repository';
import {
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
});
