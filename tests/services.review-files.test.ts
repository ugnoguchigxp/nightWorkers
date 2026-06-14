import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NotFoundError } from '@api/lib/errors';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  return {
    getTaskRun: vi.fn(),
    listTaskEventsForRun: vi.fn(),
    createRunEvent: vi.fn(),
    getRepository: vi.fn(),
    listTaskRunTodosForRun: vi.fn(),
    buildReviewEvidencePackFromRun: vi.fn(),
    listRubrics: vi.fn(),
    runReviewerEvaluationFromPack: vi.fn(),
    runReviewReplayEvaluation: vi.fn(),
    runReviewReplayEvaluationFromJsonl: vi.fn(),
    serializeRunToJsonl: vi.fn(),
    gitDiffTool: vi.fn(),
  };
});

vi.mock('@api/modules/nightworkers/nightworkers.repository', () => ({
  getTaskRun: mocks.getTaskRun,
  listTaskEventsForRun: mocks.listTaskEventsForRun,
  createRunEvent: mocks.createRunEvent,
  getRepository: mocks.getRepository,
  listTaskRunTodosForRun: mocks.listTaskRunTodosForRun,
}));

vi.mock('@api/services/review-rubrics/evidence-pack', () => ({
  buildReviewEvidencePackFromRun: mocks.buildReviewEvidencePackFromRun,
}));

vi.mock('@api/services/review-rubrics/loader', () => ({
  listRubrics: mocks.listRubrics,
}));

vi.mock('@api/services/review-rubrics/replay-evaluation', () => ({
  runReviewerEvaluationFromPack: mocks.runReviewerEvaluationFromPack,
  runReviewReplayEvaluation: mocks.runReviewReplayEvaluation,
  runReviewReplayEvaluationFromJsonl: mocks.runReviewReplayEvaluationFromJsonl,
}));

vi.mock('@api/services/run-events/jsonl-export', () => ({
  serializeRunToJsonl: mocks.serializeRunToJsonl,
}));

vi.mock('@api/services/worker-tools/git', () => ({
  gitDiffTool: mocks.gitDiffTool,
}));

import {
  browseLocalFolders,
  createLocalFolder,
  createReviewerEvaluation,
  createReviewerReplayEvaluation,
  exportTaskRunJsonl,
  getReviewRubrics,
  listProjectFiles,
  readProjectFile,
  readRepositoryDiff,
} from '@api/modules/nightworkers/nightworkers.review-files.service';

