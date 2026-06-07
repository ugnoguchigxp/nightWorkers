import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AppError, NotFoundError } from '../../lib/errors';
import { buildReviewEvidencePackFromRun } from '../../services/review-rubrics/evidence-pack';
import { listRubrics } from '../../services/review-rubrics/loader';
import {
  runReviewerEvaluationFromPack,
  runReviewReplayEvaluation,
  runReviewReplayEvaluationFromJsonl,
} from '../../services/review-rubrics/replay-evaluation';
import type { ReviewerEvaluationMode } from '../../services/review-rubrics/types';
import { serializeRunToJsonl } from '../../services/run-events/jsonl-export';
import * as repo from './nightworkers.repository';

export function getReviewRubrics() {
  return listRubrics().map((loaded) => ({
    id: loaded.rubric.id,
    title: loaded.rubric.title,
    description: loaded.rubric.description,
    source: loaded.source,
    digest: loaded.digest,
    criteriaCount: loaded.criteriaCount,
    llm: loaded.rubric.llm,
  }));
}

export async function createReviewerEvaluation(
  runId: string,
  request: {
    rubricId?: string;
    mode?: ReviewerEvaluationMode;
    persist?: boolean;
  }
) {
  const run = await repo.getTaskRun(runId);
  if (!run) throw new NotFoundError('Run not found');
  const events = await repo.listTaskEventsForRun(runId);
  const pack = buildReviewEvidencePackFromRun(run, events);
  const evaluation = await runReviewerEvaluationFromPack({
    pack,
    rubricId: request.rubricId || 'basic-coding-run',
    mode: request.mode || 'deterministic_only',
    run: {
      id: run.id,
      taskId: run.taskId,
      status: run.status,
      summary: run.summary,
    },
  });

  if (request.persist !== false) {
    for (const event of evaluation.events) {
      await repo.createRunEvent(
        event,
        event.type === 'review.evaluation_finished'
          ? { payloadJson: { reviewResult: evaluation.reviewResult } }
          : undefined
      );
    }
  }

  return evaluation;
}

export async function createReviewerReplayEvaluation(
  runId: string,
  request: {
    rubricId?: string;
    mode?: ReviewerEvaluationMode;
    jsonl?: string;
    parsedJsonl?: any;
    replayResult?: any;
  }
) {
  const rubricId = request.rubricId || 'basic-coding-run';
  const mode = request.mode || 'deterministic_only';

  if (request.jsonl?.trim()) {
    return runReviewReplayEvaluationFromJsonl({
      jsonl: request.jsonl,
      rubricId,
      mode,
    });
  }

  if (request.parsedJsonl || request.replayResult) {
    return runReviewReplayEvaluation({
      parsedJsonl: request.parsedJsonl,
      replayResult: request.replayResult,
      rubricId,
      mode,
    });
  }

  const jsonl = await exportTaskRunJsonl(runId);
  if (!jsonl) throw new NotFoundError('Run not found');
  return runReviewReplayEvaluationFromJsonl({
    jsonl,
    rubricId,
    mode,
  });
}

export async function browseLocalFolders(targetPath?: string) {
  const baseDir = targetPath ? path.resolve(targetPath) : os.homedir();

  try {
    const files = await fs.readdir(baseDir, { withFileTypes: true });
    const directories = [];

    for (const file of files) {
      if (file.isDirectory() && !file.name.startsWith('.')) {
        directories.push({
          name: file.name,
          path: path.join(baseDir, file.name),
        });
      }
    }

    directories.sort((a, b) => a.name.localeCompare(b.name));

    const parentPath = baseDir === '/' ? null : path.dirname(baseDir);

    return {
      currentPath: baseDir,
      parentPath,
      directories,
    };
  } catch (err: any) {
    const parentPath = baseDir === '/' ? null : path.dirname(baseDir);
    return {
      currentPath: baseDir,
      parentPath,
      directories: [],
      error: err.message,
    };
  }
}

export async function createLocalFolder(input: { parentPath?: string; name: string }) {
  const parentPath = path.resolve(input.parentPath || os.homedir());
  const folderName = input.name.trim();

  if (!folderName) throw new AppError(400, 'EMPTY_FOLDER_NAME', 'Folder name is required');
  if (
    folderName === '.' ||
    folderName === '..' ||
    folderName.includes('/') ||
    folderName.includes('\\')
  ) {
    throw new AppError(400, 'INVALID_FOLDER_NAME', 'Folder name must be a single directory name');
  }

  const targetPath = path.resolve(parentPath, folderName);
  if (path.dirname(targetPath) !== parentPath) {
    throw new AppError(
      400,
      'INVALID_FOLDER_NAME',
      'Folder name must stay inside the current directory'
    );
  }

  await fs.mkdir(targetPath);

  return {
    name: folderName,
    path: targetPath,
  };
}

const PROJECT_TREE_EXCLUDED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'dist-api',
  'coverage',
  '.next',
  '.turbo',
  '.cache',
]);
const PROJECT_FILE_READ_LIMIT = 256 * 1024;

function resolveProjectPath(rootPath: string, relativePath?: string) {
  const root = path.resolve(rootPath);
  const target = path.resolve(root, relativePath || '.');
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new AppError(400, 'PATH_OUTSIDE_PROJECT', 'Path must stay inside the project root');
  }
  return { root, target };
}

export async function listProjectFiles(repositoryId: string, relativePath?: string) {
  const repository = await repo.getRepository(repositoryId);
  if (!repository) throw new NotFoundError('Repository not found');
  const { root, target } = resolveProjectPath(repository.localPath, relativePath);
  const entries = await fs.readdir(target, { withFileTypes: true });
  const result = await Promise.all(
    entries
      .filter((entry) => !entry.name.startsWith('.') || entry.name === '.env.example')
      .filter((entry) => !(entry.isDirectory() && PROJECT_TREE_EXCLUDED_DIRS.has(entry.name)))
      .slice(0, 400)
      .map(async (entry) => {
        const absolutePath = path.join(target, entry.name);
        const stat = await fs.stat(absolutePath).catch(() => null);
        return {
          name: entry.name,
          path: path.relative(root, absolutePath),
          type: entry.isDirectory() ? ('directory' as const) : ('file' as const),
          size: stat?.isFile() ? stat.size : undefined,
        };
      })
  );
  return result.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export async function readProjectFile(repositoryId: string, relativePath: string) {
  const repository = await repo.getRepository(repositoryId);
  if (!repository) throw new NotFoundError('Repository not found');
  const { root, target } = resolveProjectPath(repository.localPath, relativePath);
  const stat = await fs.stat(target);
  if (!stat.isFile()) throw new AppError(400, 'NOT_A_FILE', 'Path is not a file');
  const handle = await fs.open(target, 'r');
  try {
    const readLength = Math.min(stat.size, PROJECT_FILE_READ_LIMIT);
    const buffer = Buffer.alloc(readLength);
    await handle.read(buffer, 0, readLength, 0);
    return {
      path: path.relative(root, target),
      content: buffer.toString('utf8'),
      size: stat.size,
      truncated: stat.size > PROJECT_FILE_READ_LIMIT,
    };
  } finally {
    await handle.close();
  }
}

export async function exportTaskRunJsonl(runId: string) {
  const run = await repo.getTaskRun(runId);
  if (!run) return null;
  const events = await repo.listTaskEventsForRun(runId);
  const todos = await repo.listTaskRunTodosForRun(runId);
  const repository = run.repositoryId ? await repo.getRepository(run.repositoryId) : null;
  return serializeRunToJsonl({ run, events, repository, todos });
}
