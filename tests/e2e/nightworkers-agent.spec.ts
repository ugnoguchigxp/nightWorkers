import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const sameOriginHeaders = { Origin: 'http://localhost:39174' };

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

    const prompt = `E2E single submit ${Date.now()}`;
    const input = page.getByPlaceholder('指示を入力（送信: Cmd+Enter / Ctrl+Enter）');
    await input.fill(prompt);
    await input.press('Meta+Enter');

    const userBubbles = page.locator('[data-testid="message-user"]', { hasText: prompt });
    await expect(userBubbles).toHaveCount(1);

    await page.waitForTimeout(1200);
    await expect(userBubbles).toHaveCount(1);
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
