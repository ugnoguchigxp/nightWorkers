import type { Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  type ProjectEvaluationBundle,
  type ProjectEvaluationRun,
  projectEvaluationBundleSchema,
} from '../../../shared/schemas/project-evaluation.schema';
import * as nightworkersRepo from '../nightworkers/nightworkers.repository';
import {
  isProjectEvaluationIgnoredPath,
  truncateProjectEvaluationText,
} from './project-evaluation-redaction';

const MAX_TREE_ENTRIES = 360;
const MAX_TREE_DEPTH = 4;
const MAX_RECENT_ITEMS = 8;

type RepositoryRecord = Awaited<ReturnType<typeof nightworkersRepo.getRepository>>;

async function readOptionalText(
  root: string,
  filename: string,
  missingInputs: string[]
): Promise<string | undefined> {
  if (isProjectEvaluationIgnoredPath(filename)) return undefined;
  try {
    const text = await readFile(path.join(root, filename), 'utf8');
    return truncateProjectEvaluationText(text).text;
  } catch {
    missingInputs.push(filename);
    return undefined;
  }
}

async function readPackageJson(root: string, missingInputs: string[]) {
  const text = await readOptionalText(root, 'package.json', missingInputs);
  if (!text) return undefined;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    missingInputs.push('package.json:invalid-json');
    return undefined;
  }
}

function packageScripts(packageJson: Record<string, unknown> | undefined) {
  const scripts = packageJson?.scripts;
  if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) return {};
  return Object.fromEntries(
    Object.entries(scripts).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  );
}

async function collectTree(root: string, current: string, depth: number, entries: string[]) {
  if (entries.length >= MAX_TREE_ENTRIES || depth > MAX_TREE_DEPTH) return;
  let dirents: Dirent[];
  try {
    dirents = await readdir(path.join(root, current), { withFileTypes: true });
  } catch {
    return;
  }
  for (const dirent of dirents.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entries.length >= MAX_TREE_ENTRIES) return;
    const relativePath = path.join(current, dirent.name);
    if (isProjectEvaluationIgnoredPath(relativePath)) continue;
    entries.push(dirent.isDirectory() ? `${relativePath}/` : relativePath);
    if (dirent.isDirectory()) await collectTree(root, relativePath, depth + 1, entries);
  }
}

async function summarizeRecentProjectState(repositoryId: string) {
  const tasks = await nightworkersRepo.listTasks();
  const repositoryTasks = tasks
    .filter((task) => task.repositoryId === repositoryId)
    .slice(0, MAX_RECENT_ITEMS)
    .map((task) => `${task.status}: ${task.title}`);
  return {
    recentTasks: repositoryTasks,
    recentRuns: [] as string[],
  };
}

export async function buildProjectEvaluationBundle(input: {
  repository: NonNullable<RepositoryRecord>;
  previousEvaluation?: ProjectEvaluationRun | null;
}): Promise<ProjectEvaluationBundle> {
  const root = path.resolve(input.repository.localPath);
  const missingInputs: string[] = [];
  const readme = await readOptionalText(root, 'README.md', missingInputs);
  const llmContext = await readOptionalText(root, 'LLM_CONTEXT.md', missingInputs);
  const agents = await readOptionalText(root, 'AGENTS.md', missingInputs);
  const packageJson = await readPackageJson(root, missingInputs);
  const repoTree: string[] = [];
  await collectTree(root, '', 1, repoTree);
  if (repoTree.length === 0) missingInputs.push('repo-tree');
  const recent = await summarizeRecentProjectState(input.repository.id);

  return projectEvaluationBundleSchema.parse({
    schemaVersion: 'nightworkers.project-evaluation-bundle/v1',
    repository: {
      id: input.repository.id,
      name: input.repository.name,
      localPath: root,
      branch: input.repository.branch,
    },
    evidenceLevel: 'repo-structure',
    inputs: {
      readme,
      llmContext,
      agents,
      packageJson,
      repoTree,
      scripts: packageScripts(packageJson),
      recentTasks: recent.recentTasks,
      recentRuns: recent.recentRuns,
      previousEvaluation: input.previousEvaluation
        ? {
            id: input.previousEvaluation.id,
            overallScore: input.previousEvaluation.overallScore,
            overallConfidence: input.previousEvaluation.overallConfidence,
            dimensions: input.previousEvaluation.dimensions.map((dimension) => ({
              key: dimension.key,
              score: dimension.score,
            })),
            weaknesses: input.previousEvaluation.weaknesses,
            createdAt: input.previousEvaluation.createdAt,
          }
        : undefined,
    },
    missingInputs,
    notVerified: [
      'ローカルビルド',
      'テスト実行',
      'ランタイム挙動',
      'ソースコード全量の監査',
      'サンプル出力の品質',
    ],
    createdAt: new Date().toISOString(),
  });
}
