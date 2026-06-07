import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeCommand, applyPatchTool, readFileTool } from '../../api/services/worker-tools';

describe('Worker Tools Unit Tests', () => {
  it('blocks custom blocked commands', () => {
    const safety = analyzeCommand('npm publish', ['npm publish']);
    expect(safety.allowed).toBe(false);
    expect(safety.classification).toBe('destructive');
  });

  it('denies unknown command by default', () => {
    const safety = analyzeCommand('curl https://example.com');
    expect(safety.allowed).toBe(false);
    expect(safety.classification).toBe('unknown');
  });

  it('denies chained commands by default', () => {
    const safety = analyzeCommand('pnpm test && rm -rf .');
    expect(safety.allowed).toBe(false);
    expect(safety.classification).toBe('destructive');
  });

  it('denies mutating git commands by default', () => {
    const safety = analyzeCommand('git push origin main');
    expect(safety.allowed).toBe(false);
    expect(safety.classification).toBe('destructive');
  });
});

describe('applyPatchTool', () => {
  it('applies a Codex add-file patch envelope', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nightworkers-apply-patch-'));
    execFileSync('git', ['init'], { cwd: repoRoot });

    const result = await applyPatchTool({
      repoRoot,
      patchContent: [
        '*** Begin Patch',
        '*** Add File: fizzbuzz.ts',
        '+const fizzbuzz = (n: number): string[] => {',
        '+  const result: string[] = [];',
        '+  for (let i = 1; i <= n; i += 1) {',
        '+    result.push(i % 15 === 0 ? "FizzBuzz" : String(i));',
        '+  }',
        '+  return result;',
        '+};',
        '+',
        '+export default fizzbuzz;',
        '*** End Patch',
      ].join('\n'),
    });

    expect(result.ok).toBe(true);
    expect(result.payload.changedFiles).toEqual(['fizzbuzz.ts']);
    await expect(fs.readFile(path.join(repoRoot, 'fizzbuzz.ts'), 'utf-8')).resolves.toContain(
      'export default fizzbuzz'
    );

    await fs.rm(repoRoot, { recursive: true, force: true });
  });

  it('applies a patch even when the hunk line count is stale', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nightworkers-apply-patch-'));
    execFileSync('git', ['init'], { cwd: repoRoot });

    const result = await applyPatchTool({
      repoRoot,
      patchContent: [
        '--- /dev/null',
        '+++ b/fizzbuzz.ts',
        '@@ -0,0 +1,17 @@',
        '+export function fizzbuzz(n: number): string {',
        '+  if (n % 15 === 0) return "FizzBuzz";',
        '+  if (n % 3 === 0) return "Fizz";',
        '+  if (n % 5 === 0) return "Buzz";',
        '+  return String(n);',
        '+}',
        '',
      ].join('\n'),
    });

    expect(result.ok).toBe(true);
    expect(result.payload.changedFiles).toEqual(['fizzbuzz.ts']);
    await expect(fs.readFile(path.join(repoRoot, 'fizzbuzz.ts'), 'utf-8')).resolves.toContain(
      'FizzBuzz'
    );

    await fs.rm(repoRoot, { recursive: true, force: true });
  });
});

describe('readFileTool', () => {
  it('reads complete file inside repo root', async () => {
    const result = await readFileTool({
      filePath: 'hello.txt',
      repoRoot: dummyRepoDir,
    });

    expect(result.ok).toBe(true);
    expect(result.payload.totalLines).toBe(4);
    expect(result.payload.content).toContain('1: line 1: hello');
  });

  it('blocks reading files outside repo root', async () => {
    const result = await readFileTool({
      filePath: '../package.json',
      repoRoot: dummyRepoDir,
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('ACCESS_DENIED');
  });
});
