import { expect, test } from '@playwright/test';
import { mockBbsThreads } from './helpers';

test.describe('Navigation and Public Pages @regression', () => {
  test('shows top navigation on home page @smoke', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Welcome to Hono Standard');
    await expect(page.getByRole('link', { name: 'Home' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'BBS' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Login' })).toBeVisible();
  });

  test('shows login prompt on BBS page when unauthenticated', async ({ page }) => {
    await mockBbsThreads(page, [
      {
        id: 'thread-1',
        title: 'First Thread',
        content: 'body',
        authorId: 'user-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    await page.goto('/bbs');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('BBS');
    await expect(page.getByText('Please login to create a new thread.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'First Thread' })).toBeVisible();
  });

  test('shows loading state before thread detail is rendered', async ({ page }) => {
    await page.route('**/api/bbs/threads/thread-late', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          thread: {
            id: 'thread-late',
            title: 'Delayed Thread',
            content: 'Loaded after delay',
            authorId: 'user-1',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            comments: [],
          },
        }),
      });
    });

    await page.goto('/bbs/thread-late');
    await expect(page.getByText('Loading...')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Delayed Thread');
  });

  test('shows OAuth buttons on login page', async ({ page }) => {
    await page.route('**/api/auth/methods', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          authMode: 'both',
          local: true,
          oauth: {
            enabled: true,
            providers: {
              google: true,
              github: true,
            },
          },
        }),
      });
    });

    await page.goto('/login');
    await expect(page.getByRole('link', { name: 'Login with Google' })).toHaveAttribute(
      'href',
      '/api/auth/oauth/google'
    );
    await expect(page.getByRole('link', { name: 'Login with GitHub' })).toHaveAttribute(
      'href',
      '/api/auth/oauth/github'
    );
  });
});
