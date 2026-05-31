import { describe, expect, it } from 'vitest';
import { cn } from '../src/lib/utils';

describe('cn', () => {
  it('merges class names and resolves conflicts', () => {
    expect(cn('p-2', 'p-4', false && 'hidden', 'text-sm')).toBe('p-4 text-sm');
  });
});
