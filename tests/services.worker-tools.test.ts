import fs from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  analyzeCommand,
  applyPatchTool,
  gitDiffTool,
  gitStatusTool,
  isPathSafe,
  readFileTool,
  runCommandTool,
  searchFilesTool,
} from '../api/services/worker-tools';

describe('Worker Tools Unit Tests', () => {
  const dummyRepoDir = path.resolve(__dirname, '../scratch/dummy-repo');

  beforeAll(async () => {
    // Setup a temporary dummy workspace
    await fs.mkdir(dummyRepoDir, { recursive: true });
    await fs.writeFile(
      path.join(dummyRepoDir, 'hello.txt'),
      'line 1: hello\nline 2: world\nline 3: end\n',
      'utf-8'
    );
    await fs.mkdir(path.join(dummyRepoDir, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(dummyRepoDir, 'src/main.js'),
      'console.log("running");\n',
      'utf-8'
    );
  });

  afterAll(async () => {
    // Clean up temporary dummy workspace
    await fs.rm(dummyRepoDir, { recursive: true, force: true });
  });

  describe('Path Safety Policy', () => {
    it('allows valid paths inside repo root', () => {
      const isSafe = isPathSafe(path.join(dummyRepoDir, 'hello.txt'), dummyRepoDir);
      expect(isSafe).toBe(true);
    });

    it('blocks directory traversals escaping repo root', () => {
      const isSafe = isPathSafe(path.join(dummyRepoDir, '../../package.json'), dummyRepoDir);
      expect(isSafe).toBe(false);
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

    it('blocks custom blocked commands', () => {
      const safety = analyzeCommand('npm publish', ['npm publish']);
      expect(safety.allowed).toBe(false);
      expect(safety.classification).toBe('destructive');
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

  describe('searchFilesTool', () => {
    it('finds query matches inside repo files', async () => {
      const result = await searchFilesTool({
        query: 'hello',
        repoRoot: dummyRepoDir,
      });

      expect(result.ok).toBe(true);
      expect(result.payload.count).toBeGreaterThanOrEqual(1);
      expect(result.payload.matches[0].excerpt).toContain('hello');
    });
  });

  describe('runCommandTool', () => {
    it('runs safe commands successfully', async () => {
      const result = await runCommandTool({
        command: 'echo "hello"',
        repoRoot: dummyRepoDir,
      });

      expect(result.ok).toBe(true);
      expect(result.payload.stdout.trim()).toBe('hello');
    });

    it('blocks destructive commands from running', async () => {
      const result = await runCommandTool({
        command: 'rm -rf *',
        repoRoot: dummyRepoDir,
      });

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('DESTRUCTIVE_COMMAND');
    });
  });
});
