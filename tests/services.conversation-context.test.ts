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
  buildPromptWithStateCardParts,
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
        runState: {
          lastError: null,
          lastFinalReport: null,
          lastToolFailure: null,
          workerEvidence: null,
        },
        code: { snippets: [] },
        limits: { tokenEstimate: 0, truncatedFields: [] },
      },
    });

    expect(targets).toEqual(['src/current.ts', 'src/previous.ts']);
  });

  it('carries previous run tool failure into the StateCard snapshot', async () => {
    const snapshot = await buildConversationContextSnapshot({
      source: buildSource(repoRoot, {
        messages: [userMessage('u1', 'src/app.ts を直してください')],
        runs: [
          {
            id: 'run-1',
            status: 'failed',
            summary: 'failed',
            finalReport: null,
            finalJudgment: null,
            contextSnapshot: null,
            lastToolFailure: 'read_file: FILE_NOT_FOUND: src/missing.ts',
            startedAt: new Date(3),
            finishedAt: new Date(4),
            endedAt: new Date(4),
          },
        ],
      }),
    });

    expect(snapshot.runState.lastToolFailure).toBe('read_file: FILE_NOT_FOUND: src/missing.ts');
    expect(renderStateCard(snapshot)).toContain('read_file: FILE_NOT_FOUND');
  });

  it('carries previous run worker recovery evidence into the StateCard snapshot', async () => {
    const snapshot = await buildConversationContextSnapshot({
      source: buildSource(repoRoot, {
        messages: [userMessage('u1', 'src/app.ts を直してください')],
        runs: [
          {
            id: 'run-1',
            status: 'failed',
            summary: 'failed',
            finalReport: null,
            finalJudgment: null,
            contextSnapshot: null,
            lastToolFailure: 'apply_patch: PATCH_DOES_NOT_APPLY: src/app.ts',
            lastWorkerEvidence: {
              lastFailure: 'apply_patch: PATCH_DOES_NOT_APPLY: src/app.ts',
              recoveryDirective: {
                kind: 'read_target_once',
                targetPath: 'src/app.ts',
                reason: 'Read current content before building corrected patch.',
                maxRepeats: 1,
              },
              criticalEvidence: [
                {
                  toolName: 'apply_patch',
                  failureKind: 'patch_mismatch',
                  targetPath: 'src/app.ts',
                  reason: 'Patch did not match current content.',
                },
              ],
              targets: ['src/app.ts'],
            },
            startedAt: new Date(3),
            finishedAt: new Date(4),
            endedAt: new Date(4),
          },
        ],
      }),
    });

    const card = renderStateCard(snapshot);
    expect(snapshot.runState.workerEvidence?.recoveryDirective?.targetPath).toBe('src/app.ts');
    expect(snapshot.files.target).toContain('src/app.ts');
    expect(card).toContain('recovery: read_target_once | src/app.ts');
    expect(card).toContain('evidence: apply_patch | patch_mismatch | src/app.ts');
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

  it('returns StateCard prompt token estimates without changing wrapper output', () => {
    const stateCardText = '<STATE_CARD>\nTask: t\n</STATE_CARD>';
    const parts = buildPromptWithStateCardParts({
      latestUserMessage: ' do work ',
      stateCardText,
    });

    expect(parts.promptText).toBe(
      buildPromptWithStateCard({
        latestUserMessage: ' do work ',
        stateCardText,
      })
    );
    expect(parts.estimates.latestUserMessageTokens).toBeGreaterThan(0);
    expect(parts.estimates.stateCardTokens).toBeGreaterThan(0);
    expect(parts.estimates.promptTokens).toBeGreaterThan(parts.estimates.latestUserMessageTokens);
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

  it('stores StateCard baseline metadata and renders compact text when unchanged', async () => {
    const source = buildSource(repoRoot, {
      messages: [
        userMessage('u1', 'src/app.ts を直す'),
        {
          id: 's1',
          role: 'system',
          content: 'run started',
          metadataJson: {
            intakeJobSelection: {
              jobType: 'minor_code_edit',
              goal: 'src/app.ts を直す',
            },
          },
          createdAt: new Date(2),
        },
      ],
    });
    const first = await buildConversationContextSnapshot({ source });
    expect(first.contextBaseline?.stateCardDigest).toMatch(/^sha256:/);
    expect(renderStateCard(first)).toContain('Continuity:');

    const second = await buildConversationContextSnapshot({
      source: {
        ...source,
        previousSnapshot: {
          id: 'snapshot-1',
          taskId: 'task-1',
          runId: null,
          version: 1,
          jobType: first.classification.jobType,
          latestUserMessageId: first.task.latestUserMessageId,
          previousRunId: first.continuity.previousRunId,
          terminalState: first.continuity.previousTerminalState,
          tokenEstimate: first.limits.tokenEstimate,
          snapshotJson: first,
          stateCardText: renderStateCard(first),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
    });
    const compact = renderStateCard(second);

    expect(second.contextBaseline?.unchangedFromPrevious).toBe(true);
    expect(compact).toContain('unchanged continuity');
    expect(compact).toContain(`Baseline: ${first.contextBaseline?.stateCardDigest}`);
    expect(compact).not.toContain('Continuity:');
  });

  it('keeps last problem and target hints in unchanged StateCard rendering', () => {
    const snapshot = buildSnapshot({
      latestUserRequest: 'src/app.ts を続けて直す',
      target: ['src/app.ts'],
      snippets: [],
    });
    snapshot.contextBaseline = {
      repoRoot,
      jobType: 'minor_code_edit',
      workflow: 'minor_code_edit',
      safetyPolicyDigest: null,
      stateCardDigest: 'sha256:baseline',
      relevantFilesDigest: 'sha256:files',
      adoptedArtifactDigest: null,
      blueprintRefsDigest: null,
      blueprintDbDesignRefsDigest: null,
      designQuestionnaireRefsDigest: null,
      decisionReviewRefsDigest: null,
      contextStillRefsDigest: null,
      workerEvidenceRefsDigest: null,
      lastRunId: 'run-1',
      unchangedFromPrevious: true,
      changedFields: [],
    };
    snapshot.runState.lastToolFailure = 'FILE_NOT_FOUND: src/missing.ts';
    snapshot.runState.workerEvidence = {
      lastFailure: 'FILE_NOT_FOUND: src/missing.ts',
      recoveryDirective: {
        kind: 'choose_existing_path',
        targetPath: 'src/missing.ts',
        reason: 'Use an existing path.',
      },
      criticalEvidence: [],
      targets: ['src/missing.ts'],
    };

    const card = renderStateCard(snapshot);

    expect(card).toContain('unchanged continuity');
    expect(card).toContain('Last problem: FILE_NOT_FOUND: src/missing.ts');
    expect(card).toContain('Recovery: choose_existing_path | src/missing.ts');
    expect(card).toContain('Targets: src/app.ts');
  });

  it('keeps recovery evidence when StateCard falls back to minimal rendering', () => {
    const snapshot = buildSnapshot({
      latestUserRequest: 'src/app.ts を続けて直す '.repeat(50),
      target: ['src/app.ts'],
      snippets: [
        {
          path: 'src/app.ts',
          reason: 'target_file_small',
          content: 'export const value = true;\n'.repeat(200),
          truncated: false,
        },
      ],
    });
    snapshot.runState.lastToolFailure = 'apply_patch: PATCH_DOES_NOT_APPLY: src/app.ts';
    snapshot.runState.workerEvidence = {
      lastFailure: 'apply_patch: PATCH_DOES_NOT_APPLY: src/app.ts',
      recoveryDirective: {
        kind: 'read_target_once',
        targetPath: 'src/app.ts',
        reason: 'Read current content before corrected patch.',
        maxRepeats: 1,
      },
      criticalEvidence: [
        {
          toolName: 'apply_patch',
          failureKind: 'patch_mismatch',
          targetPath: 'src/app.ts',
          reason: 'Patch did not match current content.',
        },
      ],
      targets: ['src/app.ts'],
    };

    const card = renderStateCard(snapshot, { maxTokens: 40 });

    expect(snapshot.limits.truncatedFields).toContain('minimal');
    expect(card).toContain('- recovery: read_target_once | src/app.ts');
    expect(card).toContain('- evidence: apply_patch | patch_mismatch | src/app.ts');
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
      workerEvidence: null,
    },
    code: { snippets: input.snippets },
    limits: { tokenEstimate: 0, truncatedFields: [] },
  };
}