describe('review-files.service', () => {
  let tempDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nw-review-files-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  describe('getReviewRubrics', () => {
    it('returns rubrics details', () => {
      mocks.listRubrics.mockReturnValue([
        {
          rubric: {
            id: 'r-1',
            title: 'Title 1',
            description: 'Desc 1',
            llm: 'llm-mode',
          },
          source: 'src-1',
          digest: 'dig-1',
          criteriaCount: 5,
        },
      ]);

      const result = getReviewRubrics();
      expect(result).toEqual([
        {
          id: 'r-1',
          title: 'Title 1',
          description: 'Desc 1',
          source: 'src-1',
          digest: 'dig-1',
          criteriaCount: 5,
          llm: 'llm-mode',
        },
      ]);
    });
  });

  describe('createReviewerEvaluation', () => {
    it('throws NotFoundError if run is not found', async () => {
      mocks.getTaskRun.mockResolvedValue(null);
      await expect(createReviewerEvaluation('run-1', {})).rejects.toThrow(NotFoundError);
    });

    it('creates evaluation, saves events, and returns evaluation results', async () => {
      mocks.getTaskRun.mockResolvedValue({
        id: 'run-1',
        taskId: 'task-1',
        status: 'completed',
        summary: 'ok',
      });
      mocks.listTaskEventsForRun.mockResolvedValue([]);
      mocks.buildReviewEvidencePackFromRun.mockReturnValue({ pack: true });
      mocks.runReviewerEvaluationFromPack.mockResolvedValue({
        reviewResult: { passed: true },
        events: [{ type: 'review.evaluation_finished' }],
      });

      const result = await createReviewerEvaluation('run-1', { persist: true });
      expect(result.reviewResult.passed).toBe(true);
      expect(mocks.createRunEvent).toHaveBeenCalledTimes(1);
    });

    it('does not persist events when persist is false', async () => {
      mocks.getTaskRun.mockResolvedValue({
        id: 'run-1',
        taskId: 'task-1',
        status: 'completed',
        summary: 'ok',
      });
      mocks.listTaskEventsForRun.mockResolvedValue([]);
      mocks.buildReviewEvidencePackFromRun.mockReturnValue({ pack: true });
      mocks.runReviewerEvaluationFromPack.mockResolvedValue({
        reviewResult: { passed: true },
        events: [{ type: 'review.evaluation_finished' }],
      });

      const result = await createReviewerEvaluation('run-1', { persist: false });
      expect(result.reviewResult.passed).toBe(true);
      expect(mocks.createRunEvent).not.toHaveBeenCalled();
    });
  });

  describe('createReviewerReplayEvaluation', () => {
    it('calls runReviewReplayEvaluationFromJsonl when jsonl string is provided', async () => {
      mocks.runReviewReplayEvaluationFromJsonl.mockResolvedValue({ result: 'jsonl' });
      const result = await createReviewerReplayEvaluation('run-1', { jsonl: 'some-jsonl' });
      expect(mocks.runReviewReplayEvaluationFromJsonl).toHaveBeenCalledWith({
        jsonl: 'some-jsonl',
        rubricId: 'basic-coding-run',
        mode: 'deterministic_only',
      });
      expect(result).toEqual({ result: 'jsonl' });
    });

    it('calls runReviewReplayEvaluation when parsedJsonl or replayResult is provided', async () => {
      mocks.runReviewReplayEvaluation.mockResolvedValue({ result: 'parsed' });
      const result = await createReviewerReplayEvaluation('run-1', { parsedJsonl: { data: 1 } });
      expect(mocks.runReviewReplayEvaluation).toHaveBeenCalledWith({
        parsedJsonl: { data: 1 },
        replayResult: undefined,
        rubricId: 'basic-coding-run',
        mode: 'deterministic_only',
      });
      expect(result).toEqual({ result: 'parsed' });
    });

    it('exports task run jsonl and runs evaluation when jsonl and parsed values are empty', async () => {
      // Mock exportTaskRunJsonl dependencies
      mocks.getTaskRun.mockResolvedValue({ id: 'run-1', taskId: 'task-1' });
      mocks.listTaskEventsForRun.mockResolvedValue([]);
      mocks.listTaskRunTodosForRun.mockResolvedValue([]);
      mocks.getRepository.mockResolvedValue(null);
      mocks.serializeRunToJsonl.mockReturnValue('exported-jsonl');

      mocks.runReviewReplayEvaluationFromJsonl.mockResolvedValue({ result: 'exported-run' });

      const result = await createReviewerReplayEvaluation('run-1', {});
      expect(mocks.runReviewReplayEvaluationFromJsonl).toHaveBeenCalledWith({
        jsonl: 'exported-jsonl',
        rubricId: 'basic-coding-run',
        mode: 'deterministic_only',
      });
      expect(result).toEqual({ result: 'exported-run' });
    });
  });

  describe('browseLocalFolders', () => {
    it('lists directories inside baseDir', async () => {
      await fs.mkdir(path.join(tempDir, 'dir1'));
      await fs.mkdir(path.join(tempDir, 'dir2'));
      await fs.mkdir(path.join(tempDir, '.hidden-dir'));
      await fs.writeFile(path.join(tempDir, 'file1.txt'), 'hello');

      const result = await browseLocalFolders(tempDir);
      expect(result.directories).toEqual([
        { name: 'dir1', path: path.join(tempDir, 'dir1') },
        { name: 'dir2', path: path.join(tempDir, 'dir2') },
      ]);
      expect(result.currentPath).toBe(tempDir);
      expect(result.parentPath).toBe(path.dirname(tempDir));
    });

    it('returns empty list and error message when baseDir does not exist', async () => {
      const result = await browseLocalFolders(path.join(tempDir, 'nonexistent'));
      expect(result.directories).toEqual([]);
      expect(result.error).toBeDefined();
    });
  });

  describe('createLocalFolder', () => {
    it('throws AppError for empty folder name', async () => {
      await expect(createLocalFolder({ parentPath: tempDir, name: '' })).rejects.toThrow(
        expect.objectContaining({ code: 'EMPTY_FOLDER_NAME' })
      );
    });

    it('throws AppError for invalid folder names with slashes', async () => {
      await expect(createLocalFolder({ parentPath: tempDir, name: 'sub/folder' })).rejects.toThrow(
        expect.objectContaining({ code: 'INVALID_FOLDER_NAME' })
      );
    });

    it('creates directory and returns name and path', async () => {
      const result = await createLocalFolder({ parentPath: tempDir, name: 'new-folder' });
      expect(result.name).toBe('new-folder');
      expect(result.path).toBe(path.join(tempDir, 'new-folder'));

      const stat = await fs.stat(result.path);
      expect(stat.isDirectory()).toBe(true);
    });
  });

  describe('listProjectFiles', () => {
    it('throws NotFoundError if repository is not found', async () => {
      mocks.getRepository.mockResolvedValue(null);
      await expect(listProjectFiles('repo-1')).rejects.toThrow(NotFoundError);
    });

    it('throws AppError if relativePath resolves outside of repository path', async () => {
      mocks.getRepository.mockResolvedValue({ localPath: tempDir });
      await expect(listProjectFiles('repo-1', '../outside')).rejects.toThrow(
        expect.objectContaining({ code: 'PATH_OUTSIDE_PROJECT' })
      );
    });

    it('lists directories and files excluding default patterns', async () => {
      mocks.getRepository.mockResolvedValue({ localPath: tempDir });

      await fs.mkdir(path.join(tempDir, 'subdir'));
      await fs.mkdir(path.join(tempDir, '.git'));
      await fs.writeFile(path.join(tempDir, 'file.txt'), 'hello');
      await fs.writeFile(path.join(tempDir, '.env.example'), 'example');
      await fs.writeFile(path.join(tempDir, '.hidden-file'), 'hidden');

      const result = await listProjectFiles('repo-1');
      expect(result).toEqual([
        { name: 'subdir', path: 'subdir', type: 'directory', size: undefined },
        { name: '.env.example', path: '.env.example', type: 'file', size: 7 },
        { name: 'file.txt', path: 'file.txt', type: 'file', size: 5 },
      ]);
    });
  });

  describe('readProjectFile', () => {
    it('throws NotFoundError if repository is not found', async () => {
      mocks.getRepository.mockResolvedValue(null);
      await expect(readProjectFile('repo-1', 'file.txt')).rejects.toThrow(NotFoundError);
    });

    it('throws AppError if path points to a directory', async () => {
      mocks.getRepository.mockResolvedValue({ localPath: tempDir });
      await fs.mkdir(path.join(tempDir, 'subdir'));
      await expect(readProjectFile('repo-1', 'subdir')).rejects.toThrow(
        expect.objectContaining({ code: 'NOT_A_FILE' })
      );
    });

    it('reads small file contents successfully', async () => {
      mocks.getRepository.mockResolvedValue({ localPath: tempDir });
      const filePath = path.join(tempDir, 'file.txt');
      await fs.writeFile(filePath, 'hello-world');

      const result = await readProjectFile('repo-1', 'file.txt');
      expect(result).toEqual({
        path: 'file.txt',
        content: 'hello-world',
        size: 11,
        truncated: false,
      });
    });
  });

  describe('readRepositoryDiff', () => {
    it('throws NotFoundError if repository is not found', async () => {
      mocks.getRepository.mockResolvedValue(null);
      await expect(readRepositoryDiff('repo-1')).rejects.toThrow(NotFoundError);
    });

    it('returns the current repository diff from the git worker tool', async () => {
      mocks.getRepository.mockResolvedValue({ localPath: tempDir });
      mocks.gitDiffTool.mockResolvedValue({
        ok: true,
        payload: {
          diff: 'diff --git a/file.txt b/file.txt\n',
          diffStat: ' file.txt | 1 +',
          hasChanges: true,
        },
      });

      const result = await readRepositoryDiff('repo-1');
      expect(mocks.gitDiffTool).toHaveBeenCalledWith({ repoRoot: tempDir });
      expect(result).toEqual({
        diff: 'diff --git a/file.txt b/file.txt\n',
        diffStat: ' file.txt | 1 +',
        hasChanges: true,
      });
    });

    it('converts git worker tool failures into AppError responses', async () => {
      mocks.getRepository.mockResolvedValue({ localPath: tempDir });
      mocks.gitDiffTool.mockResolvedValue({
        ok: false,
        payload: { diff: '', diffStat: '', hasChanges: false },
        error: { code: 'GIT_DIFF_FAILED', message: 'git failed' },
      });

      await expect(readRepositoryDiff('repo-1')).rejects.toThrow(
        expect.objectContaining({ code: 'GIT_DIFF_FAILED' })
      );
    });
  });

  describe('exportTaskRunJsonl', () => {
    it('returns null if run is not found', async () => {
      mocks.getTaskRun.mockResolvedValue(null);
      const result = await exportTaskRunJsonl('run-1');
      expect(result).toBeNull();
    });

    it('exports task run to JSONL string', async () => {
      mocks.getTaskRun.mockResolvedValue({ id: 'run-1', taskId: 'task-1', repositoryId: 'repo-1' });
      mocks.listTaskEventsForRun.mockResolvedValue([]);
      mocks.listTaskRunTodosForRun.mockResolvedValue([]);
      mocks.getRepository.mockResolvedValue({ id: 'repo-1' });
      mocks.serializeRunToJsonl.mockReturnValue('exported-jsonl-content');

      const result = await exportTaskRunJsonl('run-1');
      expect(result).toBe('exported-jsonl-content');
    });
  });
});
