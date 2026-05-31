import { and, eq } from 'drizzle-orm';
import type { LoginInput, RegisterInput } from '../../shared/schemas/auth.schema';
import { config } from '../config';
import { type DbTransaction, db } from '../db/client';
import { userExternalAccounts, users } from '../db/schema';
import { AuthError, ValidationError } from '../lib/errors';
import { hashPassword, verifyPassword } from '../lib/password';
import {
  generateAccessToken,
  generateRefreshToken,
  revokeRefreshToken,
  verifyRefreshToken,
} from './token.service';
import { create as createUser, findByEmail, findById, type SelectUser } from './user.service';

// Check if given mode is enabled
const checkLocalMode = () => {
  if (config.AUTH_MODE === 'oauth') {
    throw new ValidationError('Local authentication is disabled');
  }
};

export const register = async (data: RegisterInput) => {
  checkLocalMode();

  const { email, password, name } = data;

  const existingUser = await findByEmail(email);
  if (existingUser) {
    throw new ValidationError('Email already in use');
  }

  const passwordHash = await hashPassword(password);
  const user = await createUser({
    email,
    passwordHash,
    name,
  });

  return generateTokens(user);
};

export const login = async (data: LoginInput) => {
  checkLocalMode();

  const { email, password } = data;

  const user = await findByEmail(email);
  if (!user?.passwordHash || !user.isActive) {
    throw new AuthError('Invalid email or password');
  }

  const isValid = await verifyPassword(password, user.passwordHash);
  if (!isValid) {
    throw new AuthError('Invalid email or password');
  }

  return generateTokens(user);
};

export const refresh = async (token: string) => {
  return db.transaction(async (tx) => {
    const payload = await verifyRefreshToken(token, tx);

    // Verify user still exists and active
    const user = await findById(payload.userId, tx);
    if (!user?.isActive) {
      throw new AuthError('User account is inactive or deleted');
    }

    return generateTokens(user, tx);
  });
};

export const logout = async (token?: string) => {
  if (token) {
    await revokeRefreshToken(token);
  }
};

export const generateTokens = async (user: { id: string; email: string }, tx?: DbTransaction) => {
  const payload = { userId: user.id, email: user.email };
  const accessToken = await generateAccessToken(payload);
  const refreshToken = await generateRefreshToken(payload, tx);

  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
    },
  };
};

export const handleExternalUser = async (
  provider: string,
  oauthUser: { id: string; email: string; name: string }
) => {
  return db.transaction(async (tx) => {
    const [existingExternal] = await tx
      .select()
      .from(userExternalAccounts)
      .where(
        and(
          eq(userExternalAccounts.provider, provider),
          eq(userExternalAccounts.externalId, oauthUser.id)
        )
      );

    if (existingExternal) {
      const [user] = await tx.select().from(users).where(eq(users.id, existingExternal.userId));
      return user;
    }

    // Try linking by email
    let user: SelectUser;
    const [existingUserByEmail] = await tx
      .select()
      .from(users)
      .where(eq(users.email, oauthUser.email));

    if (existingUserByEmail) {
      user = existingUserByEmail;
    } else {
      const [newUser] = await tx
        .insert(users)
        .values({
          email: oauthUser.email,
          name: oauthUser.name,
        })
        .returning();
      user = newUser;
    }

    await tx.insert(userExternalAccounts).values({
      userId: user.id,
      provider: provider,
      externalId: oauthUser.id,
      email: oauthUser.email,
    });

    return user;
  });
};
