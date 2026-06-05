import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  analyzeCommand,
  applyPatchTool,
  fetchContentTool,
  findFileTool,
  gitDiffTool,
  inspectStructureTool,
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
    await fs.writeFile(
      path.join(dummyRepoDir, 'src/tool.ts'),
      [
        "import fs from 'node:fs';",
        'export interface ToolInput {',
        '  filePath: string;',
        '}',
        'export function readFileTool(input: ToolInput) {',
        '  return fs.readFileSync(input.filePath, "utf-8");',
        '}',
        'export class Runner {',
        '  execute() {',
        '    return readFileTool({ filePath: "hello.txt" });',
        '  }',
        '}',
        'export const loadTool = () => readFileTool({ filePath: "hello.txt" });',
        'export default function defaultTool() {',
        '  return loadTool();',
        '}',
      ].join('\n'),
      'utf-8'
    );
    await fs.writeFile(
      path.join(dummyRepoDir, 'config.json'),
      JSON.stringify(
        {
          scripts: { verify: 'pnpm verify' },
          nested: { enabled: true },
          items: [
            { id: 1, name: 'one' },
            { id: 2, flag: false },
          ],
        },
        null,
        2
      ),
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

    it('blocks symlinks that resolve outside repo root', async () => {
      const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nightworkers-outside-'));
      const linkPath = path.join(dummyRepoDir, 'outside-link');
      await fs.writeFile(path.join(outsideDir, 'secret.txt'), 'outside\n', 'utf-8');
      await fs.rm(linkPath, { recursive: true, force: true });
      await fs.symlink(outsideDir, linkPath, 'dir');

      const result = await readFileTool({
        filePath: 'outside-link/secret.txt',
        repoRoot: dummyRepoDir,
      });

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('ACCESS_DENIED');
      await fs.rm(outsideDir, { recursive: true, force: true });
    });

    it('uses compressed context by default for large full-file reads', async () => {
      await fs.writeFile(
        path.join(dummyRepoDir, 'large.ts'),
        Array.from({ length: 400 }, (_, index) =>
          index === 200
            ? 'export function important() { return 1; }'
            : `const line${index} = ${index};`
        ).join('\n'),
        'utf-8'
      );

      const result = await readFileTool({
        filePath: 'large.ts',
        repoRoot: dummyRepoDir,
      });

      expect(result.ok).toBe(true);
      expect(result.payload.content).toContain('[read-file-compressed]');
      expect(result.payload.content).toContain('important');
      expect(result.payload.compression?.compressed).toBe(true);
    });

    it('allows traditional full read output when compressionMode is off', async () => {
      const result = await readFileTool({
        filePath: 'large.ts',
        repoRoot: dummyRepoDir,
        compressionMode: 'off',
      });

      expect(result.ok).toBe(true);
      expect(result.payload.content).toContain('1: const line0 = 0;');
      expect(result.payload.content).not.toContain('[read-file-compressed]');
    });

    it('returns a cache marker for unchanged repeated reads in one tool context', async () => {
      const readCache = new Map();
      await readFileTool({ filePath: 'hello.txt', repoRoot: dummyRepoDir, readCache });
      const secondRead = await readFileTool({
        filePath: 'hello.txt',
        repoRoot: dummyRepoDir,
        readCache,
      });

      expect(secondRead.ok).toBe(true);
      expect(secondRead.payload.cached).toBe(true);
      expect(secondRead.payload.content).toContain('"status": "cached"');
      expect(secondRead.payload.compression?.strategy).toBe('read_cache_marker');
    });
  });

  describe('inspectStructureTool', () => {
    it('summarizes TypeScript imports and symbols without reading full content', async () => {
      const result = await inspectStructureTool({
        filePath: 'src/tool.ts',
        repoRoot: dummyRepoDir,
      });

      expect(result.ok).toBe(true);
      expect(result.payload.kind).toBe('source');
      if (result.payload.kind !== 'source') throw new Error('expected source output');
      expect(result.payload.imports?.[0]).toMatchObject({ module: 'node:fs' });
      expect(result.payload.symbols.map((symbol) => symbol.name)).toEqual(
        expect.arrayContaining(['ToolInput', 'readFileTool', 'Runner', 'execute', 'loadTool'])
      );
      expect(result.payload.symbols.find((symbol) => symbol.name === 'loadTool')).toMatchObject({
        kind: 'function',
        exported: true,
      });
      expect(result.payload.compression?.omittedReason).toBe('source_ast_symbols_only');
    });

    it('marks JSON shape as truncated only when maxPaths cuts traversal short', async () => {
      const result = await inspectStructureTool({
        filePath: 'config.json',
        repoRoot: dummyRepoDir,
        maxPaths: 2,
      });

      expect(result.ok).toBe(true);
      expect(result.payload.kind).toBe('json');
      if (result.payload.kind !== 'json') throw new Error('expected json output');
      expect(result.payload.paths.length).toBe(2);
      expect(result.payload.truncated).toBe(true);
    });

    it('summarizes JSON shape without primitive values by default', async () => {
      const result = await inspectStructureTool({
        filePath: 'config.json',
        repoRoot: dummyRepoDir,
      });

      expect(result.ok).toBe(true);
      expect(result.payload.kind).toBe('json');
      if (result.payload.kind !== 'json') throw new Error('expected json output');
      expect(result.payload.paths).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: '$.scripts.verify', type: 'string' }),
          expect.objectContaining({ path: '$.items', type: 'array', length: 2 }),
        ])
      );
      expect(
        result.payload.paths.find((entry) => entry.path === '$.scripts.verify')
      ).not.toHaveProperty('preview');
      expect(result.payload.truncated).toBe(false);
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

    it('applies replacement without read-before-edit gating', async () => {
      await fs.writeFile(path.join(dummyRepoDir, 'hello.txt'), 'read-me\n', 'utf-8');
      const result = await replaceContentTool({
        repoRoot: dummyRepoDir,
        filePath: 'hello.txt',
        needle: 'read-me',
        replacement: 'READ',
        mode: 'literal',
      });
      expect(result.ok).toBe(true);
      expect(await fs.readFile(path.join(dummyRepoDir, 'hello.txt'), 'utf-8')).toBe('READ\n');
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
});
