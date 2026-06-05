import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ensureNightWorkersSchema } from '../api/db/bootstrap';
import * as repo from '../api/modules/nightworkers/nightworkers.repository';
import {
  getLatestConversationContextForTask,
  refreshConversationContextSnapshot,
} from '../api/services/conversation-context';

const envKeys = [
  'CONVERSATION_CONTEXT_ENABLED',
  'CONVERSATION_CONTEXT_STATE_CARD_ENABLED',
  'CONVERSATION_CONTEXT_BUILD_ON_IDLE',
] as const;
const execFileAsync = promisify(execFile);

describe('conversation context repository integration', () => {
  let repoRoot: string;
  let previousEnv: Partial<Record<(typeof envKeys)[number], string | undefined>>;

  beforeAll(async () => {
    await ensureNightWorkersSchema();
  });

  beforeEach(async () => {
    repoRoot = await mkdtemp(path.join(os.tmpdir(), 'conversation-context-integration-'));
    await writeFile(path.join(repoRoot, 'fizzbuzz.ts'), 'export const value = 1;\n');
    previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
    process.env.CONVERSATION_CONTEXT_ENABLED = 'true';
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
    for (const key of envKeys) {
      const value = previousEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('refreshes and persists the latest task StateCard without changing source messages', async () => {
    const project = await repo.createRepository({
      name: `TEST: Conversation Context ${Date.now()}`,
      localPath: repoRoot,
      branch: 'main',
    });
    const task = await repo.createTask({
      repositoryId: project.id,
      title: 'Conversation context',
      status: 'running',
      objective: 'Maintain fizzbuzz.ts',
    });
    await repo.createTaskMessage({
      taskId: task.id,
      role: 'user',
      content: 'fizzbuzz.tsを作ってください',
      messageType: 'text',
    });
    await repo.createTaskMessage({
      taskId: task.id,
      role: 'system',
      content: 'run started',
      messageType: 'text',
      payloadJson: {
        intakeJobSelection: {
          jobType: 'minor_code_edit',
          goal: '`fizzbuzz.ts` を作成する',
        },
      },
    });
    const run = await repo.createTaskRun({
      taskId: task.id,
      repositoryId: project.id,
      status: 'completed',
      finalReport: 'Created fizzbuzz.ts.',
      summary: 'Created fizzbuzz.ts.',
      startedAt: new Date(),
      endedAt: new Date(),
      finishedAt: new Date(),
    });
    await repo.createTaskMessage({
      taskId: task.id,
      role: 'user',
      content: 'foo 条件も追加してください７で割ってください',
      messageType: 'text',
    });

    const result = await refreshConversationContextSnapshot({
      taskId: task.id,
      runId: run.id,
      reason: 'run_finished',
    });
    const latest = await getLatestConversationContextForTask(task.id);
    const messages = await repo.listTaskMessages(task.id);

    expect(result.snapshot.stateCardText).toContain('<STATE_CARD>');
    expect(result.snapshot.stateCardText).toContain('minor_code_edit');
    expect(result.snapshot.stateCardText).toContain('foo 条件も追加してください');
    expect(result.snapshot.stateCardText).toContain('Created fizzbuzz.ts.');
    expect(latest?.id).toBe(result.snapshot.id);
    expect(messages.map((message) => message.content)).toContain(
      'foo 条件も追加してください７で割ってください'
    );
  });

  it('does not add git-only workspace changes to StateCard targets', async () => {
    await execFileAsync('git', ['init'], { cwd: repoRoot });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoRoot });
    await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: repoRoot });
    await execFileAsync('git', ['add', 'fizzbuzz.ts'], { cwd: repoRoot });
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: repoRoot });
    await writeFile(path.join(repoRoot, 'fizzbuzz.ts'), 'export const value = 7;\n');
    await writeFile(
      path.join(repoRoot, 'internal-state-card-work.ts'),
      'export const noise = true;\n'
    );
    const project = await repo.createRepository({
      name: `TEST: Conversation Context Git ${Date.now()}`,
      localPath: repoRoot,
      branch: 'main',
    });
    const task = await repo.createTask({
      repositoryId: project.id,
      title: 'Conversation context git',
      status: 'running',
      objective: 'Maintain current work',
    });
    await repo.createTaskMessage({
      taskId: task.id,
      role: 'user',
      content: 'この続きで fizzbuzz.ts の条件を調整してください',
      messageType: 'text',
    });

    const result = await refreshConversationContextSnapshot({
      taskId: task.id,
      reason: 'manual_refresh',
    });

    expect(result.snapshot.snapshotJson.files.target).toEqual(['fizzbuzz.ts']);
    expect(result.snapshot.snapshotJson.files.target).not.toContain('internal-state-card-work.ts');
    expect(result.snapshot.stateCardText).not.toContain('internal-state-card-work.ts');
    expect(result.snapshot.stateCardText).not.toContain('touched:');
    expect(result.snapshot.snapshotJson.code.snippets).toContainEqual(
      expect.objectContaining({
        path: 'fizzbuzz.ts',
        reason: 'target_file_small',
        content: expect.stringContaining('export const value = 7'),
      })
    );
  });
});
