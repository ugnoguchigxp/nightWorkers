import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeCommand, copyDirectoryTool, isPathSafe } from '../../api/services/worker-tools';

describe('Worker Tools Unit Tests', () => {
  it('allows valid paths inside repo root', () => {
    const isSafe = isPathSafe(path.join(dummyRepoDir, 'hello.txt'), dummyRepoDir);
    expect(isSafe).toBe(true);
  });

  it('blocks directory traversals escaping repo root', () => {
    const isSafe = isPathSafe(path.join(dummyRepoDir, '../../package.json'), dummyRepoDir);
    expect(isSafe).toBe(false);
  });

  it('allows external paths only when explicitly granted', async () => {
    const externalDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nightworkers-external-'));
    try {
      const externalFile = path.join(externalDir, 'template.txt');
      await fs.writeFile(externalFile, 'template', 'utf-8');
      expect(isPathSafe(externalFile, dummyRepoDir)).toBe(false);
      expect(isPathSafe(externalFile, dummyRepoDir, undefined, undefined, [externalDir])).toBe(
        true
      );
    } finally {
      await fs.rm(externalDir, { recursive: true, force: true });
    }
  });

  it('copies from an explicitly granted external template directory', async () => {
    const externalDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nightworkers-template-'));
    const targetDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nightworkers-target-'));
    try {
      await fs.writeFile(path.join(externalDir, 'package.json'), '{"name":"template"}', 'utf-8');
      await fs.mkdir(path.join(externalDir, 'src'));
      await fs.writeFile(path.join(externalDir, 'src/index.ts'), 'export const ok = true;\n');

      const denied = await copyDirectoryTool({
        sourcePath: externalDir,
        repoRoot: targetDir,
      });
      expect(denied.ok).toBe(false);
      expect(denied.error?.code).toBe('ACCESS_DENIED');

      const copied = await copyDirectoryTool({
        sourcePath: externalDir,
        repoRoot: targetDir,
        externalAllowedPaths: [externalDir],
      });
      expect(copied.ok).toBe(true);
      await expect(fs.readFile(path.join(targetDir, 'src/index.ts'), 'utf-8')).resolves.toContain(
        'ok = true'
      );
    } finally {
      await fs.rm(externalDir, { recursive: true, force: true });
      await fs.rm(targetDir, { recursive: true, force: true });
    }
  });

  it('filters according to allowedPaths list', () => {
    const allowed = ['src'];
    const mainSafe = isPathSafe(path.join(dummyRepoDir, 'src/main.js'), dummyRepoDir, allowed);
    const rootUnsafe = isPathSafe(path.join(dummyRepoDir, 'hello.txt'), dummyRepoDir, allowed);
    expect(mainSafe).toBe(true);
    expect(rootUnsafe).toBe(false);
  });

  it('filters according to deniedPaths list', () => {
    const denied = ['src'];
    const mainUnsafe = isPathSafe(
      path.join(dummyRepoDir, 'src/main.js'),
      dummyRepoDir,
      undefined,
      denied
    );
    const rootSafe = isPathSafe(
      path.join(dummyRepoDir, 'hello.txt'),
      dummyRepoDir,
      undefined,
      denied
    );
    expect(mainUnsafe).toBe(false);
    expect(rootSafe).toBe(true);
  });
});

describe('Command safety Policy', () => {
  it('classifies read-only commands', () => {
    const safety = analyzeCommand('git status');
    expect(safety.allowed).toBe(true);
    expect(safety.classification).toBe('read_only');
  });

  it('blocks destructive commands', () => {
    const safety = analyzeCommand('rm -rf *');
    expect(safety.allowed).toBe(false);
    expect(safety.classification).toBe('destructive');
  });
});
