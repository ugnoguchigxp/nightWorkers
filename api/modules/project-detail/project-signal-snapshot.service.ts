import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import type {
  MissionGoal,
  ProjectQualityCapabilities,
  ProjectSignalSnapshot,
} from '../../../shared/schemas/project-detail.schema';
import { db } from '../../db/client';
import { llmUsageRecords, taskRuns, tasks } from '../../db/schema';
import * as projectEvaluationRepo from '../project-evaluation/project-evaluation.repository';
import * as projectDetailRepo from './project-detail.repository';

type RepositorySignalInput = {
  id: string;
  name: string;
  localPath: string;
  branch: string;
};

function readPackageJson(repoRoot: string): Record<string, unknown> | null {
  const packageJsonPath = path.join(repoRoot, 'package.json');
  if (!fs.existsSync(packageJsonPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readPackageScripts(repoRoot: string): Record<string, string> {
  const packageJson = readPackageJson(repoRoot);
  const scripts = packageJson?.scripts;
  if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) return {};
  return Object.fromEntries(
    Object.entries(scripts).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  );
}

function readReadmeExcerpt(repoRoot: string) {
  const readmePath = path.join(repoRoot, 'README.md');
  if (!fs.existsSync(readmePath)) return null;
  try {
    return fs.readFileSync(readmePath, 'utf8').slice(0, 4000);
  } catch {
    return null;
  }
}

function packageStringField(
  packageJson: Record<string, unknown> | null,
  field: 'name' | 'description'
) {
  const value = packageJson?.[field];
  return typeof value === 'string' && value.trim() ? value : null;
}

function listRepositoryFiles(repoRoot: string) {
  const ignored = new Set([
    '.git',
    'node_modules',
    'coverage',
    'dist',
    'dist-web',
    'build',
    'playwright-report',
    'test-results',
    'data',
  ]);
  const files: string[] = [];

  function visit(current: string, depth: number) {
    if (depth > 5 || files.length >= 300) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (ignored.has(entry.name)) continue;
      const fullPath = path.join(current, entry.name);
      const relativePath = path.relative(repoRoot, fullPath);
      if (entry.isDirectory()) {
        visit(fullPath, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      files.push(relativePath);
    }
  }

  visit(repoRoot, 0);
  return files.sort();
}

function readSourceExcerpts(repoRoot: string, sourceFiles: string[]) {
  const preferred = sourceFiles.filter(
    (filePath) =>
      /\.(ts|tsx|js|jsx|css|md)$/.test(filePath) &&
      (/(^|\/)(src|app|web|pages|routes?|components|views?)\//.test(filePath) ||
        /(^|\/)(README|package)\./i.test(filePath))
  );
  const fallback = sourceFiles.filter((filePath) => /\.(ts|tsx|js|jsx|md)$/.test(filePath));
  return [...new Set([...preferred, ...fallback])].slice(0, 16).flatMap((filePath) => {
    try {
      const fullPath = path.join(repoRoot, filePath);
      const stat = fs.statSync(fullPath);
      if (!stat.isFile() || stat.size > 80_000) return [];
      const excerpt = fs
        .readFileSync(fullPath, 'utf8')
        .replace(/\s+\n/g, '\n')
        .slice(0, 1800)
        .trim();
      return excerpt ? [{ path: filePath, excerpt }] : [];
    } catch {
      return [];
    }
  });
}

function readTextExcerpt(filePath: string, maxChars: number) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > 120_000) return null;
    const excerpt = fs.readFileSync(filePath, 'utf8').slice(0, maxChars).trim();
    return excerpt || null;
  } catch {
    return null;
  }
}

function readLlmContextFiles(repoRoot: string, sourceFiles: string[]) {
  const contextFileNames = new Set([
    'LLM_CONTEXT.md',
    'LLM_CONTEXT',
    'llm-context.md',
    '.llm-context.md',
  ]);
  return sourceFiles
    .filter((filePath) => contextFileNames.has(filePath) || /(^|\/)LLM_CONTEXT\.md$/.test(filePath))
    .slice(0, 4)
    .flatMap((filePath) => {
      const excerpt = readTextExcerpt(path.join(repoRoot, filePath), 6000);
      return excerpt ? [{ path: filePath, excerpt }] : [];
    });
}

