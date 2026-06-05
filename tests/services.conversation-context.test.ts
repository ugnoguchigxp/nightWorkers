import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildConversationContextSnapshot,
  deriveTargetFiles,
  extractConservativePaths,
  isAllowedRelativePath,
} from '../api/services/conversation-context/build';
import { loadConversationGitState } from '../api/services/conversation-context/git';
import {
  buildPromptWithStateCard,
  renderStateCard,
} from '../api/services/conversation-context/render';
import type {
  ConversationContextSnapshotV1,
  ConversationContextSource,
} from '../api/services/conversation-context/types';

const execFileAsync = promisify(execFile);

describe('conversation context domain', () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await mkdtemp(path.join(os.tmpdir(), 'conversation-context-test-'));
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it('builds a compact StateCard from latest user message and intake metadata', async () => {
    await writeFile(
      path.join(repoRoot, 'fizzbuzz.ts'),
      'export function fizzbuzz() { return 1; }\n'
    );
    const source = buildSource(repoRoot, {
      messages: [
        userMessage('u1', 'fizzbuzz.tsを作ってください'),
        {
          id: 's1',
          role: 'system',
          content: 'run started',
          metadataJson: {
            intakeJobSelection: {
              jobType: 'minor_code_edit',
              goal: '`fizzbuzz.ts` をプロジェクトルートに追加する。',
            },
          },
          createdAt: new Date(2),
        },
        userMessage('u2', 'foo 条件も追加してください７で割ってください'),
      ],
      runs: [
        {
          id: 'run-1',
          status: 'completed',
          summary: 'Created fizzbuzz.ts',
          finalReport: 'Created fizzbuzz.ts with basic fizzbuzz behavior.',
          finalJudgment: null,
          contextSnapshot: null,
          startedAt: new Date(3),
          finishedAt: new Date(4),
          endedAt: new Date(4),
        },
      ],
    });

    const snapshot = await buildConversationContextSnapshot({
      source,
      options: { includeSmallTargetFile: true, smallFileCharLimit: 6000 },
    });
    const card = renderStateCard(snapshot, { maxTokens: 1200 });

    expect(snapshot.task.latestUserMessageId).toBe('u2');
    expect(snapshot.classification).toMatchObject({
      jobType: 'minor_code_edit',
      source: 'intake_metadata',
    });
    expect(snapshot.continuity.isContinuation).toBe(true);
    expect(snapshot.files.target).toContain('fizzbuzz.ts');
    expect(card).toContain('<STATE_CARD>');
    expect(card).toContain('foo 条件も追加してください');
    expect(card).toContain('minor_code_edit');
    expect(card).not.toContain('"classification"');
  });

  it('rejects broad or unsafe path candidates', () => {
    expect(isAllowedRelativePath('src/app.ts')).toBe(true);
    expect(isAllowedRelativePath('fizzbuzz.ts')).toBe(true);
    expect(isAllowedRelativePath('../secret.ts')).toBe(false);
    expect(isAllowedRelativePath('/tmp/secret.ts')).toBe(false);
    expect(isAllowedRelativePath('logs/llm-trace.jsonl')).toBe(false);
    expect(isAllowedRelativePath('coverage/report.json')).toBe(false);
    expect(isAllowedRelativePath('node_modules/pkg/index.js')).toBe(false);
    expect(isAllowedRelativePath('dist-api/index.js')).toBe(false);
    expect(isAllowedRelativePath('.git/config')).toBe(false);
    expect(extractConservativePaths('修正対象は src/app.ts と logs/api.log です')).toEqual([
      'src/app.ts',
    ]);
  });

  it('uses previous snapshot as continuity hint without overriding current source truth', () => {
    const targets = deriveTargetFiles({
      latestUserRequest: '今回は src/current.ts を直す',
      intakeGoal: null,
      previousSnapshot: {
        version: 1,
        task: {
          id: 'task-1',
          status: 'completed',
          latestUserMessageId: 'old',
          latestUserRequest: 'old',
          title: 'old',
        },
        classification: { jobType: 'minor_code_edit', goal: null, source: 'intake_metadata' },
        continuity: {
          isContinuation: true,
          previousRunId: 'run-old',
          previousTerminalState: 'completed',
          previousAction: 'old',
        },
        files: {
          target: ['src/previous.ts'],
        },
        runState: { lastError: null, lastFinalReport: null, lastToolFailure: null },
        code: { snippets: [] },
        limits: { tokenEstimate: 0, truncatedFields: [] },
      },
    });

    expect(targets).toEqual(['src/current.ts', 'src/previous.ts']);
  });

  it('extracts file hints without classifying workflow from user text', async () => {
    await writeFile(path.join(repoRoot, 'app.ts'), 'export const app = true;\n');
    const snapshot = await buildConversationContextSnapshot({
      source: buildSource(repoRoot, {
        messages: [userMessage('u1', 'app.ts にテストを追加してください')],
      }),
      options: { includeSmallTargetFile: true },
    });

    expect(snapshot.files.target).toEqual(['app.ts']);
    expect(snapshot.classification).toEqual({
      jobType: null,
      goal: null,
      source: 'none',
    });
  });

  it('wraps prompts only when a StateCard is present', () => {
    expect(buildPromptWithStateCard({ latestUserMessage: ' do work ' })).toBe('do work');
    expect(
      buildPromptWithStateCard({
        latestUserMessage: 'do work',
        stateCardText: '<STATE_CARD>\nTask: t\n</STATE_CARD>',
      })
    ).toContain('<USER_REQUEST>\ndo work\n</USER_REQUEST>');
  });

  it('does not reintroduce pruned small-file snippets in later budget passes', () => {
    const snapshot = buildSnapshot({
      latestUserRequest: 'x'.repeat(600),
      target: ['src/big.ts'],
      snippets: [
        {
          path: 'src/big.ts',
          reason: 'target_file_small',
          content: 'export const value = 1;\n'.repeat(100),
          truncated: false,
        },
      ],
    });

    const card = renderStateCard(snapshot, { maxTokens: 80 });

    expect(card).not.toContain('export const value');
    expect(snapshot.limits.truncatedFields).toContain('code.snippets');
  });

  it('bounds long user request text in the rendered StateCard', () => {
    const snapshot = buildSnapshot({
      latestUserRequest: '依頼'.repeat(1000),
      target: ['src/app.ts'],
      snippets: [],
    });

    const card = renderStateCard(snapshot, { maxTokens: 120 });

    expect(card.length).toBeLessThan(520);
    expect(card).not.toContain('依頼'.repeat(500));
    expect(snapshot.limits.truncatedFields).toContain('task.latestUserRequest');
  });

  it('includes untracked files in git state as added files', async () => {
    await execFileAsync('git', ['init'], { cwd: repoRoot });
    await writeFile(path.join(repoRoot, 'new-file.ts'), 'export const created = true;\n');

    const gitState = await loadConversationGitState({ repoRoot });

    expect(gitState.nameStatus).toContainEqual({ path: 'new-file.ts', status: 'added' });
  });
});

