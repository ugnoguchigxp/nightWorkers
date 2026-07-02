import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { z } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import {
  e2eSummarySchema,
  type MissionGoal,
  type MissionTaskCandidate,
  type MissionTaskCandidatesResult,
  missionTaskCandidatesResultSchema,
  type ProjectQualityCapabilities,
  type ProjectSignalSnapshot,
} from '../../../shared/schemas/project-detail.schema';
import { db } from '../../db/client';
import { llmUsageRecords, taskRuns, tasks } from '../../db/schema';
import { NotFoundError, ValidationError } from '../../lib/errors';
import {
  evaluateCoverageGate,
  readCoverageSummaryFile,
} from '../../services/quality/coverage-gate';
import { readTestQualitySettingsFile } from '../../services/settings/test-quality-settings';
import type { SupervisorLlmDebugEvent } from '../../services/structured-llm';
import {
  buildNormalizedSupervisorLlmRequest,
  callStructuredJsonLLM,
} from '../../services/structured-llm';
import * as nightworkersRepo from '../nightworkers/nightworkers.repository';
import * as projectEvaluationRepo from '../project-evaluation/project-evaluation.repository';
import * as repo from './project-detail.repository';

const MISSION_TASK_SCHEMA_NAME = 'mission_task_candidates';
const MAX_OUTPUT_CHARS = 120_000;

export const missionGoalPresets = [
  {
    id: 'coverage-threshold',
    title: 'Keep unit coverage above configured threshold',
    goalText:
      '設定済みの coverage threshold を継続的に満たし、coverage 低下を早期に検知できる状態を維持する。',
  },
  {
    id: 'planning-quality',
    title: 'Keep planning quality above threshold',
    goalText:
      'Plan / specification の品質を維持し、実装前に必要な判断材料と受け入れ条件が揃っている状態を保つ。',
  },
  {
    id: 'token-spend',
    title: 'Control recurring LLM token spend',
    goalText:
      '繰り返し発生する LLM token 消費を把握し、同じ作業で過剰な token を消費しない状態にする。',
  },
  {
    id: 'queue-reliability',
    title: 'Keep queue execution reliability healthy',
    goalText:
      'Queue 実行の失敗、停滞、再実行不能な状態を減らし、完了・失敗・人間確認の状態が明確に残るようにする。',
  },
];

async function requireRepository(repositoryId: string) {
  const repository = await nightworkersRepo.getRepository(repositoryId);
  if (!repository) throw new NotFoundError('Repository not found');
  return repository;
}

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

