import fs from 'node:fs/promises';
import path from 'node:path';
import { estimateTokens, resolveConversationContextOptions } from './token-budget';
import {
  CONVERSATION_CONTEXT_VERSION,
  type ConversationContextOptions,
  type ConversationContextSnapshotV1,
  type ConversationContextSource,
} from './types';

const DENIED_PATH_PREFIXES = ['logs/', 'coverage/', 'node_modules/', 'dist/', 'dist-api/', '.git/'];
const PATH_PATTERN =
  /(?:^|[\s`"'(])([A-Za-z0-9._@/-]+\.[A-Za-z0-9]+|[A-Za-z0-9._@-]+\/[A-Za-z0-9._@/-]+)(?=$|[\s`"',).:;!?])/g;

export async function buildConversationContextSnapshot(input: {
  source: ConversationContextSource;
  options?: ConversationContextOptions;
}): Promise<ConversationContextSnapshotV1> {
  const latestUser = findLatestUserMessage(input.source.messages);
  const intake = findLatestIntakeJobSelection(input.source.messages);
  const previousRun = findPreviousRun(input.source.runs, input.options?.currentRunId);
  const previousSnapshot = input.source.previousSnapshot?.snapshotJson ?? null;
  const targetFiles = deriveTargetFiles({
    latestUserRequest:
      latestUser?.content ?? input.source.task.description ?? input.source.task.objective ?? '',
    intakeGoal: intake?.goal ?? null,
    previousSnapshot,
  });
  const snippets = await collectCodeSnippets({
    repositoryPath: input.source.task.repositoryPath,
    targetFiles,
    options: input.options,
  });
  const previousAction = truncate(
    previousRun?.finalReport ||
      previousRun?.summary ||
      previousSnapshot?.continuity.previousAction ||
      null,
    360
  );
  const lastError = extractLastError(previousRun);

  return {
    version: CONVERSATION_CONTEXT_VERSION,
    task: {
      id: input.source.task.id,
      status: input.source.task.status,
      latestUserMessageId: latestUser?.id ?? null,
      latestUserRequest: latestUser?.content ?? '',
      title: input.source.task.title,
    },
    classification: {
      jobType: intake?.jobType ?? previousSnapshot?.classification.jobType ?? null,
      goal: intake?.goal ?? previousSnapshot?.classification.goal ?? null,
      source: intake
        ? 'intake_metadata'
        : previousSnapshot?.classification.jobType
          ? 'previous_run'
          : 'none',
    },
    continuity: {
      isContinuation:
        Boolean(previousRun) ||
        Boolean(previousSnapshot) ||
        input.source.messages.filter((message) => message.role === 'user').length > 1,
      previousRunId: previousRun?.id ?? previousSnapshot?.continuity.previousRunId ?? null,
      previousTerminalState:
        previousRun?.status ?? previousSnapshot?.continuity.previousTerminalState ?? null,
      previousAction,
    },
    files: {
      target: targetFiles,
    },
    runState: {
      lastError,
      lastFinalReport: truncate(previousRun?.finalReport ?? null, 720),
      lastToolFailure: null,
    },
    code: {
      snippets,
    },
    limits: {
      tokenEstimate: 0,
      truncatedFields: [],
    },
  };
}

export function findLatestUserMessage(messages: ConversationContextSource['messages']) {
  return [...messages].reverse().find((message) => message.role === 'user') ?? null;
}

export function findLatestIntakeJobSelection(messages: ConversationContextSource['messages']) {
  for (const message of [...messages].reverse()) {
    const metadata = asRecord(message.metadataJson);
    const selection = asRecord(metadata?.intakeJobSelection) ?? asRecord(metadata?.jobSelection);
    if (typeof selection?.jobType === 'string') {
      return {
        jobType: selection.jobType,
        goal: typeof selection.goal === 'string' ? selection.goal : null,
      };
    }
  }
  return null;
}

export function findPreviousRun(
  runs: ConversationContextSource['runs'],
  currentRunId?: string | null
) {
  const candidates = currentRunId ? runs.filter((run) => run.id !== currentRunId) : runs;
  return (
    candidates.find((run) =>
      [
        'completed',
        'failed',
        'cancelled',
        'needs_review',
        'blocked',
        'timed_out',
        'needs_human',
      ].includes(run.status)
    ) ??
    candidates[0] ??
    null
  );
}

export function deriveTargetFiles(input: {
  latestUserRequest: string;
  intakeGoal: string | null;
  previousSnapshot: ConversationContextSnapshotV1 | null;
}) {
  // Conservative file hints only. This must not classify workflow, jobType, or taskType.
  const paths = new Set<string>();
  for (const value of extractConservativePaths(input.latestUserRequest)) paths.add(value);
  for (const value of extractConservativePaths(input.intakeGoal || '')) paths.add(value);
  for (const value of input.previousSnapshot?.files.target ?? []) {
    if (isAllowedRelativePath(value)) paths.add(value);
  }
  return Array.from(paths).slice(0, 20);
}

export function extractConservativePaths(text: string) {
  const paths = new Set<string>();
  for (const match of text.matchAll(PATH_PATTERN)) {
    const candidate = match[1];
    if (isAllowedRelativePath(candidate)) paths.add(candidate);
  }
  return Array.from(paths);
}

export function isAllowedRelativePath(candidate: string) {
  const normalized = candidate.replaceAll('\\', '/').replace(/^\.\/+/, '');
  if (!normalized || normalized.startsWith('/') || normalized.includes('..')) return false;
  if (!normalized.includes('/') && !/\.[A-Za-z0-9]+$/.test(normalized)) return false;
  if (
    DENIED_PATH_PREFIXES.some(
      (prefix) => normalized === prefix.slice(0, -1) || normalized.startsWith(prefix)
    )
  ) {
    return false;
  }
  return normalized === candidate || candidate.startsWith('./');
}

async function collectCodeSnippets(input: {
  repositoryPath: string;
  targetFiles: string[];
  options?: ConversationContextOptions;
}): Promise<ConversationContextSnapshotV1['code']['snippets']> {
  const options = resolveConversationContextOptions(input.options);
  const snippets: ConversationContextSnapshotV1['code']['snippets'] = [];
  for (const targetPath of input.targetFiles.slice(0, 5)) {
    if (!options.includeSmallTargetFile) continue;
    const absolutePath = path.resolve(input.repositoryPath, targetPath);
    const repoRoot = path.resolve(input.repositoryPath);
    if (!absolutePath.startsWith(`${repoRoot}${path.sep}`)) continue;
    try {
      const stat = await fs.stat(absolutePath);
      if (!stat.isFile() || stat.size > options.smallFileCharLimit * 4) continue;
      const content = await fs.readFile(absolutePath, 'utf8');
      if (content.length <= options.smallFileCharLimit) {
        snippets.push({
          path: targetPath,
          reason: 'target_file_small',
          content,
          truncated: false,
        });
      }
    } catch {}
  }
  return snippets;
}

export function finalizeSnapshotTokenEstimate(
  snapshot: ConversationContextSnapshotV1,
  stateCardText: string
) {
  snapshot.limits.tokenEstimate = estimateTokens(stateCardText);
  return snapshot;
}

function extractLastError(run: ConversationContextSource['runs'][number] | null) {
  const judgment = asRecord(run?.finalJudgment);
  const direct = judgment?.error || judgment?.lastError || judgment?.reason;
  if (typeof direct === 'string' && direct.trim()) return truncate(direct, 500);
  if (run?.status && ['failed', 'blocked', 'timed_out'].includes(run.status)) {
    return truncate(run.summary || run.finalReport || run.status, 500);
  }
  return null;
}

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : null;
}

function truncate(value: string | null, max: number) {
  if (!value) return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > max ? normalized.slice(0, max) : normalized;
}
