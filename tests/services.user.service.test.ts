import { beforeEach, describe, expect, it, vi } from 'vitest';
import { users } from '../api/db/schema';

const mocks = vi.hoisted(() => {
  const selectResult = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn(),
  };

  const insertResult = {
    values: vi.fn().mockReturnThis(),
    returning: vi.fn(),
  };

  const updateResult = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn(),
  };

  const db = {
    select: vi.fn().mockReturnValue(selectResult),
    insert: vi.fn().mockReturnValue(insertResult),
    update: vi.fn().mockReturnValue(updateResult),
  };

  return {
    db,
    selectResult,
    insertResult,
    updateResult,
  };
});

vi.mock('../api/db/client', () => ({
  db: mocks.db,
}));

import { create, findByEmail, findById, update } from '../api/services/user.service';

describe('user.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('findById', () => {
    it('queries users table by ID and returns user if found', async () => {
      const mockUser = { id: 'user-1', email: 'user@example.com' };
      mocks.selectResult.where.mockResolvedValue([mockUser]);

      const result = await findById('user-1');
      expect(mocks.db.select).toHaveBeenCalled();
      expect(mocks.selectResult.from).toHaveBeenCalledWith(users);
      expect(mocks.selectResult.where).toHaveBeenCalled();
      expect(result).toEqual(mockUser);
    });

    it('returns undefined if user is not found', async () => {
      mocks.selectResult.where.mockResolvedValue([]);
      const result = await findById('user-nonexistent');
      expect(result).toBeUndefined();
    });

    it('uses provided transaction client when passed', async () => {
      const txMocks = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockResolvedValue([{ id: 'user-1' }]),
        }),
      };

      const result = await findById('user-1', txMocks as any);
      expect(txMocks.select).toHaveBeenCalled();
      expect(mocks.db.select).not.toHaveBeenCalled();
      expect(result).toEqual({ id: 'user-1' });
    });
  });

  describe('findByEmail', () => {
    it('queries users table by email and returns user if found', async () => {
      const mockUser = { id: 'user-1', email: 'user@example.com' };
      mocks.selectResult.where.mockResolvedValue([mockUser]);

      const result = await findByEmail('user@example.com');
      expect(mocks.db.select).toHaveBeenCalled();
      expect(mocks.selectResult.from).toHaveBeenCalledWith(users);
      expect(mocks.selectResult.where).toHaveBeenCalled();
      expect(result).toEqual(mockUser);
    });

    it('returns undefined if email is not found', async () => {
      mocks.selectResult.where.mockResolvedValue([]);
      const result = await findByEmail('notfound@example.com');
      expect(result).toBeUndefined();
    });
  });

  describe('create', () => {
    it('inserts a new user and returns the created user details', async () => {
      const newUser = { email: 'new@example.com', name: 'New User', passwordHash: 'hash' };
      const createdUser = { id: 'user-2', ...newUser };
      mocks.insertResult.returning.mockResolvedValue([createdUser]);

      const result = await create(newUser);
      expect(mocks.db.insert).toHaveBeenCalledWith(users);
      expect(mocks.insertResult.values).toHaveBeenCalledWith(newUser);
      expect(mocks.insertResult.returning).toHaveBeenCalled();
      expect(result).toEqual(createdUser);
    });
  });

  describe('update', () => {
    it('updates user attributes and returns updated user', async () => {
      const updateData = { name: 'Updated Name' };
      const updatedUser = { id: 'user-1', email: 'user@example.com', name: 'Updated Name' };
      mocks.updateResult.returning.mockResolvedValue([updatedUser]);

      const result = await update('user-1', updateData);
      expect(mocks.db.update).toHaveBeenCalledWith(users);
      expect(mocks.updateResult.set).toHaveBeenCalledWith(updateData);
      expect(mocks.updateResult.where).toHaveBeenCalled();
      expect(mocks.updateResult.returning).toHaveBeenCalled();
      expect(result).toEqual(updatedUser);
    });

    it('returns undefined if updated user query returns empty', async () => {
      mocks.updateResult.returning.mockResolvedValue([]);
      const result = await update('user-nonexistent', { name: 'New' });
      expect(result).toBeUndefined();
    });
  });
});
