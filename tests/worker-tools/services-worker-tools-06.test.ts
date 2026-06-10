import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { analyzeCommand, gitDiffTool, runCommandTool } from '../../api/services/worker-tools';

let dummyRepoDir: string;

beforeEach(async () => {
  dummyRepoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nightworkers-worker-tools-'));
});

afterEach(async () => {
  await fs.rm(dummyRepoDir, { recursive: true, force: true });
});

describe('Worker Tools Unit Tests', () => {
  it('blocks chained commands', async () => {
    const result = await runCommandTool({
      command: 'pnpm test && rm -rf .',
      repoRoot: dummyRepoDir,
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('DESTRUCTIVE_COMMAND');
  });

  it('does not allow substring-matched build command names', () => {
    const safety = analyzeCommand('xpnpm test run tests/foo.ts');
    expect(safety.allowed).toBe(false);
    expect(safety.classification).toBe('unknown');
  });

  it('stores full command output as an artifact when preview is truncated', async () => {
    const longOutput = 'x'.repeat(21000);
    const result = await runCommandTool({
      command: `echo "${longOutput}"`,
      repoRoot: dummyRepoDir,
    });

    expect(result.ok).toBe(true);
    expect(result.payload.truncated).toBe(true);
    expect(result.payload.stdout).toContain('[command-output-compressed]');
    expect(result.payload.compression?.stdout?.strategy).toBe('log_error_tail');
    expect(result.payload.logArtifactPath).toBeTruthy();

    const artifact = await fs.readFile(result.payload.logArtifactPath as string, 'utf-8');
    expect(artifact).toContain(longOutput);
  });
});

describe('gitDiffTool', () => {
  it('includes untracked files in diff evidence', async () => {
    const repoDir = path.join(dummyRepoDir, 'git-diff-untracked');
    await fs.rm(repoDir, { recursive: true, force: true });
    await fs.mkdir(repoDir, { recursive: true });
    await fs.writeFile(path.join(repoDir, 'README.md'), '# fixture\n', 'utf-8');
    execFileSync('git', ['init'], { cwd: repoDir, stdio: 'ignore' });
    execFileSync('git', ['add', 'README.md'], { cwd: repoDir, stdio: 'ignore' });
    execFileSync(
      'git',
      [
        '-c',
        'user.email=e2e@example.test',
        '-c',
        'user.name=NightWorkers Test',
        'commit',
        '-m',
        'initial',
      ],
      { cwd: repoDir, stdio: 'ignore' }
    );
    await fs.mkdir(path.join(repoDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(repoDir, 'src/new-file.txt'), 'untracked evidence\n', 'utf-8');

    const result = await gitDiffTool({ repoRoot: repoDir });

    expect(result.ok).toBe(true);
    expect(result.payload.hasChanges).toBe(true);
    expect(result.payload.diff).toContain('src/new-file.txt');
    expect(result.payload.diff).toContain('@@ -0,0 +1,1 @@');
    expect(result.payload.diff).toContain('+untracked evidence');
  });
});
