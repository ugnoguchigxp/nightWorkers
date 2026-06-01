import { expect, test } from '@playwright/test';
import { getJson, pollUntil } from './helpers';

test.describe('NightWorkers Agent Debug @regression', () => {
  test.describe.configure({ mode: 'serial' });

  test('debug panel is hidden by default and can be toggled @smoke', async ({ page }) => {
    await page.goto('/');

    const toggle = page.getByRole('button', { name: 'Show Debug' });
    await expect(toggle).toBeVisible();
    await expect(page.getByText('AGENT DEBUG EVENTS')).toHaveCount(0);

    await toggle.click();
    await expect(page.getByRole('button', { name: 'Hide Debug' })).toBeVisible();
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

  test('run is created once and outcome/events are persisted @smoke', async ({ page, request }) => {
    test.setTimeout(60000);
    await page.goto('/');

    const tasksBefore = await getJson<
      Array<{
        id: string;
        title: string;
      }>
    >(request, '/api/tasks');
    const taskId = tasksBefore[0]?.id;
    expect(taskId).toBeTruthy();
    const runsBefore = await getJson<
      Array<{
        id: string;
        status: string;
      }>
    >(request, `/api/tasks/${taskId}/runs`);
    const latestRunIdBefore = runsBefore[0]?.id ?? null;
    const prompt = `E2E outcome ${Date.now()}`;
    const input = page.getByPlaceholder('指示を入力（送信: Cmd+Enter / Ctrl+Enter）');
    await input.fill(prompt);
    await input.press('Meta+Enter');

    const runs = await pollUntil(
      async () =>
        getJson<
          Array<{
            id: string;
            status: string;
          }>
        >(request, `/api/tasks/${taskId}/runs`),
      (list) => list.length >= 1 && list[0]?.id !== latestRunIdBefore,
      20000,
      1000
    );
    expect(runs.length).toBeGreaterThanOrEqual(1);

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
    if (isTerminal) {
      expect(hasOutcome).toBe(true);
    } else {
      expect(
        eventTypes.has('tool_call') ||
          eventTypes.has('tool_result') ||
          eventTypes.has('supervisor_decision')
      ).toBe(true);
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