function readModuleOntology(repoRoot: string) {
  const candidates = [
    path.join(repoRoot, '.agent-ontology', 'modules.yaml'),
    path.join(repoRoot, '.agent-ontology', 'modules.yml'),
    path.join(repoRoot, '.agent-ontology', 'modules.json'),
  ];
  for (const filePath of candidates) {
    const excerpt = readTextExcerpt(filePath, 12_000);
    if (excerpt) {
      return {
        path: path.relative(repoRoot, filePath),
        excerpt,
      };
    }
  }
  return null;
}

function git(repoRoot: string, args: string[]) {
  try {
    return execFileSync('git', ['-C', repoRoot, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
      maxBuffer: 256_000,
    }).trim();
  } catch {
    return '';
  }
}

function readRecentNonInitialCommitDiffs(repoRoot: string) {
  const hashes = git(repoRoot, ['rev-list', '--max-count=2', '--min-parents=1', 'HEAD'])
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return hashes.flatMap((hash) => {
    const header = git(repoRoot, ['show', '--no-patch', '--format=%h%n%s', hash]).split('\n');
    const diff = git(repoRoot, [
      'show',
      '--format=',
      '--stat',
      '--patch',
      '--find-renames',
      '--unified=2',
      hash,
    ]).slice(0, 10_000);
    if (!diff) return [];
    return [
      {
        hash: header[0] || hash.slice(0, 12),
        subject: header.slice(1).join('\n').trim() || '(no subject)',
        diffExcerpt: diff,
      },
    ];
  });
}

