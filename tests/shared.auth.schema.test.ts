import { describe, expect, it } from 'vitest';
import { authResponseSchema, loginSchema, registerSchema } from '../shared/schemas/auth.schema';

describe('shared auth schemas', () => {
  it('validates login schema', () => {
    expect(
      loginSchema.parse({
        email: 'user@example.com',
        password: 'password123',
      })
    ).toEqual({
      email: 'user@example.com',
      password: 'password123',
    });
  });

  it('validates register schema', () => {
    expect(
      registerSchema.parse({
        email: 'user@example.com',
        password: 'password123',
        name: '<b>John Doe</b>',
      })
    ).toEqual({
      email: 'user@example.com',
      password: 'password123',
      name: 'John Doe',
    });
  });

  it('validates auth response schema', () => {
    const parsed = authResponseSchema.parse({
      user: {
        id: 'user-1',
        email: 'user@example.com',
      },
    });
    expect(parsed.user.email).toBe('user@example.com');
  });
});
