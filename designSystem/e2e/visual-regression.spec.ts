import { expect, test } from '@playwright/test';

/**
 * Visual Regression Tests for Design System Components.
 * This test suite navigates to Storybook stories and captures screenshots
 * for regression testing.
 */

const componentStories = [
  { name: 'Button', id: 'components-actions-feedback-button--default' },
  { name: 'Alert', id: 'components-actions-feedback-alert--default' },
  { name: 'Badge', id: 'components-actions-feedback-badge--default' },
  { name: 'Avatar', id: 'components-media-icons-avatar--image' },
  { name: 'Accordion', id: 'components-layout-accordion--open' },
];

test.describe('Visual Regression', () => {
  for (const item of componentStories) {
    test(`Capture ${item.name} screenshot`, async ({ page }) => {
      // Go to the story's iframe directly for a clean screenshot
      await page.goto(`/iframe.html?id=${item.id}`);

      // Wait for content to stabilize
      await page.waitForSelector('#storybook-root > *');

      // Use a small buffer to ensure animations or fonts are settled
      await page.waitForTimeout(500);

      // Perform the visual comparison
      await expect(page.locator('#storybook-root')).toHaveScreenshot(`${item.name}.png`, {
        maxDiffPixelRatio: 0.01,
      });
    });
  }
});
