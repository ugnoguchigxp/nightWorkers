import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../api/lib/password';

describe('password utils', () => {
  it('hashes and verifies a password', async () => {
    const password = 'test-password-123';
    const hash = await hashPassword(password);

    expect(hash).not.toBe(password);
    await expect(verifyPassword(password, hash)).resolves.toBe(true);
  });

  it('returns false for wrong password', async () => {
    const hash = await hashPassword('correct-password');
    await expect(verifyPassword('wrong-password', hash)).resolves.toBe(false);
  });
});
