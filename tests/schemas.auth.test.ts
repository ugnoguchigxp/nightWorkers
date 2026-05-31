import { describe, expect, it } from 'vitest';
import { loginSchema, registerSchema } from '../shared/schemas/auth.schema';

describe('auth schemas', () => {
  it('validates and sanitizes register payload', () => {
    const payload = registerSchema.parse({
      email: 'user@example.com',
      password: 'password123',
      name: '<b>Alice</b>',
    });

    expect(payload.email).toBe('user@example.com');
    expect(payload.name).toBe('Alice');
  });

  it('rejects short register password', () => {
    expect(() =>
      registerSchema.parse({
        email: 'user@example.com',
        password: 'short',
        name: 'Alice',
      })
    ).toThrow();
  });

  it('validates login payload', () => {
    expect(
      loginSchema.parse({
        email: 'user@example.com',
        password: 'p',
      })
    ).toEqual({
      email: 'user@example.com',
      password: 'p',
    });
  });
});
