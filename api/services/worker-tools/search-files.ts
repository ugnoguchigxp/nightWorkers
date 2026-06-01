import { exec } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { getRelativePath } from './path-policy';
import { enforcePathPolicy } from './tool-policy-enforcer';
import type { WorkerToolResult } from './types';

const execAsync = promisify(exec);

export interface SearchFilesInput {
  query: string;
  repoRoot: string;
  glob?: string;
  maxResults?: number;
  caseSensitive?: boolean;
  allowedPaths?: string[];
  deniedPaths?: string[];
}

export interface SearchResultMatch {
  filePath: string;
  lineNumber: number;
  excerpt: string;
}

export interface SearchFilesOutput {
  matches: SearchResultMatch[];
  count: number;
  engine: 'ripgrep' | 'fallback';
}

export async function searchFilesTool(
  input: SearchFilesInput
): Promise<WorkerToolResult<SearchFilesOutput>> {
  const startedAt = new Date().toISOString();
  const {
    query,
    repoRoot,
    glob,
    maxResults = 100,
    caseSensitive = false,
    allowedPaths,
    deniedPaths,
  } = input;

  const absoluteRepoRoot = path.resolve(repoRoot);

  try {
    // 1. Try using ripgrep
    let rgCommand = `rg --vimgrep --json ${caseSensitive ? '' : '-i'} --fixed-strings`;
    if (glob) {
      rgCommand += ` -g ${JSON.stringify(glob)}`;
    }
    rgCommand += ` ${JSON.stringify(query)} .`;

    try {
      const { stdout } = await execAsync(rgCommand, {
        cwd: absoluteRepoRoot,
        maxBuffer: 10 * 1024 * 1024,
      });
      const lines = stdout.split('\n').filter((l) => l.trim().length > 0);
      const matches: SearchResultMatch[] = [];

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === 'match') {
            const data = parsed.data;
            const absolutePath = path.resolve(absoluteRepoRoot, data.path.text);

            const policy = enforcePathPolicy(absolutePath, {
              repoRoot: absoluteRepoRoot,
              allowedPaths,
              deniedPaths,
            });
            if (policy.allowed) {
              matches.push({
                filePath: getRelativePath(absolutePath, absoluteRepoRoot),
                lineNumber: data.line_number,
                excerpt:
                  data.submatches.map((sm: any) => sm.match.text).join(', ') ||
                  data.lines.text.trim(),
              });
            }
          }
        } catch (_) {}

        if (matches.length >= maxResults) {
          break;
        }
      }

      return {
        ok: true,
        toolName: 'search_files',
        startedAt,
        finishedAt: new Date().toISOString(),
        payload: {
          matches,
          count: matches.length,
          engine: 'ripgrep',
        },
      };
    } catch (rgError: any) {
      if (rgError.code === 127 || rgError.message.includes('not found')) {
        console.warn('ripgrep (rg) not found in system path, falling back to manual scan');
      } else if (rgError.code === 1) {
        return {
          ok: true,
          toolName: 'search_files',
          startedAt,
          finishedAt: new Date().toISOString(),
          payload: {
            matches: [],
            count: 0,
            engine: 'ripgrep',
          },
        };
      } else {
        throw rgError;
      }
    }

    // 2. Fallback to manual scanner
    const matches: SearchResultMatch[] = [];
    async function scanDir(currentDir: string) {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') {
            continue;
          }
          await scanDir(fullPath);
        } else if (entry.isFile()) {
          const policy = enforcePathPolicy(fullPath, {
            repoRoot: absoluteRepoRoot,
            allowedPaths,
            deniedPaths,
          });
          if (!policy.allowed) {
            continue;
          }

          if (glob) {
            const regex = new RegExp(`^${glob.replace(/\*/g, '.*')}$`);
            if (!regex.test(entry.name)) {
              continue;
            }
          }

          const fileContent = await fs.readFile(fullPath, 'utf-8');
          const fileLines = fileContent.split(/\r?\n/);
          for (let i = 0; i < fileLines.length; i++) {
            const lineContent = fileLines[i];
            const isMatch = caseSensitive
              ? lineContent.includes(query)
              : lineContent.toLowerCase().includes(query.toLowerCase());

            if (isMatch) {
              matches.push({
                filePath: getRelativePath(fullPath, absoluteRepoRoot),
                lineNumber: i + 1,
                excerpt: lineContent.trim(),
              });

              if (matches.length >= maxResults) {
                return;
              }
            }
          }
        }
      }
    }

    await scanDir(absoluteRepoRoot);

    return {
      ok: true,
      toolName: 'search_files',
      startedAt,
      finishedAt: new Date().toISOString(),
      payload: {
        matches,
        count: matches.length,
        engine: 'fallback',
      },
    };
  } catch (err: any) {
    return {
      ok: false,
      toolName: 'search_files',
      startedAt,
      finishedAt: new Date().toISOString(),
      payload: {
        matches: [],
        count: 0,
        engine: 'fallback',
      },
      error: {
        code: 'SEARCH_FAILED',
        message: `Failed to search workspace files: ${err.message}`,
      },
    };
  }
}
