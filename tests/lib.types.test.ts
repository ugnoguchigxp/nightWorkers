import { describe, expect, it } from 'vitest';
import { jwtPayloadSchema } from '../api/lib/types';

describe('jwtPayloadSchema', () => {
  it('parses valid access payload', () => {
    const result = jwtPayloadSchema.parse({
      userId: 'user-1',
      email: 'user@example.com',
      type: 'access',
    });
    expect(result.type).toBe('access');
  });

  it('throws when email is invalid', () => {
    expect(() =>
      jwtPayloadSchema.parse({
        userId: 'user-1',
        email: 'invalid-email',
        type: 'access',
      })
    ).toThrow();
  });

  it('throws when type is invalid', () => {
    expect(() =>
      jwtPayloadSchema.parse({
        userId: 'user-1',
        email: 'user@example.com',
        type: 'other',
      })
    ).toThrow();
  });
});