function detectQualityCapabilities(repoRoot: string): ProjectQualityCapabilities {
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

async function buildProjectSignalSnapshot(input: {
  repository: Awaited<ReturnType<typeof requireRepository>>;
  goals: MissionGoal[];
}): Promise<ProjectSignalSnapshot> {
  const latestEvaluation = await projectEvaluationRepo.getLatestProjectEvaluation(
    input.repository.id
  );
  const latestQuality = await repo.getLatestProjectQualityRun({
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

export async function getProjectDetailMetrics(repositoryId: string) {
  await requireRepository(repositoryId);
  const [runs, usageRows, latestEvaluation, latestQuality] = await Promise.all([
    db.select().from(taskRuns).where(eq(taskRuns.repositoryId, repositoryId)),
    db
      .select({
        taskId: llmUsageRecords.taskId,
        title: tasks.title,
        provider: llmUsageRecords.provider,
        model: llmUsageRecords.model,
        inputTokens: llmUsageRecords.inputTokens,
        outputTokens: llmUsageRecords.outputTokens,
        cachedInputTokens: llmUsageRecords.cachedInputTokens,
        reasoningOutputTokens: llmUsageRecords.reasoningOutputTokens,
        stateCardTokens: llmUsageRecords.stateCardTokens,
        systemPromptTokens: llmUsageRecords.systemPromptTokens,
        userPromptTokens: llmUsageRecords.userPromptTokens,
        totalTokens: llmUsageRecords.totalTokens,
      })
      .from(llmUsageRecords)
      .innerJoin(tasks, eq(tasks.id, llmUsageRecords.taskId))
      .where(eq(tasks.repositoryId, repositoryId)),
    projectEvaluationRepo.getLatestProjectEvaluation(repositoryId),
    repo.getLatestProjectQualityRun({ repositoryId }),
  ]);

  const totalTokens = usageRows.reduce((sum, row) => sum + normalizeUsageTotal(row), 0);
  const inputTokens = usageRows.reduce((sum, row) => sum + (row.inputTokens ?? 0), 0);
  const outputTokens = usageRows.reduce((sum, row) => sum + (row.outputTokens ?? 0), 0);
  const cachedInputTokens = usageRows.reduce((sum, row) => sum + (row.cachedInputTokens ?? 0), 0);
  const reasoningOutputTokens = usageRows.reduce(
    (sum, row) => sum + (row.reasoningOutputTokens ?? 0),
    0
  );
  const stateCardTokens = usageRows.reduce((sum, row) => sum + (row.stateCardTokens ?? 0), 0);
  const promptInputTokens = usageRows.reduce(
    (sum, row) =>
      sum +
      (row.systemPromptTokens ?? 0) +
      (row.userPromptTokens ?? 0) +
      (row.stateCardTokens ?? 0),
    0
  );
  const modelMap = new Map<
    string,
    {
      provider: string;
      model: string | null;
      calls: number;
      tokens: number;
      inputTokens: number;
      outputTokens: number;
      cachedInputTokens: number;
      reasoningOutputTokens: number;
    }
  >();
  const taskMap = new Map<
    string,
    {
      taskId: string;
      title: string;
      tokens: number;
      inputTokens: number;
      outputTokens: number;
      cachedInputTokens: number;
      reasoningOutputTokens: number;
      cost: null;
    }
  >();
  for (const row of usageRows) {
    const modelKey = `${row.provider}:${row.model ?? ''}`;
    const modelEntry = modelMap.get(modelKey) ?? {
      provider: row.provider,
      model: row.model ?? null,
      calls: 0,
      tokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      reasoningOutputTokens: 0,
    };
    modelEntry.calls += 1;
    modelEntry.tokens += normalizeUsageTotal(row);
    modelEntry.inputTokens += row.inputTokens ?? 0;
    modelEntry.outputTokens += row.outputTokens ?? 0;
    modelEntry.cachedInputTokens += row.cachedInputTokens ?? 0;
    modelEntry.reasoningOutputTokens += row.reasoningOutputTokens ?? 0;
    modelMap.set(modelKey, modelEntry);

    const taskEntry = taskMap.get(row.taskId) ?? {
      taskId: row.taskId,
      title: row.title,
      tokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      reasoningOutputTokens: 0,
      cost: null,
    };
    taskEntry.tokens += normalizeUsageTotal(row);
    taskEntry.inputTokens += row.inputTokens ?? 0;
    taskEntry.outputTokens += row.outputTokens ?? 0;
    taskEntry.cachedInputTokens += row.cachedInputTokens ?? 0;
    taskEntry.reasoningOutputTokens += row.reasoningOutputTokens ?? 0;
    taskMap.set(row.taskId, taskEntry);
  }
  const coverageMetrics = latestQuality?.coverageGate?.metrics ?? [];
  const coverageAverage =
    coverageMetrics.length > 0
      ? Math.round(
          (coverageMetrics.reduce((sum, metric) => sum + metric.actualPercent, 0) /
            coverageMetrics.length) *
            100
        ) / 100
      : null;

  return {
    runs: {
      total: runs.length,
      completed: runs.filter((run) => run.status === 'completed').length,
      failed: runs.filter((run) => run.status === 'failed' || run.status === 'timed_out').length,
    },
    llmUsage: {
      totalTokens,
      promptInputTokens,
      inputTokens,
      outputTokens,
      cachedInputTokens,
      reasoningOutputTokens,
      stateCardTokens,
      callCount: usageRows.length,
      totalCost: null,
      averageTokensPerRun: runs.length > 0 ? Math.round(totalTokens / runs.length) : null,
      averageCostPerRun: null,
      modelMix: [...modelMap.values()].map((entry) => ({ ...entry, cost: null })),
      topTokenTasks: [...taskMap.values()].sort((a, b) => b.tokens - a.tokens).slice(0, 5),
    },
    health: {
      latestEvaluationScore: latestEvaluation?.overallScore ?? null,
      coverageAverage,
    },
  };
}

function normalizeUsageTotal(row: {
  totalTokens?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
}) {
  return row.totalTokens ?? (row.inputTokens ?? 0) + (row.outputTokens ?? 0);
}

export async function listMissionGoals(repositoryId: string) {
  await requireRepository(repositoryId);
  return repo.listMissionGoals(repositoryId);
}

export async function createMissionGoal(
  repositoryId: string,
  input: { title: string; goalText: string; active: boolean }
) {
  await requireRepository(repositoryId);
  return repo.createMissionGoal({ repositoryId, ...input, source: 'user' });
}

export async function updateMissionGoal(
  repositoryId: string,
  goalId: string,
  input: { title?: string; goalText?: string; active?: boolean; sortOrder?: number }
) {
  await requireRepository(repositoryId);
  const existing = await repo.getMissionGoal(goalId);
  if (!existing || existing.repositoryId !== repositoryId)
    throw new NotFoundError('Mission goal not found');
  const updated = await repo.updateMissionGoal(goalId, input);
  if (!updated) throw new NotFoundError('Mission goal not found');
  return updated;
}

export async function deleteMissionGoal(repositoryId: string, goalId: string) {
  await requireRepository(repositoryId);
  const existing = await repo.getMissionGoal(goalId);
  if (!existing || existing.repositoryId !== repositoryId)
    throw new NotFoundError('Mission goal not found');
  const deleted = await repo.deleteMissionGoal(goalId);
  if (!deleted) throw new NotFoundError('Mission goal not found');
  return deleted;
}

export function listMissionGoalPresets() {
  return missionGoalPresets;
}

export async function createMissionGoalFromPreset(
  repositoryId: string,
  input: { presetId: string; active: boolean }
) {
  await requireRepository(repositoryId);
  const preset = missionGoalPresets.find((item) => item.id === input.presetId);
  if (!preset) throw new NotFoundError('Mission goal preset not found');
  return repo.createMissionGoal({
    repositoryId,
    title: preset.title,
    goalText: preset.goalText,
    active: input.active,
    source: 'preset',
  });
}

function buildMissionTaskSystemPrompt() {
  return [
    'あなたは NightWorkers の Mission Task Candidate generator です。',
    'Mission Goal と project signal から、ユーザーが Task 化する候補だけを JSON schema に従って返してください。',
    'Quality や Evaluation の成功/失敗判定は行わず、保存済み signal を根拠として扱ってください。',
    'unit / coverage / e2e capability が欠けている場合は、package.json scripts または project quality settings を整備する候補を最優先にしてください。',
    '秘密情報、生ログ全文、リポジトリ全文を要求しないでください。',
  ].join('\n');
}

function buildMissionTaskUserPrompt(input: {
  signal: ProjectSignalSnapshot;
  existingCandidates: MissionTaskCandidate[];
  existingTaskTitles: string[];
}) {
  return JSON.stringify(
    {
      missionGoals: input.signal.activeGoals,
      projectSignalSnapshot: input.signal,
      existingUncreatedCandidates: input.existingCandidates.map((candidate) => ({
        id: candidate.id,
        title: candidate.title,
        status: candidate.status,
      })),
      existingTaskTitles: input.existingTaskTitles,
      outputSchema: 'nightworkers.mission-task-candidates/v1',
    },
    null,
    2
  );
}

function selectedModelForMissionPrompt(systemPrompt: string, userPrompt: string) {
  const schema = z.toJSONSchema(missionTaskCandidatesResultSchema);
  const normalized = buildNormalizedSupervisorLlmRequest({
    systemPrompt,
    userPrompt,
    label: MISSION_TASK_SCHEMA_NAME,
    role: 'mission_task_generation',
    jsonSchema: { name: MISSION_TASK_SCHEMA_NAME, schema },
  });
  return {
    role: 'mission_task_generation',
    providerId: normalized.providerId,
    providerEndpointId: normalized.providerEndpointId ?? null,
    routeSource: normalized.routeSource ?? null,
    modelOrDeployment: normalized.modelOrDeployment,
    thinkingDepth: normalized.thinkingDepth ?? null,
  };
}

function selectionFromLlmEvent(event: SupervisorLlmDebugEvent) {
  if (event.type !== 'model.request_started') return null;
  const data = event.data || {};
  return {
    role: 'mission_task_generation',
    providerId: typeof data.provider === 'string' ? data.provider : 'unknown',
    providerEndpointId:
      typeof data.providerEndpointId === 'string' ? data.providerEndpointId : null,
    routeSource: typeof data.routeSource === 'string' ? data.routeSource : null,
    modelOrDeployment: typeof data.model === 'string' ? data.model : null,
    thinkingDepth: typeof data.thinkingDepth === 'string' ? data.thinkingDepth : null,
  };
}

function hasQualitySetupCandidate(result: MissionTaskCandidatesResult) {
  return result.candidates.some((candidate) => {
    const text = [
      candidate.title,
      candidate.summary,
      candidate.rationale,
      candidate.taskPrompt,
      candidate.acceptanceCriteria,
      candidate.verificationPlan,
      ...candidate.evidence.map((item) => `${item.label} ${item.value}`),
    ]
      .join('\n')
      .toLowerCase();
    return (
      candidate.importancePercent >= 95 &&
      candidate.evidence.some((item) => item.source === 'quality') &&
      (text.includes('package.json') ||
        text.includes('test:coverage') ||
        text.includes('test:e2e') ||
        text.includes('unit') ||
        text.includes('coverage'))
    );
  });
}

function rejectDuplicateTitles(candidates: MissionTaskCandidatesResult['candidates']) {
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const key = candidate.title.trim().toLowerCase();
    if (seen.has(key))
      throw new ValidationError('Mission task generation returned duplicate titles');
    seen.add(key);
  }
}

function validateGeneratedGoalIds(
  candidates: MissionTaskCandidatesResult['candidates'],
  allowedGoals: MissionGoal[]
) {
  const allowedGoalIds = new Set(allowedGoals.map((goal) => goal.id));
  for (const candidate of candidates) {
    if (candidate.goalId && !allowedGoalIds.has(candidate.goalId)) {
      throw new ValidationError('Mission task generation returned an unknown goalId', {
        goalId: candidate.goalId,
      });
    }
  }
}

export async function listMissionTaskCandidates(input: { repositoryId: string; status?: string }) {
  await requireRepository(input.repositoryId);
  return repo.listMissionCandidates(input);
}

export async function getMissionTaskCandidate(candidateId: string) {
  const candidate = await repo.getMissionCandidate(candidateId);
  if (!candidate) throw new NotFoundError('Mission task candidate not found');
  return candidate;
}

export async function updateMissionTaskCandidate(candidateId: string, input: { status?: string }) {
  const existing = await repo.getMissionCandidate(candidateId);
  if (!existing) throw new NotFoundError('Mission task candidate not found');
  if (input.status === 'task_created') {
    throw new ValidationError('Task-created status is only set by create-tasks');
  }
  if (existing.status === 'task_created' && input.status && input.status !== 'task_created') {
    throw new ValidationError('Task-created candidates cannot be moved back to another status');
  }
  const updated = await repo.updateMissionCandidate(candidateId, input);
  if (!updated) throw new NotFoundError('Mission task candidate not found');
  return updated;
}

export async function generateMissionTaskCandidates(input: {
  repositoryId: string;
  goalIds?: string[];
  includeInactiveGoals?: boolean;
}) {
  const repository = await requireRepository(input.repositoryId);
  const allGoals = await repo.listMissionGoals(repository.id);
  const selectedGoals = allGoals.filter((goal) => {
    if (input.goalIds?.length && !input.goalIds.includes(goal.id)) return false;
    return input.includeInactiveGoals || goal.active;
  });
  if (selectedGoals.length === 0)
    throw new ValidationError('At least one mission goal is required');
  const signal = await buildProjectSignalSnapshot({ repository, goals: selectedGoals });
  const batch = await repo.createRunningMissionBatch({
    repositoryId: repository.id,
    requestedGoalIds: selectedGoals.map((goal) => goal.id),
    signalSnapshot: signal,
  });

  const existingCandidates = await repo.listMissionCandidates({
    repositoryId: repository.id,
    status: 'candidate',
  });
  const existingTasks = await db
    .select({ title: tasks.title })
    .from(tasks)
    .where(eq(tasks.repositoryId, repository.id));
  const systemPrompt = buildMissionTaskSystemPrompt();
  const userPrompt = buildMissionTaskUserPrompt({
    signal,
    existingCandidates,
    existingTaskTitles: existingTasks.map((task) => task.title),
  });
  let selectedModel: unknown = selectedModelForMissionPrompt(systemPrompt, userPrompt);
  try {
    const raw = await callStructuredJsonLLM(systemPrompt, userPrompt, {
      role: 'mission_task_generation',
      schemaName: MISSION_TASK_SCHEMA_NAME,
      schema: z.toJSONSchema(missionTaskCandidatesResultSchema),
      emitEvent: async (event) => {
        const nextSelection = selectionFromLlmEvent(event);
        if (nextSelection) selectedModel = nextSelection;
      },
    });
    const rawOutput = JSON.parse(raw) as unknown;
    const parsed = missionTaskCandidatesResultSchema.parse(rawOutput);
    rejectDuplicateTitles(parsed.candidates);
    validateGeneratedGoalIds(parsed.candidates, selectedGoals);
    if (
      signal.qualityCapabilities.missingCapabilities.length > 0 &&
      !hasQualitySetupCandidate(parsed)
    ) {
      throw new ValidationError(
        'Mission task generation must prioritize missing quality capabilities',
        {
          missingCapabilities: signal.qualityCapabilities.missingCapabilities,
        }
      );
    }
    await repo.completeMissionBatch({ batchId: batch.id, rawOutput, selectedModel });
    const candidates = await repo.createMissionCandidates(
      parsed.candidates.map((candidate) => {
        const duplicate = existingTasks.some(
          (task) => task.title.trim().toLowerCase() === candidate.title.trim().toLowerCase()
        );
        return {
          batchId: batch.id,
          repositoryId: repository.id,
          goalId: candidate.goalId ?? null,
          title: candidate.title,
          summary: candidate.summary,
          rationale: candidate.rationale,
          evidenceJson: duplicate
            ? [
                ...candidate.evidence,
                {
                  source: 'recent_runs' as const,
                  label: 'duplicateWarning',
                  value: '同名の既存 task が存在します。',
                },
              ]
            : candidate.evidence,
          evaluationContribution: candidate.evaluationContribution ?? null,
          importancePercent: candidate.importancePercent,
          confidencePercent: candidate.confidencePercent,
          tokenSize: candidate.tokenSize,
          complexity: candidate.complexity,
          taskPrompt: candidate.taskPrompt,
          acceptanceCriteria: candidate.acceptanceCriteria,
          verificationPlan: candidate.verificationPlan,
          status: 'candidate',
        };
      })
    );
    return { batchId: batch.id, status: 'completed' as const, candidates };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await repo.failMissionBatch({ batchId: batch.id, errorMessage: message, selectedModel });
    throw new ValidationError('Mission task generation failed', { message });
  }
}

export async function createTasksFromMissionCandidates(input: {
  repositoryId: string;
  candidateIds: string[];
  mode: 'draft' | 'ready';
}) {
  await requireRepository(input.repositoryId);
  const candidates = await repo.listMissionCandidatesByIds(input.candidateIds);
  if (candidates.length !== input.candidateIds.length) {
    throw new NotFoundError('Mission task candidate not found');
  }
  for (const candidate of candidates) {
    if (candidate.repositoryId !== input.repositoryId)
      throw new NotFoundError('Mission task candidate not found');
    if (candidate.status === 'task_created' || candidate.taskId) {
      throw new ValidationError('Mission task candidate already has a linked task', {
        candidateId: candidate.id,
      });
    }
    if (candidate.status === 'dismissed') {
      throw new ValidationError('Dismissed candidates cannot be converted to tasks', {
        candidateId: candidate.id,
      });
    }
  }
  return db.transaction(async (tx) => {
    const createdTasks = [];
    const updatedCandidates = [];
    for (const candidate of candidates) {
      const task = await repo.createTaskFromMissionCandidate(candidate, input.mode, tx);
      const updated = await repo.updateMissionCandidate(
        candidate.id,
        { status: 'task_created', taskId: task.id },
        tx
      );
      createdTasks.push(task);
      if (updated) updatedCandidates.push(updated);
    }
    return { tasks: createdTasks, candidates: updatedCandidates };
  });
}

function commandForQualityRun(
  capabilities: ProjectQualityCapabilities,
  runType: 'unit' | 'e2e' | 'all'
) {
  if (runType === 'unit') {
    if (!capabilities.unit.runnable || !capabilities.unit.command) {
      throw new ValidationError('missing_quality_capability', { missingCapabilities: ['unit'] });
    }
    return [capabilities.unit.command, capabilities.coverage.command].filter(Boolean).join(' && ');
  }
  if (runType === 'e2e') {
    if (!capabilities.e2e.runnable || !capabilities.e2e.command) {
      throw new ValidationError('missing_quality_capability', { missingCapabilities: ['e2e'] });
    }
    return capabilities.e2e.command;
  }
  if (!capabilities.all.runnable || !capabilities.all.command) {
    throw new ValidationError('missing_quality_capability', {
      missingCapabilities: capabilities.all.missingCapabilities,
    });
  }
  return capabilities.all.command;
}

async function runShellCommand(input: { command: string; cwd: string; timeoutSeconds: number }) {
  return new Promise<{ exitCode: number | null; output: string; timedOut: boolean }>((resolve) => {
    const child = spawn(input.command, {
      cwd: input.cwd,
      shell: true,
      env: { ...process.env, CI: process.env.CI ?? '1' },
    });
    let output = '';
    const append = (chunk: Buffer) => {
      output += chunk.toString('utf8');
      if (output.length > MAX_OUTPUT_CHARS) output = output.slice(-MAX_OUTPUT_CHARS);
    };
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({ exitCode: null, output, timedOut: true });
    }, input.timeoutSeconds * 1000);
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, output, timedOut: false });
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ exitCode: null, output: `${output}\n${error.message}`, timedOut: false });
    });
  });
}

