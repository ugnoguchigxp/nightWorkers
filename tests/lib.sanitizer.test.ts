import { describe, expect, it } from 'vitest';
import { sanitize } from '../api/lib/sanitizer';

describe('sanitize', () => {
  it('removes html tags', () => {
    const input = '<script>alert(1)</script><b>hello</b>';
    expect(sanitize(input)).toBe('hello');
  });

  it('returns empty string as-is', () => {
    expect(sanitize('')).toBe('');
  });
});
