import { beforeEach, describe, expect, it, vi } from 'vitest';
import { comments, threads } from '../api/db/schema';

const mocks = vi.hoisted(() => {
  const selectResult = {
    from: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    // biome-ignore lint/suspicious/noThenProperty: necessary mock for drizzle thenable chain
    then: vi.fn((resolve) => resolve([])),
  };

  const insertResult = {
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
  };

  const db = {
    select: vi.fn().mockReturnValue(selectResult),
    insert: vi.fn().mockReturnValue(insertResult),
  };

  return {
    db,
    selectResult,
    insertResult,
  };
});

vi.mock('../api/db/client', () => ({
  db: mocks.db,
}));

import {
  findAllThreads,
  findCommentById,
  findCommentsByThreadId,
  findThreadById,
  insertComment,
  insertThread,
} from '../api/modules/bbs/bbs.repository';

describe('bbs.repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock implementations
    mocks.selectResult.then.mockImplementation((resolve) => resolve([]));
    mocks.insertResult.returning.mockResolvedValue([]);
  });

  describe('findAllThreads', () => {
    it('selects and orders threads', async () => {
      mocks.selectResult.then.mockImplementation((resolve) => resolve([{ id: 't-1' }]));
      const result = await findAllThreads();
      expect(mocks.db.select).toHaveBeenCalled();
      expect(result).toEqual([{ id: 't-1' }]);
    });
  });

  describe('findThreadById', () => {
    it('queries thread by id and returns it', async () => {
      mocks.selectResult.then.mockImplementation((resolve) => resolve([{ id: 't-1' }]));
      const result = await findThreadById('t-1');
      expect(result).toEqual({ id: 't-1' });
    });

    it('returns null if not found', async () => {
      mocks.selectResult.then.mockImplementation((resolve) => resolve([]));
      const result = await findThreadById('t-none');
      expect(result).toBeNull();
    });
  });

  describe('findCommentsByThreadId', () => {
    it('queries comments by threadId and orders them', async () => {
      mocks.selectResult.then.mockImplementation((resolve) => resolve([{ id: 'c-1' }]));
      const result = await findCommentsByThreadId('t-1');
      expect(result).toEqual([{ id: 'c-1' }]);
    });
  });

  describe('findCommentById', () => {
    it('queries comment by id and returns it', async () => {
      mocks.selectResult.then.mockImplementation((resolve) => resolve([{ id: 'c-1' }]));
      const result = await findCommentById('c-1');
      expect(result).toEqual({ id: 'c-1' });
    });

    it('returns null if not found', async () => {
      mocks.selectResult.then.mockImplementation((resolve) => resolve([]));
      const result = await findCommentById('c-none');
      expect(result).toBeNull();
    });
  });

  describe('insertThread', () => {
    it('inserts a thread and returns the created record', async () => {
      const mockThread = { id: 't-new', title: 'New' };
      mocks.insertResult.returning.mockResolvedValue([mockThread]);
      const result = await insertThread({ title: 'New', content: 'content' }, 'user-1');
      expect(mocks.db.insert).toHaveBeenCalledWith(threads);
      expect(result).toEqual(mockThread);
    });
  });

  describe('insertComment', () => {
    it('inserts a comment and returns the created record', async () => {
      const mockComment = { id: 'c-new', content: 'hello' };
      mocks.insertResult.returning.mockResolvedValue([mockComment]);
      const result = await insertComment(
        't-1',
        { content: 'hello', parentId: 'c-parent' },
        'user-1'
      );
      expect(mocks.db.insert).toHaveBeenCalledWith(comments);
      expect(result).toEqual(mockComment);
    });
  });
});