function userMessage(id: string, content: string): ConversationContextSource['messages'][number] {
  return { id, role: 'user', content, metadataJson: null, createdAt: new Date() };
}

function buildSource(
  repositoryPath: string,
  overrides: Partial<ConversationContextSource>
): ConversationContextSource {
  return {
    task: {
      id: 'task-1',
      title: 'Fizzbuzz',
      status: 'running',
      description: null,
      objective: null,
      repositoryPath,
    },
    messages: [],
    runs: [],
    previousSnapshot: null,
    ...overrides,
  };
}

function buildSnapshot(input: {
  latestUserRequest: string;
  target: string[];
  snippets: ConversationContextSnapshotV1['code']['snippets'];
}): ConversationContextSnapshotV1 {
  return {
    version: 1,
    task: {
      id: 'task-1',
      status: 'running',
      latestUserMessageId: 'message-1',
      latestUserRequest: input.latestUserRequest,
      title: 'Task',
    },
    classification: { jobType: 'minor_code_edit', goal: null, source: 'intake_metadata' },
    continuity: {
      isContinuation: true,
      previousRunId: 'run-1',
      previousTerminalState: 'completed',
      previousAction: 'previous action '.repeat(80),
    },
    files: {
      target: input.target,
    },
    runState: {
      lastError: null,
      lastFinalReport: 'final report '.repeat(80),
      lastToolFailure: null,
    },
    code: { snippets: input.snippets },
    limits: { tokenEstimate: 0, truncatedFields: [] },
  };
}