function readCoverageArtifacts(repositoryRoot: string) {
  const summaryPath = path.join(repositoryRoot, 'coverage', 'coverage-summary.json');
  if (!fs.existsSync(summaryPath))
    return { coverageSummary: null, coverageGate: null, error: 'coverage-summary.json not found' };
  try {
    const coverageSummary = readCoverageSummaryFile(summaryPath);
    const coverageGate = evaluateCoverageGate(
      readTestQualitySettingsFile(repositoryRoot),
      coverageSummary,
      {
        summaryPath,
      }
    );
    return { coverageSummary, coverageGate, error: null };
  } catch (error) {
    return {
      coverageSummary: null,
      coverageGate: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function minimalE2eSummary(exitCode: number | null) {
  return e2eSummarySchema.parse({
    status: exitCode === 0 ? 'passed' : exitCode === null ? 'unknown' : 'failed',
    total: 0,
    passed: 0,
    failed: exitCode === 0 ? 0 : 1,
    skipped: 0,
    durationMs: null,
    suites: [],
  });
}

export async function getProjectQuality(repositoryId: string) {
  const repository = await requireRepository(repositoryId);
  const [latestUnitRun, latestE2eRun, runningRuns] = await Promise.all([
    repo.getLatestProjectQualityRun({ repositoryId, runType: 'unit' }),
    repo.getLatestProjectQualityRun({ repositoryId, runType: 'e2e' }),
    repo.listRunningProjectQualityRuns(repositoryId),
  ]);
  return {
    capabilities: detectQualityCapabilities(repository.localPath),
    latestUnitRun,
    latestE2eRun,
    runningRuns,
  };
}

export async function listProjectQualityRuns(repositoryId: string) {
  await requireRepository(repositoryId);
  return repo.listProjectQualityRuns(repositoryId);
}

export async function getProjectQualityRun(repositoryId: string, runId: string) {
  await requireRepository(repositoryId);
  const run = await repo.getProjectQualityRun(runId);
  if (!run) throw new NotFoundError('Project quality run not found');
  if (run.repositoryId !== repositoryId) throw new NotFoundError('Project quality run not found');
  return run;
}

export async function createProjectQualityRun(input: {
  repositoryId: string;
  runType: 'unit' | 'e2e' | 'all';
}) {
  const repository = await requireRepository(input.repositoryId);
  const capabilities = detectQualityCapabilities(repository.localPath);
  const command = commandForQualityRun(capabilities, input.runType);
  const run = await repo.createProjectQualityRun({
    repositoryId: repository.id,
    runType: input.runType,
    command,
  });
  const timeoutSeconds = repository.safetyPolicy?.maxCommandSeconds ?? 600;
  const commandResult = await runShellCommand({
    command,
    cwd: repository.localPath,
    timeoutSeconds,
  });
  const needsCoverage = input.runType === 'unit' || input.runType === 'all';
  const needsE2e = input.runType === 'e2e' || input.runType === 'all';
  const coverage = needsCoverage
    ? readCoverageArtifacts(repository.localPath)
    : { coverageSummary: null, coverageGate: null, error: null };
  const errorMessage = [
    commandResult.timedOut ? `command timed out after ${timeoutSeconds}s` : null,
    coverage.error,
  ]
    .filter(Boolean)
    .join('; ');
  const status = commandResult.exitCode === 0 && !commandResult.timedOut ? 'completed' : 'failed';
  const completed = await repo.completeProjectQualityRun({
    runId: run.id,
    status,
    exitCode: commandResult.exitCode,
    latestOutput: commandResult.output,
    coverageSummary: coverage.coverageSummary,
    coverageGate: coverage.coverageGate,
    e2eSummary: needsE2e ? minimalE2eSummary(commandResult.exitCode) : null,
    errorMessage: errorMessage || null,
  });
  if (!completed) throw new NotFoundError('Project quality run not found');
  return completed;
}

export async function cancelProjectQualityRun(repositoryId: string, runId: string) {
  await requireRepository(repositoryId);
  const run = await repo.getProjectQualityRun(runId);
  if (!run) throw new NotFoundError('Project quality run not found');
  if (run.repositoryId !== repositoryId) throw new NotFoundError('Project quality run not found');
  if (run.status !== 'running' && run.status !== 'queued') return run;
  const cancelled = await repo.completeProjectQualityRun({
    runId,
    status: 'cancelled',
    errorMessage: 'cancelled',
  });
  if (!cancelled) throw new NotFoundError('Project quality run not found');
  return cancelled;
}
