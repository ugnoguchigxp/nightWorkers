import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ValidationError } from '../api/lib/errors';
import { validationHook } from '../api/lib/validation-hook';

describe('validationHook', () => {
  it('does not throw on success result', () => {
    expect(() =>
      validationHook({
        success: true,
        data: { ok: true },
      })
    ).not.toThrow();
  });

  it('throws ValidationError with flattened details on failure', () => {
    const schema = z.object({
      name: z.string().min(1),
    });
    const result = schema.safeParse({ name: '' });
    expect(result.success).toBe(false);

    expect(() => validationHook(result)).toThrow(ValidationError);
    try {
      validationHook(result);
    } catch (err) {
      const e = err as ValidationError;
      expect(e.message).toBe('Validation error');
      expect(e.details).toBeDefined();
    }
  });
});
