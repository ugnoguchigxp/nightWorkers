import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  analyzeCommand,
  fetchContentTool,
  findFileTool,
  gitDiffTool,
  isPathSafe,
  listDirTool,
  readFileTool,
  replaceContentTool,
  runCommandTool,
  searchFilesTool,
  searchWebTool,
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

  afterEach(() => {
    vi.restoreAllMocks();
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

  describe('searchWebTool', () => {
    it('parses DuckDuckGo search results', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => `
          <div class="result results_links results_links_deep web-result ">
            <div class="links_main links_deep result__body">
              <h2 class="result__title">
                <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage&amp;rut=abc">Example Title</a>
              </h2>
              <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage&amp;rut=abc">Example snippet</a>
            </div>
          </div>
        `,
      } as Response);

      const result = await searchWebTool({ query: 'example query', maxResults: 3 });

      expect(fetchSpy).toHaveBeenCalled();
      expect(result.ok).toBe(true);
      expect(result.payload.results).toHaveLength(1);
      expect(result.payload.results[0]).toMatchObject({
        title: 'Example Title',
        url: 'https://example.com/page',
      });
    });
  });

  describe('fetchContentTool', () => {
    it('fetches and extracts text from HTML pages', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        url: 'https://example.com/docs',
        headers: {
          get: (name: string) =>
            name.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null,
        },
        text: async () => `
          <html>
            <head>
              <title>Example Docs</title>
              <meta name="description" content="A short example description.">
            </head>
            <body>
              <h1>Hello</h1>
              <p>First paragraph.</p>
              <p>Second paragraph.</p>
            </body>
          </html>
        `,
      } as Response);

      const result = await fetchContentTool({ url: 'https://example.com/docs' });

      expect(fetchSpy).toHaveBeenCalled();
      const [calledUrl, calledInit] = fetchSpy.mock.calls[0] as [URL, RequestInit];
      expect(calledUrl.href).toBe('https://example.com/docs');
      expect(calledInit).toEqual(
        expect.objectContaining({
          headers: expect.objectContaining({
            Accept: expect.stringContaining('text/html'),
          }),
        })
      );
      expect(result.ok).toBe(true);
      expect(result.payload.title).toBe('Example Docs');
      expect(result.payload.description).toBe('A short example description.');
      expect(result.payload.text).toContain('First paragraph.');
    });
  });

  describe('listDirTool', () => {
    it('lists dirs and files in repository root', async () => {
      const result = await listDirTool({
        repoRoot: dummyRepoDir,
        recursive: false,
      });
      expect(result.ok).toBe(true);
      expect(result.payload.files).toContain('hello.txt');
      expect(result.payload.dirs).toContain('src');
    });

    it('fails when target is not a directory', async () => {
      const result = await listDirTool({
        repoRoot: dummyRepoDir,
        relativePath: 'hello.txt',
      });
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('NOT_A_DIRECTORY');
    });

    it('fails when path is denied by policy', async () => {
      const result = await listDirTool({
        repoRoot: dummyRepoDir,
        relativePath: 'src',
        deniedPaths: ['src'],
      });
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('ACCESS_DENIED');
    });
  });

  describe('findFileTool', () => {
    it('finds files by wildcard mask', async () => {
      const result = await findFileTool({
        repoRoot: dummyRepoDir,
        fileMask: '*.js',
      });
      expect(result.ok).toBe(true);
      expect(result.payload.files).toContain('src/main.js');
    });

    it('respects maxResults limit', async () => {
      await fs.writeFile(path.join(dummyRepoDir, 'src/a.js'), 'a', 'utf-8');
      await fs.writeFile(path.join(dummyRepoDir, 'src/b.js'), 'b', 'utf-8');
      const result = await findFileTool({
        repoRoot: dummyRepoDir,
        fileMask: '*.js',
        maxResults: 1,
      });
      expect(result.ok).toBe(true);
      expect(result.payload.count).toBe(1);
    });

    it('fails when path is denied by policy', async () => {
      const result = await findFileTool({
        repoRoot: dummyRepoDir,
        fileMask: '*.js',
        relativePath: 'src',
        deniedPaths: ['src'],
      });
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('ACCESS_DENIED');
    });
  });

  describe('replaceContentTool', () => {
    it('replaces a single literal occurrence safely', async () => {
      const target = path.join(dummyRepoDir, 'hello.txt');
      await fs.writeFile(target, 'alpha\nbeta\n', 'utf-8');

      const result = await replaceContentTool({
        repoRoot: dummyRepoDir,
        filePath: 'hello.txt',
        needle: 'alpha',
        replacement: 'ALPHA',
        mode: 'literal',
      });

      expect(result.ok).toBe(true);
      expect(result.payload.occurrences).toBe(1);

      const updated = await fs.readFile(target, 'utf-8');
      expect(updated).toContain('ALPHA');
    });

    it('rejects empty needle', async () => {
      const result = await replaceContentTool({
        repoRoot: dummyRepoDir,
        filePath: 'hello.txt',
        needle: '',
        replacement: 'X',
        mode: 'literal',
      });
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('EMPTY_NEEDLE');
    });

    it('returns no_match when target text is missing', async () => {
      await fs.writeFile(path.join(dummyRepoDir, 'hello.txt'), 'foo\nbar\n', 'utf-8');
      const result = await replaceContentTool({
        repoRoot: dummyRepoDir,
        filePath: 'hello.txt',
        needle: 'not-found',
        replacement: 'X',
        mode: 'literal',
      });
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('NO_MATCH');
    });

    it('returns multiple_matches when more than one occurrence exists', async () => {
      await fs.writeFile(path.join(dummyRepoDir, 'hello.txt'), 'dup\ndup\n', 'utf-8');
      const result = await replaceContentTool({
        repoRoot: dummyRepoDir,
        filePath: 'hello.txt',
        needle: 'dup',
        replacement: 'X',
        mode: 'literal',
      });
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('MULTIPLE_MATCHES');
    });

    it('enforces read-before-edit policy when required', async () => {
      await fs.writeFile(path.join(dummyRepoDir, 'hello.txt'), 'read-me\n', 'utf-8');
      const result = await replaceContentTool({
        repoRoot: dummyRepoDir,
        filePath: 'hello.txt',
        needle: 'read-me',
        replacement: 'READ',
        mode: 'literal',
        requireReadBeforeEdit: true,
        readFiles: [],
      });
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('READ_BEFORE_EDIT_VIOLATION');
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

    it('blocks unknown commands by default', async () => {
      const result = await runCommandTool({
        command: 'custom-unknown-cmd',
        repoRoot: dummyRepoDir,
      });
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('DESTRUCTIVE_COMMAND');
    });

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
});
