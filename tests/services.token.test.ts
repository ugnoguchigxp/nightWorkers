import { SignJWT } from 'jose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../api/config';
import { AuthError } from '../api/lib/errors';

const mocks = vi.hoisted(() => {
  const eq = vi.fn(() => 'eq-condition');

  const insertValues = vi.fn();
  const insert = vi.fn(() => ({ values: insertValues }));

  const returningDelete = vi.fn();
  const whereDelete = vi.fn(() => ({ returning: returningDelete }));
  const deleteFn = vi.fn(() => ({ where: whereDelete }));

  return {
    eq,
    insertValues,
    insert,
    returningDelete,
    whereDelete,
    deleteFn,
  };
});

vi.mock('drizzle-orm', () => ({
  eq: mocks.eq,
}));

vi.mock('../api/db/client', () => ({
  db: {
    insert: mocks.insert,
    delete: mocks.deleteFn,
  },
}));

vi.mock('../api/db/schema', () => ({
  refreshTokens: {
    token: 'token',
  },
}));

import {
  generateAccessToken,
  generateRefreshToken,
  revokeRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from '../api/services/token.service';

const createRefreshJwt = async () => {
  const secretKey = new TextEncoder().encode(config.JWT_SECRET);
  return new SignJWT({
    userId: 'user-1',
    email: 'user@example.com',
    type: 'refresh',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(secretKey);
};

describe('token.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generates and verifies access token', async () => {
    const token = await generateAccessToken({
      userId: 'user-1',
      email: 'user@example.com',
    });

    const payload = await verifyAccessToken(token);
    expect(payload).toMatchObject({
      userId: 'user-1',
      email: 'user@example.com',
      type: 'access',
    });
  });

  it('rejects non-access token in verifyAccessToken', async () => {
    const refreshToken = await createRefreshJwt();
    await expect(verifyAccessToken(refreshToken)).rejects.toThrow(AuthError);
  });

  it('generates refresh token and stores hashed token', async () => {
    mocks.insertValues.mockResolvedValueOnce(undefined);

    const refreshToken = await generateRefreshToken({
      userId: 'user-1',
      email: 'user@example.com',
    });

    expect(typeof refreshToken).toBe('string');
    expect(mocks.insert).toHaveBeenCalledTimes(1);
    expect(mocks.insertValues).toHaveBeenCalledTimes(1);

    const stored = mocks.insertValues.mock.calls[0][0] as {
      token: string;
      userId: string;
      expiresAt: Date;
    };
    expect(stored.userId).toBe('user-1');
    expect(stored.token).not.toBe(refreshToken);
    expect(stored.expiresAt).toBeInstanceOf(Date);
  });

  it('verifies refresh token when persisted and not expired', async () => {
    const refreshToken = await createRefreshJwt();
    mocks.returningDelete.mockResolvedValueOnce([
      {
        expiresAt: new Date(Date.now() + 60_000),
      },
    ]);

    const payload = await verifyRefreshToken(refreshToken);
    expect(payload.type).toBe('refresh');
    expect(payload.userId).toBe('user-1');
  });

  it('rejects refresh token when no persisted token exists', async () => {
    const refreshToken = await createRefreshJwt();
    mocks.returningDelete.mockResolvedValueOnce([]);

    await expect(verifyRefreshToken(refreshToken)).rejects.toThrow('Invalid refresh token');
  });

  it('allows refresh token only once', async () => {
    const refreshToken = await createRefreshJwt();
    mocks.returningDelete
      .mockResolvedValueOnce([
        {
          expiresAt: new Date(Date.now() + 60_000),
        },
      ])
      .mockResolvedValueOnce([]);

    await expect(verifyRefreshToken(refreshToken)).resolves.toMatchObject({
      type: 'refresh',
      userId: 'user-1',
    });
    await expect(verifyRefreshToken(refreshToken)).rejects.toThrow('Invalid refresh token');
  });

  it('revokes and rejects expired refresh token', async () => {
    const refreshToken = await createRefreshJwt();
    mocks.returningDelete.mockResolvedValueOnce([
      {
        expiresAt: new Date(Date.now() - 60_000),
      },
    ]);

    await expect(verifyRefreshToken(refreshToken)).rejects.toThrow('Refresh token expired');
    expect(mocks.deleteFn).toHaveBeenCalledTimes(1);
    expect(mocks.returningDelete).toHaveBeenCalledTimes(1);
  });

  it('consumes malformed refresh token when persisted record exists', async () => {
    mocks.returningDelete.mockResolvedValueOnce([
      {
        expiresAt: new Date(Date.now() + 60_000),
      },
    ]);

    await expect(verifyRefreshToken('not-a-jwt')).rejects.toThrow('Invalid refresh token');
    expect(mocks.deleteFn).toHaveBeenCalledTimes(1);
    expect(mocks.returningDelete).toHaveBeenCalledTimes(1);
  });

  it('revokeRefreshToken deletes hashed token record', async () => {
    await revokeRefreshToken('refresh-token');
    expect(mocks.deleteFn).toHaveBeenCalledTimes(1);
    expect(mocks.whereDelete).toHaveBeenCalledTimes(1);
  });
});
