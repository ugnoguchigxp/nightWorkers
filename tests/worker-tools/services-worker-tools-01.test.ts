import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  analyzeCommand,
  cloneGitRepoTool,
  copyDirectoryTool,
  importProjectTool,
  isPathSafe,
  materializeTemplateTool,
} from '../../api/services/worker-tools';
import {
  resolveStandardTemplate,
  resolveStarterTemplate,
} from '../../api/services/worker-tools/template-registry';

let dummyRepoDir: string;
const execFileAsync = promisify(execFile);

beforeEach(async () => {
  dummyRepoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nightworkers-worker-tools-'));
  await fs.mkdir(path.join(dummyRepoDir, 'src'), { recursive: true });
  await fs.writeFile(path.join(dummyRepoDir, 'hello.txt'), 'hello\n', 'utf-8');
  await fs.writeFile(path.join(dummyRepoDir, 'src/main.js'), 'console.log("ok");\n', 'utf-8');
});

afterEach(async () => {
  await fs.rm(dummyRepoDir, { recursive: true, force: true });
});

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

  it('materializes a registered template variant into an empty project root', async () => {
    const templateRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'nightworkers-template-repo-'));
    const targetDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nightworkers-template-target-'));
    try {
      await fs.writeFile(path.join(templateRepo, 'package.json'), '{"scripts":{"test":"vitest"}}');
      await fs.mkdir(path.join(templateRepo, 'src'));
      await fs.writeFile(path.join(templateRepo, 'src/index.ts'), 'export const ok = true;\n');
      await fs.mkdir(path.join(templateRepo, 'node_modules'));
      await fs.writeFile(path.join(templateRepo, 'node_modules/ignored.txt'), 'ignored');
      await execFileAsync('git', ['init'], { cwd: templateRepo });
      await execFileAsync('git', ['add', '.'], { cwd: templateRepo });
      await execFileAsync(
        'git',
        ['-c', 'user.name=Test User', '-c', 'user.email=test@example.com', 'commit', '-m', 'init'],
        { cwd: templateRepo }
      );
      await execFileAsync('git', ['tag', 'sqlite-v1.0.0'], { cwd: templateRepo });
      await execFileAsync('git', ['tag', 'overlay-ssr-v1.0.0'], { cwd: templateRepo });

      const result = await materializeTemplateTool({
        templateId: 'python-standard',
        variant: 'sqlite',
        repoRoot: targetDir,
        registry: {
          'hono-standard': {
            id: 'hono-standard',
            repoUrl: templateRepo,
            defaultVariant: 'sqlite',
            variants: {
              sqlite: { name: 'sqlite', ref: 'sqlite-v1.0.0', description: 'test' },
            },
            overlays: {},
          },
          'python-standard': {
            id: 'python-standard',
            repoUrl: templateRepo,
            defaultVariant: 'sqlite',
            variants: {
              sqlite: { name: 'sqlite', ref: 'sqlite-v1.0.0', description: 'test' },
            },
            overlays: {},
          },
        },
      });

      expect(result.ok).toBe(true);
      expect(result.payload?.ref).toBe('sqlite-v1.0.0');
      await expect(fs.readFile(path.join(targetDir, 'src/index.ts'), 'utf-8')).resolves.toContain(
        'ok = true'
      );
      await expect(fs.stat(path.join(targetDir, 'node_modules'))).rejects.toThrow();
    } finally {
      await fs.rm(templateRepo, { recursive: true, force: true });
      await fs.rm(targetDir, { recursive: true, force: true });
    }
  });

  it('imports a registered template through the unified project import tool', async () => {
    const templateRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'nightworkers-template-repo-'));
    const targetDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nightworkers-template-target-'));
    try {
      await fs.writeFile(path.join(templateRepo, 'package.json'), '{"scripts":{"test":"vitest"}}');
      await fs.mkdir(path.join(templateRepo, 'src'));
      await fs.writeFile(path.join(templateRepo, 'src/index.ts'), 'export const ok = true;\n');
      await execFileAsync('git', ['init'], { cwd: templateRepo });
      await execFileAsync('git', ['add', '.'], { cwd: templateRepo });
      await execFileAsync(
        'git',
        ['-c', 'user.name=Test User', '-c', 'user.email=test@example.com', 'commit', '-m', 'init'],
        { cwd: templateRepo }
      );
      await execFileAsync('git', ['tag', 'sqlite-v1.0.0'], { cwd: templateRepo });

      const result = await importProjectTool({
        source: 'starter',
        stack: 'hono',
        variant: 'sqlite',
        repoRoot: targetDir,
        registry: {
          'hono-standard': {
            id: 'hono-standard',
            repoUrl: templateRepo,
            defaultVariant: 'sqlite',
            variants: {
              sqlite: { name: 'sqlite', ref: 'sqlite-v1.0.0', description: 'test' },
            },
            overlays: {},
          },
          'python-standard': {
            id: 'python-standard',
            repoUrl: templateRepo,
            defaultVariant: 'sqlite',
            variants: {
              sqlite: { name: 'sqlite', ref: 'sqlite-v1.0.0', description: 'test' },
            },
            overlays: {},
          },
        },
      });

      expect(result.ok).toBe(true);
      expect(result.toolName).toBe('import_project');
      expect(result.payload?.mode).toBe('template');
      expect(result.payload?.template?.ref).toBe('sqlite-v1.0.0');
      await expect(fs.readFile(path.join(targetDir, 'src/index.ts'), 'utf-8')).resolves.toContain(
        'ok = true'
      );
    } finally {
      await fs.rm(templateRepo, { recursive: true, force: true });
      await fs.rm(targetDir, { recursive: true, force: true });
    }
  });

  it('materializes a registered template into an empty package path inside an initialized repo', async () => {
    const templateRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'nightworkers-template-repo-'));
    const targetDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nightworkers-template-target-'));
    try {
      await fs.writeFile(path.join(templateRepo, 'package.json'), '{"name":"template-root"}');
      await fs.mkdir(path.join(templateRepo, 'src'));
      await fs.writeFile(path.join(templateRepo, 'src/index.ts'), 'export const ok = true;\n');
      await execFileAsync('git', ['init'], { cwd: templateRepo });
      await execFileAsync('git', ['add', '.'], { cwd: templateRepo });
      await execFileAsync(
        'git',
        ['-c', 'user.name=Test User', '-c', 'user.email=test@example.com', 'commit', '-m', 'init'],
        { cwd: templateRepo }
      );
      await execFileAsync('git', ['tag', 'sqlite-v1.0.0'], { cwd: templateRepo });

      await execFileAsync('git', ['init'], { cwd: targetDir });
      await fs.writeFile(
        path.join(targetDir, 'pnpm-workspace.yaml'),
        'packages:\n  - packages/*\n'
      );
      await fs.mkdir(path.join(targetDir, 'packages/app'), { recursive: true });

      const result = await materializeTemplateTool({
        templateId: 'hono-standard',
        targetPath: 'packages/app',
        repoRoot: targetDir,
        registry: {
          'hono-standard': {
            id: 'hono-standard',
            repoUrl: templateRepo,
            defaultVariant: 'sqlite',
            variants: {
              sqlite: { name: 'sqlite', ref: 'sqlite-v1.0.0', description: 'test' },
            },
            overlays: {},
          },
          'python-standard': {
            id: 'python-standard',
            repoUrl: templateRepo,
            defaultVariant: 'sqlite',
            variants: {
              sqlite: { name: 'sqlite', ref: 'sqlite-v1.0.0', description: 'test' },
            },
            overlays: {},
          },
        },
      });

      expect(result.ok).toBe(true);
      expect(result.payload?.targetPath).toBe(path.join(targetDir, 'packages/app'));
      await expect(
        fs.readFile(path.join(targetDir, 'packages/app/src/index.ts'), 'utf-8')
      ).resolves.toContain('ok = true');
    } finally {
      await fs.rm(templateRepo, { recursive: true, force: true });
      await fs.rm(targetDir, { recursive: true, force: true });
    }
  });

  it('clones a git repository into the project and strips nested git metadata by default', async () => {
    const sourceRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'nightworkers-clone-source-'));
    const targetDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nightworkers-clone-target-'));
    try {
      await fs.writeFile(path.join(sourceRepo, 'README.md'), '# imported\n', 'utf-8');
      await fs.mkdir(path.join(sourceRepo, 'src'));
      await fs.writeFile(path.join(sourceRepo, 'src/index.ts'), 'export const imported = true;\n');
      await execFileAsync('git', ['init'], { cwd: sourceRepo });
      await execFileAsync('git', ['add', '.'], { cwd: sourceRepo });
      await execFileAsync(
        'git',
        ['-c', 'user.name=Test User', '-c', 'user.email=test@example.com', 'commit', '-m', 'init'],
        { cwd: sourceRepo }
      );

      const result = await cloneGitRepoTool({
        repoUrl: sourceRepo,
        targetPath: 'vendor/imported-repo',
        repoRoot: targetDir,
      });

      expect(result.ok).toBe(true);
      expect(result.payload?.repoUrl).toBe(sourceRepo);
      expect(result.payload?.targetPath).toBe(path.join(targetDir, 'vendor/imported-repo'));
      expect(result.payload?.strippedGitDir).toBe(true);
      await expect(
        fs.readFile(path.join(targetDir, 'vendor/imported-repo/src/index.ts'), 'utf-8')
      ).resolves.toContain('imported = true');
      await expect(fs.stat(path.join(targetDir, 'vendor/imported-repo/.git'))).rejects.toThrow();
    } finally {
      await fs.rm(sourceRepo, { recursive: true, force: true });
      await fs.rm(targetDir, { recursive: true, force: true });
    }
  });

  it('imports a git repository through the unified project import tool', async () => {
    const sourceRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'nightworkers-clone-source-'));
    const targetDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nightworkers-clone-target-'));
    try {
      await fs.writeFile(path.join(sourceRepo, 'README.md'), '# imported\n', 'utf-8');
      await execFileAsync('git', ['init'], { cwd: sourceRepo });
      await execFileAsync('git', ['add', '.'], { cwd: sourceRepo });
      await execFileAsync(
        'git',
        ['-c', 'user.name=Test User', '-c', 'user.email=test@example.com', 'commit', '-m', 'init'],
        { cwd: sourceRepo }
      );

      const result = await importProjectTool({
        repoUrl: sourceRepo,
        targetPath: 'vendor/imported-repo',
        repoRoot: targetDir,
      });

      expect(result.ok).toBe(true);
      expect(result.toolName).toBe('import_project');
      expect(result.payload?.mode).toBe('git');
      expect(result.payload?.git?.repoUrl).toBe(sourceRepo);
      await expect(
        fs.readFile(path.join(targetDir, 'vendor/imported-repo/README.md'), 'utf-8')
      ).resolves.toContain('imported');
    } finally {
      await fs.rm(sourceRepo, { recursive: true, force: true });
      await fs.rm(targetDir, { recursive: true, force: true });
    }
  });

  it('clones a requested ref and can preserve nested git metadata when asked', async () => {
    const sourceRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'nightworkers-clone-source-'));
    const targetDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nightworkers-clone-target-'));
    try {
      await fs.writeFile(path.join(sourceRepo, 'version.txt'), 'main\n', 'utf-8');
      await execFileAsync('git', ['init'], { cwd: sourceRepo });
      await execFileAsync('git', ['add', '.'], { cwd: sourceRepo });
      await execFileAsync(
        'git',
        ['-c', 'user.name=Test User', '-c', 'user.email=test@example.com', 'commit', '-m', 'main'],
        { cwd: sourceRepo }
      );
      await execFileAsync('git', ['checkout', '-b', 'feature/imported'], { cwd: sourceRepo });
      await fs.writeFile(path.join(sourceRepo, 'version.txt'), 'feature\n', 'utf-8');
      await execFileAsync('git', ['add', 'version.txt'], { cwd: sourceRepo });
      await execFileAsync(
        'git',
        [
          '-c',
          'user.name=Test User',
          '-c',
          'user.email=test@example.com',
          'commit',
          '-m',
          'feature',
        ],
        { cwd: sourceRepo }
      );

      const result = await cloneGitRepoTool({
        repoUrl: sourceRepo,
        ref: 'feature/imported',
        stripGitDir: false,
        repoRoot: targetDir,
      });

      expect(result.ok).toBe(true);
      expect(result.payload?.ref).toBe('feature/imported');
      await expect(
        fs.readFile(path.join(targetDir, path.basename(sourceRepo), 'version.txt'), 'utf-8')
      ).resolves.toBe('feature\n');
      await expect(
        fs.stat(path.join(targetDir, path.basename(sourceRepo), '.git'))
      ).resolves.toBeTruthy();
    } finally {
      await fs.rm(sourceRepo, { recursive: true, force: true });
      await fs.rm(targetDir, { recursive: true, force: true });
    }
  });

  it('does not delete the project root directory when overwriting into .', async () => {
    const sourceRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'nightworkers-clone-source-'));
    const targetDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nightworkers-clone-target-'));
    try {
      await fs.writeFile(path.join(sourceRepo, 'README.md'), '# imported\n', 'utf-8');
      await execFileAsync('git', ['init'], { cwd: sourceRepo });
      await execFileAsync('git', ['add', '.'], { cwd: sourceRepo });
      await execFileAsync(
        'git',
        ['-c', 'user.name=Test User', '-c', 'user.email=test@example.com', 'commit', '-m', 'init'],
        { cwd: sourceRepo }
      );
      await fs.writeFile(path.join(targetDir, 'stale.txt'), 'remove me\n', 'utf-8');

      const result = await cloneGitRepoTool({
        repoUrl: sourceRepo,
        targetPath: '.',
        overwrite: true,
        repoRoot: targetDir,
      });

      expect(result.ok).toBe(true);
      await expect(fs.readFile(path.join(targetDir, 'README.md'), 'utf-8')).resolves.toContain(
        'imported'
      );
      await expect(fs.stat(targetDir)).resolves.toBeTruthy();
      await expect(fs.stat(path.join(targetDir, 'stale.txt'))).rejects.toThrow();
    } finally {
      await fs.rm(sourceRepo, { recursive: true, force: true });
      await fs.rm(targetDir, { recursive: true, force: true });
    }
  });

  it('resolves the hono-standard rag variant from the standard registry', () => {
    const resolved = resolveStandardTemplate({
      templateId: 'hono-standard',
      variant: 'rag',
    });

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) throw new Error('expected rag variant to resolve');
    expect(resolved.variant.ref).toBe('rag-v1.0.0');
  });

  it('resolves a starter stack and variant into the internal template registry', () => {
    const resolved = resolveStarterTemplate({
      stack: 'python',
      variant: 'auth',
    });

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) throw new Error('expected auth starter variant to resolve');
    expect(resolved.template.id).toBe('python-standard');
    expect(resolved.variant.ref).toBe('auth-v1.0.0');
  });

  it('materializes a single registered overlay ref', async () => {
    const templateRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'nightworkers-template-repo-'));
    const targetDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nightworkers-template-target-'));
    try {
      await fs.writeFile(path.join(templateRepo, 'package.json'), '{"scripts":{"build":"vite"}}');
      await execFileAsync('git', ['init'], { cwd: templateRepo });
      await execFileAsync('git', ['add', '.'], { cwd: templateRepo });
      await execFileAsync(
        'git',
        ['-c', 'user.name=Test User', '-c', 'user.email=test@example.com', 'commit', '-m', 'init'],
        { cwd: templateRepo }
      );
      await execFileAsync('git', ['tag', 'sqlite-v1.1.0'], { cwd: templateRepo });
      await execFileAsync('git', ['tag', 'overlay-ssr-v1.0.0'], { cwd: templateRepo });

      const result = await materializeTemplateTool({
        templateId: 'hono-standard',
        overlays: ['ssr'],
        repoRoot: targetDir,
        registry: {
          'hono-standard': {
            id: 'hono-standard',
            repoUrl: templateRepo,
            defaultVariant: 'sqlite',
            variants: {
              sqlite: { name: 'sqlite', ref: 'sqlite-v1.1.0', description: 'test' },
            },
            overlays: {
              ssr: { name: 'ssr', ref: 'overlay-ssr-v1.0.0', description: 'test' },
            },
          },
          'python-standard': {
            id: 'python-standard',
            repoUrl: templateRepo,
            defaultVariant: 'sqlite',
            variants: {
              sqlite: { name: 'sqlite', ref: 'sqlite-v1.0.0', description: 'test' },
            },
            overlays: {},
          },
        },
      });

      expect(result.ok).toBe(true);
      expect(result.payload?.ref).toBe('overlay-ssr-v1.0.0');
      expect(result.payload?.overlays).toEqual(['ssr']);
    } finally {
      await fs.rm(templateRepo, { recursive: true, force: true });
      await fs.rm(targetDir, { recursive: true, force: true });
    }
  });

  it('rejects malformed template args and unsupported variant-overlay combinations', async () => {
    const invalid = await materializeTemplateTool({
      templateId: '',
      repoRoot: dummyRepoDir,
    });
    expect(invalid.ok).toBe(false);
    expect(invalid.error?.code).toBe('INVALID_TEMPLATE_ID');

    const conflicted = await materializeTemplateTool({
      templateId: 'hono-standard',
      variant: 'postgres',
      overlays: ['ssr'],
      repoRoot: dummyRepoDir,
    });
    expect(conflicted.ok).toBe(false);
    expect(conflicted.error?.code).toBe('TEMPLATE_VARIANT_OVERLAY_CONFLICT');
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

  it('classifies dev servers as background commands', () => {
    const result = analyzeCommand('pnpm dev');
    expect(result.allowed).toBe(true);
    expect(result.classification).toBe('background');
  });

  it('allows log-follow pipelines as background commands', () => {
    const result = analyzeCommand('tail -f logs/api.log | rg error');
    expect(result.allowed).toBe(true);
    expect(result.classification).toBe('background');
  });

  it('handles custom blocklist entries with regex characters literally', () => {
    const result = analyzeCommand('pnpm dev', ['pnpm dev [prod]']);
    expect(result.allowed).toBe(true);
    expect(result.classification).toBe('background');
  });

  it('blocks destructive commands', () => {
    const safety = analyzeCommand('rm -rf *');
    expect(safety.allowed).toBe(false);
    expect(safety.classification).toBe('destructive');
  });
});
