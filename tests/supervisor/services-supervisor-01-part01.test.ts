import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as repo from '../../api/modules/nightworkers/nightworkers.repository';
import * as llm from '../../api/services/structured-llm';
import {
  buildRound2ToolCallPrompt,
  getAllowedToolsForJobType,
} from '../../api/services/supervisor/prompt';
import { runSupervisorLoop } from '../../api/services/supervisor/supervisor-loop';
import { parseRound2UserContextJsonSection } from '../../api/services/supervisor/user-context';

const _execFileAsync = promisify(execFile);

vi.mock('../../api/services/structured-llm', () => ({
  callSupervisorLLM: vi.fn(),
}));

vi.mock('../../api/modules/nightworkers/nightworkers.repository', () => ({
  getTaskRun: vi.fn(),
  getTask: vi.fn(),
  createRunEvent: vi.fn(),
  createTaskMessage: vi.fn(),
  updateTaskRun: vi.fn(),
  updateTaskStatus: vi.fn(),
  listTaskRunTodosForRun: vi.fn(),
  replaceTaskRunTodosForRun: vi.fn(),
  updateTaskRunTodo: vi.fn(),
}));

describe('Schema-first supervisor loop', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(repo.getTaskRun).mockResolvedValue({ id: 'run-1', taskId: 'task-1' } as any);
    vi.mocked(repo.getTask).mockResolvedValue({
      id: 'task-1',
      objective: 'Create fizzbuzz.ts',
      acceptanceCriteria: 'File exists',
    } as any);
    vi.mocked(repo.listTaskRunTodosForRun).mockResolvedValue([]);
  });

  it('describes minor_code_edit apply_patch file creation without fragile patch formatting', () => {
    const prompt = buildRound2ToolCallPrompt({
      projectRoot: '/repo/project',
      jobType: 'minor_code_edit',
      tools: getAllowedToolsForJobType('minor_code_edit'),
    });

    expect(prompt).toContain('[Procedure Access]');
    expect(prompt).toContain('Procedure documents are not preloaded.');
    expect(prompt).toContain('After apply_patch succeeds');
    expect(prompt).not.toContain('# minor_code_edit');
    expect(prompt).not.toContain('<lineCount>');
    expect(prompt).not.toContain('READ_BEFORE_EDIT');
    expect(prompt).not.toContain('git apply');
    expect(prompt).not.toContain('- list_dir:');
    expect(prompt).not.toContain('git_status');
    expect(prompt).not.toContain('git_diff');
  });

  it('shows approved external paths in the round2 tool prompt', () => {
    const prompt = buildRound2ToolCallPrompt({
      projectRoot: '/Users/y.noguchi/Code/todolist',
      jobType: 'major_code_edit',
      tools: getAllowedToolsForJobType('major_code_edit'),
      externalAllowedPaths: ['/Users/y.noguchi/Code/hono-standard'],
    });

    expect(prompt).toContain('許可済み外部パス: /Users/y.noguchi/Code/hono-standard');
    expect(prompt).toContain('treat it as approved');
    expect(prompt).toContain('copy_directory');
  });

  it('persists execution review evidence into the run context snapshot', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nightworkers-review-context-'));
    vi.mocked(repo.getTaskRun).mockResolvedValue({
      id: 'run-1',
      taskId: 'task-1',
      contextSnapshot: { compiledPrompt: '既存プロンプト' },
    } as any);
    vi.mocked(llm.callSupervisorLLM)
      .mockResolvedValueOnce({
        jobType: 'minor_code_edit',
        goal: '完了する',
      })
      .mockResolvedValueOnce({
        toolCall: {
          name: 'finalize_answer',
          arguments: { message: '完了しました。' },
        },
      });

    try {
      await runSupervisorLoop({
        runId: 'run-1',
        repoRoot,
        prompt: '完了する',
        timeoutSeconds: 60,
        artifactContextRefs: [
          {
            kind: 'contextstill_context_pack',
            refId: 'ctx-pack-1',
            status: 'evidence_only',
            digest: 'sha256:abc',
          },
        ],
      });

      expect(repo.updateTaskRun).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({
          contextSnapshot: expect.objectContaining({
            compiledPrompt: '既存プロンプト',
            executionReview: expect.objectContaining({
              artifactContextRefs: [
                expect.objectContaining({
                  kind: 'contextstill_context_pack',
                  refId: 'ctx-pack-1',
                }),
              ],
              checklist: [
                expect.objectContaining({
                  source: 'contextstill_context_pack',
                  evidenceRef: 'sha256:abc',
                }),
              ],
              workerEvidenceItemCount: 0,
            }),
          }),
        })
      );
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('requires package.json inspection and verification after template copy before finalize', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nightworkers-template-target-'));
    const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nightworkers-template-source-'));
    await fs.writeFile(
      path.join(sourceRoot, 'package.json'),
      JSON.stringify(
        {
          scripts: {
            typecheck: 'node -e "process.exit(0)"',
          },
        },
        null,
        2
      )
    );

    vi.mocked(llm.callSupervisorLLM)
      .mockResolvedValueOnce({
        jobType: 'major_code_edit',
        goal: 'テンプレートをコピーして検証する',
      })
      .mockResolvedValueOnce({
        toolCall: {
          name: 'copy_directory',
          arguments: { sourcePath: sourceRoot, targetPath: '.', overwrite: true },
        },
      })
      .mockResolvedValueOnce({
        toolCall: {
          name: 'finalize_answer',
          arguments: { message: 'コピーしました。' },
        },
      })
      .mockResolvedValueOnce({
        toolCall: {
          name: 'read_file',
          arguments: { filePath: 'package.json' },
        },
      })
      .mockResolvedValueOnce({
        toolCall: {
          name: 'finalize_answer',
          arguments: { message: 'コピーしました。' },
        },
      })
      .mockResolvedValueOnce({
        toolCall: {
          name: 'run_verification',
          arguments: { command: 'pnpm typecheck', reason: 'package.json script verification' },
        },
      })
      .mockResolvedValueOnce({
        toolCall: {
          name: 'finalize_answer',
          arguments: { message: 'コピーして検証しました。' },
        },
      });

    try {
      const result = await runSupervisorLoop({
        runId: 'run-1',
        repoRoot,
        prompt: 'テンプレートをコピーして',
        timeoutSeconds: 60,
        safetyPolicy: { externalAllowedPaths: [sourceRoot] },
      });

      expect(result.finalReport).toBe('コピーして検証しました。');
      const afterCopyToolEvidence = parseRound2UserContextJsonSection<any[]>(
        vi.mocked(llm.callSupervisorLLM).mock.calls[3]?.[1] as string,
        'Recent Tool Evidence'
      );
      expect(afterCopyToolEvidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            toolName: 'finalize_answer',
            ok: false,
            summary: expect.stringContaining('before reading package.json'),
          }),
        ])
      );
      const afterPackageToolEvidence = parseRound2UserContextJsonSection<any[]>(
        vi.mocked(llm.callSupervisorLLM).mock.calls[5]?.[1] as string,
        'Recent Tool Evidence'
      );
      expect(afterPackageToolEvidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            toolName: 'finalize_answer',
            ok: false,
            summary: expect.stringContaining('before running manifest-based verification'),
          }),
        ])
      );
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
      await fs.rm(sourceRoot, { recursive: true, force: true });
    }
  });
});
