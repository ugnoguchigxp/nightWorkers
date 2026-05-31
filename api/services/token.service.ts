import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { jwtVerify, SignJWT } from 'jose';
import { config } from '../config';
import { type DbTransaction, db } from '../db/client';
import { refreshTokens } from '../db/schema';
import { AuthError } from '../lib/errors';
import type { JWTPayload } from '../lib/types';
import { jwtPayloadSchema } from '../lib/types';

const secretKey = new TextEncoder().encode(config.JWT_SECRET);

const hashToken = (token: string): string => {
  return createHash('sha256').update(token).digest('hex');
};

export const generateAccessToken = async (payload: Omit<JWTPayload, 'type'>): Promise<string> => {
  return new SignJWT({ ...payload, type: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(config.JWT_ACCESS_EXPIRES_IN)
    .sign(secretKey);
};

export const generateRefreshToken = async (
  payload: Omit<JWTPayload, 'type'>,
  tx?: DbTransaction
): Promise<string> => {
  const token = await new SignJWT({ ...payload, type: 'refresh' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(config.JWT_REFRESH_EXPIRES_IN)
    .sign(secretKey);

  const { payload: decoded } = await jwtVerify(token, secretKey);
  const expiresAt = new Date((decoded.exp as number) * 1000);
  const tokenHash = hashToken(token);

  const d = tx || db;
  await d.insert(refreshTokens).values({
    token: tokenHash,
    userId: payload.userId,
    expiresAt,
  });

  return token;
};

export const verifyAccessToken = async (token: string): Promise<JWTPayload> => {
  try {
    const { payload } = await jwtVerify(token, secretKey);
    if (payload.type !== 'access') throw new Error('Invalid token type');
    return jwtPayloadSchema.parse(payload);
  } catch {
    throw new AuthError('Invalid or expired access token');
  }
};

export const verifyRefreshToken = async (
  token: string,
  tx?: DbTransaction
): Promise<JWTPayload> => {
  const tokenHash = hashToken(token);
  const d = tx || db;
  // Delete first to guarantee one-time use even under concurrent refresh requests.
  const [storedToken] = await d
    .delete(refreshTokens)
    .where(eq(refreshTokens.token, tokenHash))
    .returning({
      expiresAt: refreshTokens.expiresAt,
    });

  if (!storedToken) {
    throw new AuthError('Invalid refresh token');
  }

  if (new Date() > storedToken.expiresAt) {
    throw new AuthError('Refresh token expired');
  }

  try {
    const { payload } = await jwtVerify(token, secretKey);
    if (payload.type !== 'refresh') throw new Error('Invalid token type');
    return jwtPayloadSchema.parse(payload);
  } catch {
    throw new AuthError('Invalid refresh token');
  }
};

export const revokeRefreshToken = async (token: string, tx?: DbTransaction): Promise<void> => {
  const tokenHash = hashToken(token);
  const d = tx || db;
  await d.delete(refreshTokens).where(eq(refreshTokens.token, tokenHash));
};
