import { expect, test } from '@playwright/test';
import { defaultUser, mockAuthMe } from './helpers';

test.describe('BBS Flows @regression', () => {
  test('renders thread list from API @smoke', async ({ page }) => {
    await page.route('**/api/bbs/threads', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          threads: [
            {
              id: 'thread-1',
              title: 'Announcement',
              content: 'Hello',
              authorId: 'user-1',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            {
              id: 'thread-2',
              title: 'Roadmap',
              content: 'Plan',
              authorId: 'user-2',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
        }),
      });
    });

    await page.goto('/bbs');
    await expect(page.getByRole('link', { name: 'Announcement' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Roadmap' })).toBeVisible();
  });

  test('navigates from list to thread detail', async ({ page }) => {
    await page.route('**/api/bbs/threads', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          threads: [
            {
              id: 'thread-1',
              title: 'Announcement',
              content: 'Hello',
              authorId: 'user-1',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
        }),
      });
    });

    await page.route('**/api/bbs/threads/thread-1', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          thread: {
            id: 'thread-1',
            title: 'Announcement',
            content: 'Hello thread detail',
            authorId: 'user-1',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            comments: [],
          },
        }),
      });
    });

    await page.goto('/bbs');
    await page.getByRole('link', { name: 'Announcement' }).click();
    await expect(page).toHaveURL('/bbs/thread-1');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Announcement');
    await expect(page.getByText('Hello thread detail')).toBeVisible();
  });

  test('creates new thread when authenticated', async ({ page }) => {
    await mockAuthMe(page, defaultUser);

    const threads = [
      {
        id: 'thread-1',
        title: 'Before Post',
        content: 'existing',
        authorId: 'user-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    await page.route('**/api/bbs/threads', async (route) => {
      const method = route.request().method();
      if (method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ threads }),
        });
        return;
      }

      if (method === 'POST') {
        const body = route.request().postDataJSON() as { title: string; content: string };
        const created = {
          id: 'thread-new',
          title: body.title,
          content: body.content,
          authorId: defaultUser.id,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        threads.unshift(created);
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(created),
        });
        return;
      }

      await route.fallback();
    });

    await page.goto('/bbs');
    await page.getByPlaceholder('Thread Title').fill('New Thread');
    await page.getByPlaceholder("What's on your mind?").fill('new content');
    await page.getByRole('button', { name: 'Create Thread' }).click();

    await expect(page.getByRole('link', { name: 'New Thread' })).toBeVisible();
  });

  test('retries protected BBS request via refresh token on 401', async ({ page }) => {
    await mockAuthMe(page, defaultUser);

    const threads = [
      {
        id: 'thread-1',
        title: 'Before Post',
        content: 'existing',
        authorId: 'user-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    let postAttempt = 0;
    await page.route('**/api/bbs/threads', async (route) => {
      const method = route.request().method();
      if (method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ threads }),
        });
        return;
      }

      if (method === 'POST') {
        postAttempt += 1;
        if (postAttempt === 1) {
          await route.fulfill({
            status: 401,
            contentType: 'application/json',
            body: JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'expired' } }),
          });
          return;
        }

        const body = route.request().postDataJSON() as { title: string; content: string };
        const created = {
          id: 'thread-refresh',
          title: body.title,
          content: body.content,
          authorId: defaultUser.id,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        threads.unshift(created);
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(created),
        });
        return;
      }

      await route.fallback();
    });

    await page.route('**/api/auth/refresh', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: {
            id: defaultUser.id,
            email: defaultUser.email,
          },
        }),
      });
    });

    await page.goto('/bbs');
    await page.getByPlaceholder('Thread Title').fill('Thread with Retry');
    await page.getByPlaceholder("What's on your mind?").fill('body');
    await page.getByRole('button', { name: 'Create Thread' }).click();

    await expect(page.getByRole('link', { name: 'Thread with Retry' })).toBeVisible();
    expect(postAttempt).toBe(2);
  });

  test('creates comment on thread detail when authenticated', async ({ page }) => {
    await mockAuthMe(page, defaultUser);

    const comments = [
      {
        id: 'comment-1',
        threadId: 'thread-1',
        parentId: null,
        content: 'existing comment',
        authorId: 'user-2',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    await page.route('**/api/bbs/threads/thread-1', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          thread: {
            id: 'thread-1',
            title: 'Thread One',
            content: 'Thread body',
            authorId: 'user-1',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            comments,
          },
        }),
      });
    });

    await page.route('**/api/bbs/threads/thread-1/comments', async (route) => {
      const body = route.request().postDataJSON() as { content: string };
      const newComment = {
        id: 'comment-2',
        threadId: 'thread-1',
        parentId: null,
        content: body.content,
        authorId: defaultUser.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      comments.push(newComment);
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(newComment),
      });
    });

    await page.goto('/bbs/thread-1');
    await page.getByPlaceholder('Write a comment...').fill('new comment');
    await page.getByRole('button', { name: 'Post Comment' }).click();

    await expect(page.getByText('new comment')).toBeVisible();
  });
});
