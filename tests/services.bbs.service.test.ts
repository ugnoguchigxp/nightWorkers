import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundError, ValidationError } from '../api/lib/errors';

const mocks = vi.hoisted(() => ({
  findAllThreads: vi.fn(),
  findThreadById: vi.fn(),
  findCommentsByThreadId: vi.fn(),
  insertThread: vi.fn(),
  findCommentById: vi.fn(),
  insertComment: vi.fn(),
}));

vi.mock('../api/modules/bbs/bbs.repository', () => ({
  findAllThreads: mocks.findAllThreads,
  findThreadById: mocks.findThreadById,
  findCommentsByThreadId: mocks.findCommentsByThreadId,
  insertThread: mocks.insertThread,
  findCommentById: mocks.findCommentById,
  insertComment: mocks.insertComment,
}));

import {
  createComment,
  createThread,
  getThread,
  listThreads,
} from '../api/modules/bbs/bbs.service';

describe('bbs.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listThreads', () => {
    it('returns all threads', async () => {
      mocks.findAllThreads.mockResolvedValue([{ id: 't-1' }]);
      const result = await listThreads();
      expect(result).toEqual([{ id: 't-1' }]);
    });
  });

  describe('getThread', () => {
    it('throws NotFoundError if thread does not exist', async () => {
      mocks.findThreadById.mockResolvedValue(null);
      await expect(getThread('t-1')).rejects.toThrow(NotFoundError);
    });

    it('returns thread with comments if found', async () => {
      mocks.findThreadById.mockResolvedValue({ id: 't-1', title: 'Thread 1' });
      mocks.findCommentsByThreadId.mockResolvedValue([{ id: 'c-1' }]);
      const result = await getThread('t-1');
      expect(result).toEqual({
        id: 't-1',
        title: 'Thread 1',
        comments: [{ id: 'c-1' }],
      });
    });
  });

  describe('createThread', () => {
    it('calls repository to insert a thread', async () => {
      mocks.insertThread.mockResolvedValue({ id: 't-1', title: 'New' });
      const result = await createThread({ title: 'New', content: 'hello' }, 'user-1');
      expect(mocks.insertThread).toHaveBeenCalledWith({ title: 'New', content: 'hello' }, 'user-1');
      expect(result).toEqual({ id: 't-1', title: 'New' });
    });
  });

  describe('createComment', () => {
    it('throws NotFoundError if thread does not exist', async () => {
      mocks.findThreadById.mockResolvedValue(null);
      await expect(createComment('t-1', { content: 'hello' }, 'user-1')).rejects.toThrow(
        NotFoundError
      );
    });

    it('throws NotFoundError if parent comment does not exist', async () => {
      mocks.findThreadById.mockResolvedValue({ id: 't-1' });
      mocks.findCommentById.mockResolvedValue(null);
      await expect(
        createComment('t-1', { content: 'hello', parentId: 'c-parent' }, 'user-1')
      ).rejects.toThrow(NotFoundError);
    });

    it('throws ValidationError if parent comment belongs to a different thread', async () => {
      mocks.findThreadById.mockResolvedValue({ id: 't-1' });
      mocks.findCommentById.mockResolvedValue({ id: 'c-parent', threadId: 't-different' });
      await expect(
        createComment('t-1', { content: 'hello', parentId: 'c-parent' }, 'user-1')
      ).rejects.toThrow(ValidationError);
    });

    it('creates comment successfully if all checks pass', async () => {
      mocks.findThreadById.mockResolvedValue({ id: 't-1' });
      mocks.findCommentById.mockResolvedValue({ id: 'c-parent', threadId: 't-1' });
      mocks.insertComment.mockResolvedValue({ id: 'c-new', content: 'hello' });

      const result = await createComment(
        't-1',
        { content: 'hello', parentId: 'c-parent' },
        'user-1'
      );
      expect(mocks.insertComment).toHaveBeenCalledWith(
        't-1',
        { content: 'hello', parentId: 'c-parent' },
        'user-1'
      );
      expect(result).toEqual({ id: 'c-new', content: 'hello' });
    });
  });
});
