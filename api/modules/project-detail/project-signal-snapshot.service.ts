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
      .map((goal) => ({ id: goal.id, title: goal.title, goalText: goal.goalText })),
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
    qualityCapabilities: signalQualityCapabilities(input.repository.localPath),
    recentTokenSpendTasks: await recentTokenSpendTasks(input.repository.id),
    recentRuns: await recentRunCounts(input.repository.id),
  };
}
