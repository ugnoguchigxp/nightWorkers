import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { type APIRequestContext, expect, test } from '@playwright/test';

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

async function createDisposableLiveWorkspace(): Promise<string> {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nightworkers-e2e-live-'));
  await fs.mkdir(path.join(workspaceDir, 'src'), { recursive: true });
  await fs.writeFile(path.join(workspaceDir, 'README.md'), '# Live coding fixture\n', 'utf-8');
  await fs.writeFile(
    path.join(workspaceDir, 'package.json'),
    JSON.stringify(
      {
        type: 'module',
        scripts: {
          test: "node -e \"import('./src/greeting.mjs').then(m=>{if(m.greet('NightWorkers')!=='Hello, NightWorkers!') process.exit(1)})\"",
        },
      },
      null,
      2
    ),
    'utf-8'
  );
  await fs.writeFile(
    path.join(workspaceDir, 'src/greeting.mjs'),
    "export function greet(name) {\n  return 'TODO';\n}\n",
    'utf-8'
  );
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
      'initial live fixture',
    ],
    { cwd: workspaceDir, stdio: 'ignore' }
  );
  return workspaceDir;
}

async function waitForTerminalRun(request: APIRequestContext, taskId: string) {
  const startedAt = Date.now();
  const timeoutMs = 8 * 60 * 1000;
  let latestRuns: Array<{ id: string; status: string; diffPatch?: string | null }> = [];
  while (Date.now() - startedAt < timeoutMs) {
    const runsRes = await request.get(`/api/tasks/${taskId}/runs`, { headers: sameOriginHeaders });
    expect(runsRes.status(), await runsRes.text()).toBe(200);
    latestRuns = (await runsRes.json()) as Array<{
      id: string;
      status: string;
      diffPatch?: string | null;
    }>;
    const latestRun = latestRuns[0];
    if (
      latestRun &&
      ['completed', 'needs_review', 'needs_human', 'failed', 'cancelled', 'timed_out'].includes(
        latestRun.status
      )
    ) {
      return latestRun;
    }
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  throw new Error(
    `Timed out waiting for terminal run. taskId=${taskId} runs=${JSON.stringify(latestRuns)}`
  );
}

function gitDiff(workspaceDir: string) {
  return execFileSync('git', ['diff', '--', '.'], {
    cwd: workspaceDir,
    encoding: 'utf-8',
  });
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
  test('agent live run produces run, workspace, Todo, and verification evidence', async ({
    request,
  }) => {
    test.skip(
      process.env.NIGHTWORKERS_LIVE_LLM_E2E !== '1',
      'Set NIGHTWORKERS_LIVE_LLM_E2E=1 to run live LLM evidence E2E.'
    );
    test.skip(
      !process.env.OPENAI_API_KEY &&
        !process.env.AZURE_OPENAI_API_KEY &&
        !process.env.CODEX_ACCESS_TOKEN,
      'Provider credentials are not configured in this environment.'
    );

    const workspaceDir = await createDisposableLiveWorkspace();
    let repositoryId: string | null = null;
    let taskId: string | null = null;

    try {
      const repositoryRes = await request.post('/api/repositories', {
        headers: sameOriginHeaders,
        data: {
          name: `E2E live fixture ${Date.now()}`,
          localPath: workspaceDir,
          branch: 'main',
          allowed: true,
        },
      });
      expect(repositoryRes.status(), await repositoryRes.text()).toBe(201);
      repositoryId = ((await repositoryRes.json()) as { id: string }).id;

      const taskRes = await request.post('/api/tasks', {
        headers: sameOriginHeaders,
        data: {
          repositoryId,
          title: 'Live LLM greeting implementation',
          description:
            'src/greeting.mjs の greet(name) を実装し、npm test が通るようにしてください。既存の export 名は変えないでください。完了前に npm test を実行してください。',
          objective: 'Implement greet(name) in the registered repository root.',
          acceptanceCriteria:
            'src/greeting.mjs returns Hello, <name>! and npm test succeeds before closeout.',
          timeoutSeconds: 480,
        },
      });
      expect(taskRes.status(), await taskRes.text()).toBe(201);
      taskId = ((await taskRes.json()) as { id: string }).id;

      const runRes = await request.post(`/api/tasks/${taskId}/run`, {
        headers: sameOriginHeaders,
      });
      expect(runRes.status(), await runRes.text()).toBe(202);
      const startedRun = (await runRes.json()) as { id: string };
      const terminalRun = await waitForTerminalRun(request, taskId);

      expect(terminalRun.id).toBe(startedRun.id);
      expect(['completed', 'needs_review']).toContain(terminalRun.status);

      const diff = gitDiff(workspaceDir);
      expect(diff).toContain('src/greeting.mjs');
      expect(diff).toContain('Hello,');
      expect(diff).not.toContain('/tmp/');

      const eventsRes = await request.get(`/api/runs/${terminalRun.id}/events`, {
        headers: sameOriginHeaders,
      });
      expect(eventsRes.status(), await eventsRes.text()).toBe(200);
      const events = (await eventsRes.json()) as Array<{
        type?: string;
        eventType?: string;
        message?: string;
        payloadJson?: Record<string, unknown>;
      }>;
      const eventText = JSON.stringify(events);
      expect(eventText).toContain('todo_list');
      expect(eventText).toContain('command_execution');
      expect(eventText).toContain('npm test');
      expect(events.some((event) => event.type === 'run.created')).toBe(true);
    } finally {
      if (taskId) await request.delete(`/api/tasks/${taskId}`, { headers: sameOriginHeaders });
      if (repositoryId)
        await request.delete(`/api/repositories/${repositoryId}`, {
          headers: sameOriginHeaders,
        });
      await fs.rm(workspaceDir, { recursive: true, force: true });
    }
  });
});
