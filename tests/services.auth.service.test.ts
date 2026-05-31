import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthError, ValidationError } from '../api/lib/errors';

const mocks = vi.hoisted(() => {
  const config = {
    AUTH_MODE: 'both' as 'local' | 'oauth' | 'both',
  };

  const db = {
    transaction: vi.fn(),
  };

  return {
    config,
    db,
    hashPassword: vi.fn(),
    verifyPassword: vi.fn(),
    findByEmail: vi.fn(),
    findById: vi.fn(),
    createUser: vi.fn(),
    generateAccessToken: vi.fn(),
    generateRefreshToken: vi.fn(),
    revokeRefreshToken: vi.fn(),
    verifyRefreshToken: vi.fn(),
  };
});

vi.mock('../api/config', () => ({
  config: mocks.config,
}));

vi.mock('../api/db/client', () => ({
  db: mocks.db,
}));

vi.mock('../api/lib/password', () => ({
  hashPassword: mocks.hashPassword,
  verifyPassword: mocks.verifyPassword,
}));

vi.mock('../api/services/user.service', () => ({
  findByEmail: mocks.findByEmail,
  findById: mocks.findById,
  create: mocks.createUser,
}));

vi.mock('../api/services/token.service', () => ({
  generateAccessToken: mocks.generateAccessToken,
  generateRefreshToken: mocks.generateRefreshToken,
  revokeRefreshToken: mocks.revokeRefreshToken,
  verifyRefreshToken: mocks.verifyRefreshToken,
}));

import { generateTokens, login, logout, refresh, register } from '../api/services/auth.service';

describe('auth.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.config.AUTH_MODE = 'both';
    mocks.generateAccessToken.mockResolvedValue('access-token');
    mocks.generateRefreshToken.mockResolvedValue('refresh-token');
    mocks.db.transaction.mockImplementation(async (cb) => cb({ tx: true }));
  });

  it('registers local user and returns token pair', async () => {
    mocks.findByEmail.mockResolvedValue(undefined);
    mocks.hashPassword.mockResolvedValue('hashed-password');
    mocks.createUser.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
    });

    const result = await register({
      email: 'user@example.com',
      password: 'password123',
      name: 'User',
    });

    expect(mocks.hashPassword).toHaveBeenCalledWith('password123');
    expect(mocks.createUser).toHaveBeenCalledWith({
      email: 'user@example.com',
      passwordHash: 'hashed-password',
      name: 'User',
    });
    expect(result).toEqual({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      user: {
        id: 'user-1',
        email: 'user@example.com',
      },
    });
  });

  it('rejects registration when email already exists', async () => {
    mocks.findByEmail.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
    });

    await expect(
      register({
        email: 'user@example.com',
        password: 'password123',
        name: 'User',
      })
    ).rejects.toThrow(ValidationError);
  });

  it('rejects register/login in oauth-only mode', async () => {
    mocks.config.AUTH_MODE = 'oauth';

    await expect(
      register({
        email: 'user@example.com',
        password: 'password123',
        name: 'User',
      })
    ).rejects.toThrow('Local authentication is disabled');

    await expect(
      login({
        email: 'user@example.com',
        password: 'password123',
      })
    ).rejects.toThrow('Local authentication is disabled');
  });

  it('rejects login when user not found or inactive', async () => {
    mocks.findByEmail.mockResolvedValue(undefined);
    await expect(
      login({
        email: 'user@example.com',
        password: 'password123',
      })
    ).rejects.toThrow(AuthError);
  });

  it('rejects login when password is invalid', async () => {
    mocks.findByEmail.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      isActive: true,
      passwordHash: 'stored-hash',
    });
    mocks.verifyPassword.mockResolvedValue(false);

    await expect(
      login({
        email: 'user@example.com',
        password: 'wrong-password',
      })
    ).rejects.toThrow(AuthError);
  });

  it('logs in and returns tokens for valid credentials', async () => {
    mocks.findByEmail.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      isActive: true,
      passwordHash: 'stored-hash',
    });
    mocks.verifyPassword.mockResolvedValue(true);

    const result = await login({
      email: 'user@example.com',
      password: 'password123',
    });

    expect(result.accessToken).toBe('access-token');
    expect(result.refreshToken).toBe('refresh-token');
  });

  it('refreshes tokens inside transaction', async () => {
    const tx = { tx: true };
    mocks.db.transaction.mockImplementation(async (cb) => cb(tx));
    mocks.verifyRefreshToken.mockResolvedValue({
      userId: 'user-1',
      email: 'user@example.com',
      type: 'refresh',
    });
    mocks.findById.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      isActive: true,
    });

    const result = await refresh('old-refresh-token');

    expect(mocks.verifyRefreshToken).toHaveBeenCalledWith('old-refresh-token', tx);
    expect(mocks.revokeRefreshToken).not.toHaveBeenCalled();
    expect(result).toEqual({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      user: {
        id: 'user-1',
        email: 'user@example.com',
      },
    });
  });

  it('rejects refresh when user is inactive', async () => {
    mocks.verifyRefreshToken.mockResolvedValue({
      userId: 'user-1',
      email: 'user@example.com',
      type: 'refresh',
    });
    mocks.findById.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      isActive: false,
    });

    await expect(refresh('old-refresh-token')).rejects.toThrow(
      'User account is inactive or deleted'
    );
  });

  it('logout revokes refresh token when present', async () => {
    await logout('refresh-token');
    expect(mocks.revokeRefreshToken).toHaveBeenCalledWith('refresh-token');
  });

  it('logout does nothing when token is missing', async () => {
    await logout();
    expect(mocks.revokeRefreshToken).not.toHaveBeenCalled();
  });

  it('generateTokens delegates to token service', async () => {
    const result = await generateTokens({
      id: 'user-1',
      email: 'user@example.com',
    });

    expect(mocks.generateAccessToken).toHaveBeenCalledWith({
      userId: 'user-1',
      email: 'user@example.com',
    });
    expect(mocks.generateRefreshToken).toHaveBeenCalledWith(
      {
        userId: 'user-1',
        email: 'user@example.com',
      },
      undefined
    );
    expect(result.user).toEqual({
      id: 'user-1',
      email: 'user@example.com',
    });
  });
});
