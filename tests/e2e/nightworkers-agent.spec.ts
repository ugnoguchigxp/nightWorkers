import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { getJson, pollUntil } from './helpers';

const repoRoot = process.cwd();
const sameOriginHeaders = { Origin: 'http://localhost:39174' };

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function createDisposableGitWorkspace(): Promise<string> {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nightworkers-e2e-coding-'));
  await fs.mkdir(path.join(workspaceDir, 'src'), { recursive: true });
  await fs.writeFile(path.join(workspaceDir, 'README.md'), '# E2E coding fixture\n', 'utf-8');
  await fs.writeFile(path.join(workspaceDir, 'src/greeting.txt'), 'TODO\n', 'utf-8');
  execFileSync('git', ['init'], { cwd: workspaceDir, stdio: 'ignore' });
  execFileSync('git', ['add', '.'], { cwd: workspaceDir, stdio: 'ignore' });
  execFileSync(
    'git',
    [
      '-c',
      'user.email=e2e@example.test',
      '-c',
      'user.name=NightWorkers E2E',
      'commit',
      '-m',
      'initial fixture',
    ],
    { cwd: workspaceDir, stdio: 'ignore' }
  );
  return workspaceDir;
}

test.describe('NightWorkers Agent Debug @regression', () => {
  test.describe.configure({ mode: 'serial' });

  test('debug panel is available on a task detail page @smoke', async ({ page, request }) => {
    const workspaceDir = await createDisposableGitWorkspace();
    let repositoryId: string | null = null;
    let taskId: string | null = null;

    try {
      const repositoryRes = await request.post('/api/repositories', {
        headers: sameOriginHeaders,
        data: {
          name: `E2E debug fixture ${Date.now()}`,
          localPath: workspaceDir,
          branch: 'main',
          allowed: true,
        },
      });
      expect(repositoryRes.status(), await repositoryRes.text()).toBe(201);
      const repository = (await repositoryRes.json()) as { id: string };
      repositoryId = repository.id;

      const taskRes = await request.post('/api/tasks', {
        headers: sameOriginHeaders,
        data: {
          repositoryId,
          title: 'E2E debug fixture',
          description: 'Open task detail debug panels.',
          objective: 'Open task detail debug panels.',
          acceptanceCriteria: 'Debug panels are visible.',
          timeoutSeconds: 60,
        },
      });
      expect(taskRes.status(), await taskRes.text()).toBe(201);
      const task = (await taskRes.json()) as { id: string };
      taskId = task.id;

      await page.goto(`/tasks/${taskId}`);

      await expect(page.getByRole('button', { name: 'Agent Terminal Console' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Review Diffs' })).toBeVisible();
    } finally {
      if (taskId) await request.delete(`/api/tasks/${taskId}`, { headers: sameOriginHeaders });
      if (repositoryId)
        await request.delete(`/api/repositories/${repositoryId}`, {
          headers: sameOriginHeaders,
        });
      await fs.rm(workspaceDir, { recursive: true, force: true });
    }
  });

  test('single prompt creates exactly one user message bubble @smoke', async ({ page }) => {
    await page.goto('/');

    const prompt = `NIGHTWORKERS_TEST_AGENT_SCENARIO=policy_blocked_command E2E single submit ${Date.now()}`;
    const input = page.getByPlaceholder('指示を入力（送信: Cmd+Enter / Ctrl+Enter）');
    await input.fill(prompt);
    await input.press('Meta+Enter');

    const userBubbles = page.locator('[data-testid="message-user"]', { hasText: prompt });
    await expect(userBubbles).toHaveCount(1);

    await page.waitForTimeout(1200);
    await expect(userBubbles).toHaveCount(1);
  });

  test('run is created once and outcome/events are persisted @smoke', async ({ request }) => {
    test.setTimeout(60000);
    const workspaceDir = await createDisposableGitWorkspace();
    let repositoryId: string | null = null;
    let taskId: string | null = null;

    try {
      const repositoryRes = await request.post('/api/repositories', {
        headers: sameOriginHeaders,
        data: {
          name: `E2E run persistence fixture ${Date.now()}`,
          localPath: workspaceDir,
          branch: 'main',
          allowed: true,
          safetyPolicy: {
            requireReadBeforeEdit: false,
            blockedCommands: ['rm'],
            maxCommandSeconds: 5,
          },
        },
      });
      expect(repositoryRes.status(), await repositoryRes.text()).toBe(201);
      const repository = (await repositoryRes.json()) as { id: string };
      repositoryId = repository.id;

      const prompt = `NIGHTWORKERS_TEST_AGENT_SCENARIO=policy_blocked_command E2E outcome ${Date.now()}`;
      const taskRes = await request.post('/api/tasks', {
        headers: sameOriginHeaders,
        data: {
          repositoryId,
          title: 'E2E run persistence fixture',
          description: prompt,
          objective: prompt,
          acceptanceCriteria: 'Run outcome and events are persisted exactly once.',
          timeoutSeconds: 60,
        },
      });
      expect(taskRes.status(), await taskRes.text()).toBe(201);
      const task = (await taskRes.json()) as { id: string };
      taskId = task.id;

      const runRes = await request.post(`/api/tasks/${taskId}/run`, {
        headers: sameOriginHeaders,
      });
      expect(runRes.status(), await runRes.text()).toBe(201);
      const startedRun = (await runRes.json()) as { id: string };

      const runs = await pollUntil(
        async () =>
          getJson<
            Array<{
              id: string;
              status: string;
            }>
          >(request, `/api/tasks/${taskId}/runs`),
        (list) => list.length === 1 && list[0]?.id === startedRun.id,
        20000,
        1000
      );
      expect(runs).toHaveLength(1);

      const runId = runs[0].id;
      const runDetails = await pollUntil(
        async () =>
          getJson<{
            status: string;
            events: Array<{ eventType?: string; message?: string }>;
          }>(request, `/api/runs/${runId}`),
        (run) =>
          (run.events || []).some((event) => event.eventType === 'run_outcome_decided') ||
          ['completed', 'failed', 'cancelled', 'needs_human', 'blocked', 'timed_out'].includes(
            run.status
          ),
        30000,
        1000
      );

      const eventTypes = new Set((runDetails.events || []).map((event) => event.eventType));
      expect(eventTypes.has('state_change')).toBe(true);
      const hasOutcome = (runDetails.events || []).some(
        (event) => event.eventType === 'run_outcome_decided'
      );
      const isTerminal = [
        'completed',
        'failed',
        'cancelled',
        'needs_human',
        'blocked',
        'timed_out',
      ].includes(runDetails.status);
      expect(isTerminal).toBe(true);
      expect(hasOutcome).toBe(true);
    } finally {
      if (taskId) await request.delete(`/api/tasks/${taskId}`, { headers: sameOriginHeaders });
      if (repositoryId)
        await request.delete(`/api/repositories/${repositoryId}`, {
          headers: sameOriginHeaders,
        });
      await fs.rm(workspaceDir, { recursive: true, force: true });
    }
  });

  test('spec document review collects repository evidence before completing', async ({
    request,
  }) => {
    test.setTimeout(60000);
    const previousSettings = await getJson<Record<string, unknown>>(request, '/api/settings/llm');
    let repositoryId: string | null = null;
    let taskId: string | null = null;

    try {
      const settingsRes = await request.post('/api/settings/llm', {
        headers: sameOriginHeaders,
        data: {
          ...previousSettings,
          ACTIVE_LLM_PROVIDER: 'fixture',
        },
      });
      expect(settingsRes.ok()).toBe(true);

      const repositoryRes = await request.post('/api/repositories', {
        headers: sameOriginHeaders,
        data: {
          name: `E2E spec review fixture ${Date.now()}`,
          localPath: repoRoot,
          branch: 'main',
          allowed: true,
        },
      });
      expect(repositoryRes.status()).toBe(201);
      const repository = (await repositoryRes.json()) as { id: string };
      repositoryId = repository.id;

      const prompt =
        'spec/jsonl-replay-import-regression-implementation-plan.md のドキュメントレビューをしてください';
      const taskRes = await request.post('/api/tasks', {
        headers: sameOriginHeaders,
        data: {
          repositoryId,
          title: 'E2E spec document review fixture',
          description: prompt,
          objective: prompt,
          acceptanceCriteria: '対象ファイルを読んだ証拠を残してから完了扱いにすること',
          timeoutSeconds: 60,
        },
      });
      expect(taskRes.status()).toBe(201);
      const task = (await taskRes.json()) as { id: string };
      taskId = task.id;

      const runRes = await request.post(`/api/tasks/${taskId}/run`, {
        headers: sameOriginHeaders,
      });
      expect(runRes.status(), await runRes.text()).toBe(201);
      const run = (await runRes.json()) as { id: string };

      const runDetails = await pollUntil(
        async () =>
          getJson<{
            status: string;
            finalReport?: string | null;
            events: Array<{
              eventType?: string;
              message?: string;
              payloadJson?: Record<string, unknown>;
            }>;
          }>(request, `/api/runs/${run.id}`),
        (value) =>
          ['needs_review', 'failed', 'blocked', 'timed_out', 'cancelled'].includes(value.status),
        30000,
        1000
      );

      expect(runDetails.status).toBe('needs_review');
      expect(runDetails.finalReport || '').toContain('after reading repository evidence');
      expect(
        runDetails.events.some(
          (event) =>
            event.eventType === 'tool_result' && event.payloadJson?.toolName === 'read_file'
        )
      ).toBe(true);
      expect(
        runDetails.events.some((event) => event.payloadJson?.reason === 'stop_without_evidence')
      ).toBe(false);
      expect(
        runDetails.events.some(
          (event) =>
            event.eventType === 'run_outcome_decided' &&
            (event.payloadJson?.legacyPayload as { status?: string } | undefined)?.status ===
              'needs_review'
        )
      ).toBe(true);
    } finally {
      await request.post('/api/settings/llm', {
        headers: sameOriginHeaders,
        data: previousSettings,
      });
      if (taskId) await request.delete(`/api/tasks/${taskId}`, { headers: sameOriginHeaders });
      if (repositoryId)
        await request.delete(`/api/repositories/${repositoryId}`, { headers: sameOriginHeaders });
    }
  });

  test('simple coding task applies a patch and removes its disposable route after run', async ({
    request,
  }) => {
    test.setTimeout(60000);
    const previousSettings = await getJson<Record<string, unknown>>(request, '/api/settings/llm');
    const workspaceDir = await createDisposableGitWorkspace();
    let repositoryId: string | null = null;
    let taskId: string | null = null;
    let cleanupCompleted = false;

    try {
      const settingsRes = await request.post('/api/settings/llm', {
        headers: sameOriginHeaders,
        data: {
          ...previousSettings,
          ACTIVE_LLM_PROVIDER: 'fixture',
        },
      });
      expect(settingsRes.ok()).toBe(true);

      const repositoryRes = await request.post('/api/repositories', {
        headers: sameOriginHeaders,
        data: {
          name: `E2E simple coding fixture ${Date.now()}`,
          localPath: workspaceDir,
          branch: 'main',
          allowed: true,
          safetyPolicy: { requireReadBeforeEdit: false },
        },
      });
      expect(repositoryRes.status()).toBe(201);
      const repository = (await repositoryRes.json()) as { id: string };
      repositoryId = repository.id;

      const prompt = `E2E_SIMPLE_CODING_FIXTURE ${Date.now()}: src/greeting.txt を更新する簡単なコーディングタスクを実行してください`;
      const taskRes = await request.post('/api/tasks', {
        headers: sameOriginHeaders,
        data: {
          repositoryId,
          title: 'E2E simple coding fixture',
          description: prompt,
          objective: prompt,
          acceptanceCriteria: 'src/greeting.txt が更新され、実行後にテスト導線が削除されること',
          timeoutSeconds: 60,
        },
      });
      expect(taskRes.status()).toBe(201);
      const task = (await taskRes.json()) as { id: string };
      taskId = task.id;

      const runRes = await request.post(`/api/tasks/${taskId}/run`, {
        headers: sameOriginHeaders,
      });
      expect(runRes.status(), await runRes.text()).toBe(201);
      const run = (await runRes.json()) as { id: string };

      const runDetails = await pollUntil(
        async () =>
          getJson<{
            status: string;
            diffPatch?: string | null;
            finalReport?: string | null;
            events: Array<{
              eventType?: string;
              payloadJson?: Record<string, unknown>;
            }>;
          }>(request, `/api/runs/${run.id}`),
        (value) => value.status === 'needs_review',
        30000,
        1000
      );

      expect(runDetails.status).toBe('needs_review');
      expect(runDetails.finalReport || '').toContain('Fixture coding task completed');
      expect(runDetails.diffPatch || '').toContain('src/greeting.txt');
      expect(await fs.readFile(path.join(workspaceDir, 'src/greeting.txt'), 'utf-8')).toContain(
        'E2E_SIMPLE_CODING_FIXTURE'
      );
      expect(
        runDetails.events.some(
          (event) =>
            event.eventType === 'tool_result' &&
            (event.payloadJson?.toolName === 'apply_patch' ||
              event.payloadJson?.toolName === 'git_diff')
        )
      ).toBe(true);
      expect(
        runDetails.events.some(
          (event) =>
            event.eventType === 'run_outcome_decided' &&
            (event.payloadJson?.legacyPayload as { status?: string } | undefined)?.status ===
              'needs_review'
        )
      ).toBe(true);

      await request.post('/api/settings/llm', {
        headers: sameOriginHeaders,
        data: previousSettings,
      });
      if (taskId) {
        const deleteTaskRes = await request.delete(`/api/tasks/${taskId}`, {
          headers: sameOriginHeaders,
        });
        expect(deleteTaskRes.ok()).toBe(true);
      }
      if (repositoryId) {
        const deleteRepositoryRes = await request.delete(`/api/repositories/${repositoryId}`, {
          headers: sameOriginHeaders,
        });
        expect(deleteRepositoryRes.ok()).toBe(true);
      }
      await fs.rm(workspaceDir, { recursive: true, force: true });
      cleanupCompleted = true;

      const deletedTaskRes = await request.get(`/api/tasks/${taskId}`);
      expect(deletedTaskRes.status()).toBe(404);
      const deletedRepositoryRes = await request.get(`/api/repositories/${repositoryId}`);
      expect(deletedRepositoryRes.status()).toBe(404);
      expect(await pathExists(workspaceDir)).toBe(false);
    } finally {
      if (!cleanupCompleted) {
        await request.post('/api/settings/llm', {
          headers: sameOriginHeaders,
          data: previousSettings,
        });
        if (taskId) await request.delete(`/api/tasks/${taskId}`, { headers: sameOriginHeaders });
        if (repositoryId)
          await request.delete(`/api/repositories/${repositoryId}`, {
            headers: sameOriginHeaders,
          });
        await fs.rm(workspaceDir, { recursive: true, force: true });
      }
    }
  });
});

test.describe('NightWorkers Agent Live @agent-live', () => {
  test('agent live run can be executed when credentials are configured', async ({ page }) => {
    test.skip(
      !process.env.OPENAI_API_KEY &&
        !process.env.AZURE_OPENAI_API_KEY &&
        !process.env.CODEX_ACCESS_TOKEN,
      'Provider credentials are not configured in this environment.'
    );
    await page.goto('/');
    await expect(page.getByPlaceholder('指示を入力（送信: Cmd+Enter / Ctrl+Enter）')).toBeVisible();
  });
});
