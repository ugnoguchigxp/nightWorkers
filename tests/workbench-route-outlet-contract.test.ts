import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '..');

function readRoute(relativePath: string) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf-8');
}

describe('workbench nested route outlet contract', () => {
  it('lets project detail tab URLs render the child route instead of the default detail route', () => {
    const source = readRoute('src/routes/projects.$projectId.detail.tsx');

    expect(source).toContain('Outlet');
    expect(source).toMatch(/location\.pathname !== `\/projects\/\$\{projectId\}\/detail`/);
    expect(source).toContain('return <Outlet />');
  });

  it('lets settings section URLs render the child route instead of the default settings route', () => {
    const source = readRoute('src/routes/settings.tsx');

    expect(source).toContain('Outlet');
    expect(source).toContain("location.pathname !== '/settings'");
    expect(source).toContain('return <Outlet />');
  });
});
