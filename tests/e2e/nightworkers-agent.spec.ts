import { expect, test } from '@playwright/test';

test.describe('NightWorkers Agent Debug @regression', () => {
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
});
