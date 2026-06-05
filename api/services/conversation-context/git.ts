import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ConversationGitState } from './types';

const execFileAsync = promisify(execFile);
const MAX_GIT_OUTPUT = 48_000;
const MAX_HUNK_OUTPUT = 24_000;

export function emptyGitState(): ConversationGitState {
  return {
    nameStatus: [],
    diffStat: null,
    hunks: [],
    errors: [],
  };
}

export async function loadConversationGitState(input: {
  repoRoot: string;
  targetPaths?: string[];
}): Promise<ConversationGitState> {
  const state = emptyGitState();
  const nameStatus = await runGit(input.repoRoot, ['diff', '--name-status'], MAX_GIT_OUTPUT);
  if (nameStatus.error) state.errors.push(nameStatus.error);
  else state.nameStatus = parseNameStatus(nameStatus.stdout);

  const status = await runGit(
    input.repoRoot,
    ['status', '--porcelain', '--untracked-files=normal'],
    MAX_GIT_OUTPUT
  );
  if (status.error) state.errors.push(status.error);
  else state.nameStatus = mergeNameStatus(state.nameStatus, parsePorcelainStatus(status.stdout));

  const diffStat = await runGit(input.repoRoot, ['diff', '--stat'], MAX_GIT_OUTPUT);
  if (diffStat.error) state.errors.push(diffStat.error);
  else state.diffStat = truncate(diffStat.stdout.trim(), MAX_GIT_OUTPUT);

  for (const targetPath of input.targetPaths?.slice(0, 8) ?? []) {
    const hunk = await runGit(input.repoRoot, ['diff', '--', targetPath], MAX_HUNK_OUTPUT);
    if (hunk.error) {
      state.errors.push(`${targetPath}: ${hunk.error}`);
      continue;
    }
    const content = truncate(hunk.stdout.trim(), MAX_HUNK_OUTPUT);
    if (content) {
      state.hunks.push({
        path: targetPath,
        content,
        truncated: hunk.stdout.length > MAX_HUNK_OUTPUT,
      });
    }
  }

  return state;
}

function parseNameStatus(output: string): ConversationGitState['nameStatus'] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/);
      const rawStatus = parts[0] || '';
      const path = rawStatus.startsWith('R') ? parts[2] || parts[1] || '' : parts[1] || '';
      return {
        path,
        status: mapStatus(rawStatus),
      };
    })
    .filter((entry) => entry.path);
}

function parsePorcelainStatus(output: string): ConversationGitState['nameStatus'] {
  return output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const rawStatus = line.slice(0, 2);
      const pathText = line.slice(3).trim();
      const path = rawStatus.startsWith('R')
        ? pathText.split(/\s+->\s+/).at(-1) || pathText
        : pathText;
      return {
        path,
        status: mapPorcelainStatus(rawStatus),
      };
    })
    .filter((entry) => entry.path);
}

function mergeNameStatus(
  base: ConversationGitState['nameStatus'],
  extra: ConversationGitState['nameStatus']
): ConversationGitState['nameStatus'] {
  const byPath = new Map<string, ConversationGitState['nameStatus'][number]>();
  for (const entry of base) byPath.set(entry.path, entry);
  for (const entry of extra) byPath.set(entry.path, entry);
  return Array.from(byPath.values());
}

function mapStatus(status: string): ConversationGitState['nameStatus'][number]['status'] {
  if (status === 'A') return 'added';
  if (status === 'M') return 'modified';
  if (status === 'D') return 'deleted';
  if (status.startsWith('R')) return 'renamed';
  return 'unknown';
}

function mapPorcelainStatus(status: string): ConversationGitState['nameStatus'][number]['status'] {
  if (status === '??' || status.includes('A')) return 'added';
  if (status.includes('D')) return 'deleted';
  if (status.includes('R')) return 'renamed';
  if (status.includes('M')) return 'modified';
  return 'unknown';
}

async function runGit(repoRoot: string, args: string[], maxBuffer: number) {
  try {
    const result = await execFileAsync('git', ['-C', repoRoot, ...args], {
      maxBuffer,
      timeout: 5000,
    });
    return { stdout: String(result.stdout), error: null as string | null };
  } catch (error: any) {
    const message = error?.message || String(error);
    const stdout = typeof error?.stdout === 'string' ? error.stdout : '';
    return { stdout, error: truncate(message, 500) };
  }
}

function truncate(value: string, max: number) {
  return value.length > max ? value.slice(0, max) : value;
}