function buildRepositorySnapshot(repoRoot: string): ProjectSignalSnapshot['repositorySnapshot'] {
  const packageJson = readPackageJson(repoRoot);
  const sourceFiles = listRepositoryFiles(repoRoot);
  const llmContextFiles = readLlmContextFiles(repoRoot, sourceFiles);
  const packageScripts = Object.entries(readPackageScripts(repoRoot))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, command]) => ({ name, command }));
  return {
    packageName: packageStringField(packageJson, 'name'),
    description: packageStringField(packageJson, 'description'),
    readmeExcerpt: readReadmeExcerpt(repoRoot),
    sourceFiles: sourceFiles
      .filter((filePath) => /\.(ts|tsx|js|jsx|css|sql|md|json)$/.test(filePath))
      .slice(0, 120),
    routeFiles: sourceFiles
      .filter((filePath) => /(^|\/)(routes?|views?)\//.test(filePath))
      .slice(0, 80),
    migrationFiles: sourceFiles.filter((filePath) => filePath.startsWith('drizzle/')).slice(0, 40),
    sourceExcerpts: readSourceExcerpts(repoRoot, sourceFiles),
    llmContextFiles,
    recentCommitDiffs: llmContextFiles.length > 0 ? [] : readRecentNonInitialCommitDiffs(repoRoot),
    packageScripts,
    moduleOntology: readModuleOntology(repoRoot),
  };
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function bunRun(scriptName: string) {
  return `bun run ${shellQuote(scriptName)}`;
}

export function detectQualityCapabilities(repoRoot: string): ProjectQualityCapabilities {
  const scripts = readPackageScripts(repoRoot);
  const unitCommand = scripts.test ? bunRun('test') : undefined;
  const coverageCommand = scripts['test:coverage'] ? bunRun('test:coverage') : undefined;
  const e2eCommand = scripts['test:e2e'] ? bunRun('test:e2e') : undefined;
  const allMissing = [...(unitCommand ? [] : ['unit']), ...(e2eCommand ? [] : ['e2e'])];
  return {
    projectType: 'typescript',
    unit: {
      runnable: Boolean(unitCommand),
      missingCapabilities: unitCommand ? [] : ['unit'],
      command: unitCommand,
    },
    coverage: {
      runnable: Boolean(coverageCommand),
      missingCapabilities: coverageCommand ? [] : ['coverage'],
      command: coverageCommand,
    },
    e2e: {
      runnable: Boolean(e2eCommand),
      missingCapabilities: e2eCommand ? [] : ['e2e'],
      command: e2eCommand,
    },
    all: {
      runnable: Boolean(unitCommand && e2eCommand),
      missingCapabilities: allMissing,
      command:
        unitCommand && e2eCommand
          ? [unitCommand, coverageCommand, e2eCommand].filter(Boolean).join(' && ')
          : undefined,
    },
  };
}

function signalQualityCapabilities(repoRoot: string): ProjectSignalSnapshot['qualityCapabilities'] {
  const capabilities = detectQualityCapabilities(repoRoot);
  const commands: ProjectSignalSnapshot['qualityCapabilities']['commands'] = [];
  for (const [kind, capability] of [
    ['unit', capabilities.unit],
    ['coverage', capabilities.coverage],
    ['e2e', capabilities.e2e],
  ] as const) {
    commands.push({
      kind,
      source: 'package_json',
      command: capability.command ?? '',
      runnable: capability.runnable,
      reason: capability.runnable ? undefined : `package.json script for ${kind} is missing`,
    });
  }
  const scripts = readPackageScripts(repoRoot);
  commands.push({
    kind: 'verify',
    source: 'package_json',
    command: scripts.verify ? bunRun('verify') : '',
    runnable: Boolean(scripts.verify),
    reason: scripts.verify ? undefined : 'package.json script for verify is missing',
  });
  return {
    projectType: 'typescript',
    commands,
    missingCapabilities: [
      ...(capabilities.unit.runnable ? [] : (['unit'] as const)),
      ...(capabilities.coverage.runnable ? [] : (['coverage'] as const)),
      ...(capabilities.e2e.runnable ? [] : (['e2e'] as const)),
    ],
  };
}

async function recentTokenSpendTasks(repositoryId: string) {
  const rows = await db
    .select({
      taskId: llmUsageRecords.taskId,
      title: tasks.title,
      totalTokens: llmUsageRecords.totalTokens,
    })
    .from(llmUsageRecords)
    .innerJoin(tasks, eq(tasks.id, llmUsageRecords.taskId))
    .where(eq(tasks.repositoryId, repositoryId));
  const byTask = new Map<
    string,
    { taskId: string; title: string; totalTokens: number; callCount: number }
  >();
  for (const row of rows) {
    const current = byTask.get(row.taskId) ?? {
      taskId: row.taskId,
      title: row.title,
      totalTokens: 0,
      callCount: 0,
    };
    current.totalTokens += row.totalTokens ?? 0;
    current.callCount += 1;
    byTask.set(row.taskId, current);
  }
  return [...byTask.values()].sort((a, b) => b.totalTokens - a.totalTokens).slice(0, 5);
}

async function recentRunCounts(repositoryId: string) {
  const rows = await db.select().from(taskRuns).where(eq(taskRuns.repositoryId, repositoryId));
  return {
    completed: rows.filter((row) => row.status === 'completed').length,
    failed: rows.filter((row) => row.status === 'failed' || row.status === 'timed_out').length,
    running: rows.filter((row) => row.status === 'running' || row.status === 'context_compiling')
      .length,
  };
}

export async function buildProjectSignalSnapshot(input: {
  repository: RepositorySignalInput;
  goals: MissionGoal[];
}): Promise<ProjectSignalSnapshot> {
  const latestEvaluation = await projectEvaluationRepo.getLatestProjectEvaluation(
    input.repository.id
  );
  const latestQuality = await projectDetailRepo.getLatestProjectQualityRun({
    repositoryId: input.repository.id,
  });
  return {
    repository: {
      id: input.repository.id,
      name: input.repository.name,
      localPath: input.repository.localPath,
      branch: input.repository.branch,
    },
    activeGoals: input.goals
      .filter((goal) => goal.active)
      .map((goal) => ({
        id: goal.id,
        title: goal.title,
        goalText: goal.goalText,
        interpretation: goal.interpretation,
      })),
    latestEvaluation: latestEvaluation
      ? {
          id: latestEvaluation.id,
          overallScore: latestEvaluation.overallScore,
          dimensions: latestEvaluation.dimensions.map((dimension) => ({
            key: dimension.key,
            score: dimension.score,
            label: dimension.label,
          })),
          summary: latestEvaluation.summary,
        }
      : null,
    latestQuality: {
      coverage: latestQuality?.coverageGate ?? null,
      e2e: latestQuality?.e2eSummary ?? null,
    },
    repositorySnapshot: buildRepositorySnapshot(input.repository.localPath),
    qualityCapabilities: signalQualityCapabilities(input.repository.localPath),
    recentTokenSpendTasks: await recentTokenSpendTasks(input.repository.id),
    recentRuns: await recentRunCounts(input.repository.id),
  };
}
