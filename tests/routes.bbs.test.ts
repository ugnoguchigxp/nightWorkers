import { beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../api/app';

const mocks = vi.hoisted(() => ({
  listThreads: vi.fn(),
  getThread: vi.fn(),
  createThread: vi.fn(),
  createComment: vi.fn(),
}));

vi.mock('../api/modules/bbs/bbs.service', () => ({
  listThreads: mocks.listThreads,
  getThread: mocks.getThread,
  createThread: mocks.createThread,
  createComment: mocks.createComment,
}));

const authMocks = vi.hoisted(() => ({
  authMiddleware: vi.fn(() => async (c: any, next: any) => {
    c.set('user', { userId: 'user-123' });
    await next();
  }),
}));

vi.mock('../api/middleware/auth', () => ({
  authMiddleware: authMocks.authMiddleware,
}));

describe('BBS routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /api/bbs/threads lists all threads', async () => {
    mocks.listThreads.mockResolvedValue([{ id: 'thread-1', title: 'Hello', comments: [] }]);
    const res = await app.request('/api/bbs/threads');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      threads: [{ id: 'thread-1', title: 'Hello', comments: [] }],
    });
  });

  it('GET /api/bbs/threads/:id returns thread detail', async () => {
    const threadId = '550e8400-e29b-41d4-a716-446655440000';
    mocks.getThread.mockResolvedValue({ id: threadId, title: 'Hello', comments: [] });
    const res = await app.request(`/api/bbs/threads/${threadId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      thread: { id: threadId, title: 'Hello', comments: [] },
    });
  });

  it('POST /api/bbs/threads creates a thread', async () => {
    mocks.createThread.mockResolvedValue({ id: 'thread-new', title: 'New Thread' });
    const res = await app.request('/api/bbs/threads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'New Thread',
        content: 'Content here',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ id: 'thread-new', title: 'New Thread' });
    expect(mocks.createThread).toHaveBeenCalledWith(
      { title: 'New Thread', content: 'Content here' },
      'user-123'
    );
  });

  it('POST /api/bbs/threads/:id/comments creates a comment', async () => {
    const threadId = '550e8400-e29b-41d4-a716-446655440000';
    mocks.createComment.mockResolvedValue({ id: 'comment-new', content: 'My Comment' });
    const res = await app.request(`/api/bbs/threads/${threadId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: 'My Comment',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ id: 'comment-new', content: 'My Comment' });
    expect(mocks.createComment).toHaveBeenCalledWith(
      threadId,
      { content: 'My Comment' },
      'user-123'
    );
  });
});
