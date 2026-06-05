import { describe, expect, it } from 'vitest';
import { runStartupPreflight } from '../api/services/preflight/preflight';

describe('startup preflight', () => {
  it('reports runtime and resource checks', () => {
    const result = runStartupPreflight();
    expect(result.mode).toMatch(/desktop|development/);
    expect(result.runtimeRoot).toBeTruthy();
    expect(result.resourceRoot).toBeTruthy();
    expect(result.checks.map((check) => check.id)).toEqual(
      expect.arrayContaining(['runtime-root', 'settings-dir', 'logs-dir', 'database-url'])
    );
  });
});
