import type {
  ProjectEvaluationActivityEvent,
  ProjectEvaluationDimensionKey,
  ProjectEvaluationRun,
  ProjectImprovementIdea,
} from '../../../shared/schemas/project-evaluation.schema';
import { NotFoundError, ValidationError } from '../../lib/errors';
import type { SupervisorLlmDebugEvent } from '../../services/structured-llm';
import * as nightworkersRepo from '../nightworkers/nightworkers.repository';
import * as repo from './project-evaluation.repository';
import { buildProjectEvaluationBundle } from './project-evaluation-bundle.service';
import {
  generateProjectImprovementIdeas as generateIdeasWithLlm,
  judgeProjectEvaluation,
} from './project-evaluation-judge.service';

type ActivityDraft = Omit<ProjectEvaluationActivityEvent, 'id' | 'evaluationId'>;

function createActivityRecorder(startSeq = 0) {
  const events: ActivityDraft[] = [];
  return {
    events,
    push(event: Omit<ActivityDraft, 'seq' | 'createdAt'>) {
      events.push({
        ...event,
        seq: startSeq + events.length,
        createdAt: new Date().toISOString(),
      });
    },
  };
}

function createActivityAppender(input: { evaluationId: string; startSeq?: number }) {
  let seq = input.startSeq ?? 0;
  return {
    async push(event: Omit<ActivityDraft, 'seq' | 'createdAt'>) {
      await repo.createProjectEvaluationActivityEvents(input.evaluationId, [
        {
          ...event,
          seq,
          createdAt: new Date().toISOString(),
        },
      ]);
      seq += 1;
    },
  };
}

function activityLevelFromLlmEvent(
  event: SupervisorLlmDebugEvent
): ProjectEvaluationActivityEvent['level'] {
  if (event.severity === 'error') return 'error';
  if (event.severity === 'warning') return 'warning';
  if (event.type === 'model.response_finished' || event.type === 'model.response_repaired') {
    return 'checkpoint';
  }
  return event.severity;
}

function activityStatusFromLlmEvent(event: SupervisorLlmDebugEvent) {
  if (event.type === 'model.request_started') return 'running';
  if (event.type === 'model.response_finished') return 'completed';
  if (event.severity === 'error') return 'failed';
  return event.type;
}

function summarizeLlmEventData(data: SupervisorLlmDebugEvent['data']) {
  if (!data) return undefined;
  const { rawContent: _rawContent, ...safeData } = data;
  return safeData;
}

function recordLlmActivity(
  activity: Pick<ReturnType<typeof createActivityRecorder>, 'push'>,
  event: SupervisorLlmDebugEvent
) {
  return activity.push({
    phase: 'llm',
    level: activityLevelFromLlmEvent(event),
    source: 'structured-llm',
    message: event.message,
    status: activityStatusFromLlmEvent(event),
    payload: {
      type: event.type,
      data: summarizeLlmEventData(event.data),
    },
  });
}

export async function listProjectEvaluations(repositoryId: string) {
  const repository = await nightworkersRepo.getRepository(repositoryId);
  if (!repository) throw new NotFoundError('Repository not found');
  return repo.listProjectEvaluations(repositoryId);
}

export async function getLatestProjectEvaluation(repositoryId: string) {
  const repository = await nightworkersRepo.getRepository(repositoryId);
  if (!repository) throw new NotFoundError('Repository not found');
  return repo.getLatestProjectEvaluation(repositoryId);
}

export async function getProjectEvaluationDetail(evaluationId: string) {
  const evaluation = await repo.getProjectEvaluation(evaluationId);
  if (!evaluation) throw new NotFoundError('Evaluation not found');
  const [improvements, activityEvents, taskLinks] = await Promise.all([
    repo.listProjectImprovementIdeas(evaluationId),
    repo.listProjectEvaluationActivityEvents(evaluationId),
    repo.listProjectEvaluationTaskLinks(evaluationId),
  ]);
  return { evaluation, improvements, activityEvents, taskLinks };
}

export async function listProjectEvaluationActivityEvents(input: {
  evaluationId: string;
  afterSeq?: number;
}) {
  const evaluation = await repo.getProjectEvaluation(input.evaluationId);
  if (!evaluation) throw new NotFoundError('Evaluation not found');
  return {
    status: evaluation.status,
    events: await repo.listProjectEvaluationActivityEvents(input.evaluationId, {
      afterSeq: input.afterSeq,
    }),
  };
}

async function prepareProjectEvaluationRun(input: {
  repositoryId: string;
  baselinePrompt?: string;
}) {
  const repository = await nightworkersRepo.getRepository(input.repositoryId);
  if (!repository) throw new NotFoundError('Repository not found');
  const activity = createActivityRecorder();
  activity.push({
    phase: 'history',
    level: 'info',
    source: 'project-evaluation',
    message: '前回評価を読み込みます。',
  });
  const previousEvaluation = await repo.getLatestProjectEvaluation(repository.id);
  activity.push({
    phase: 'bundle',
    level: 'info',
    source: 'project-evaluation',
    message: 'repository bundle を作成します。',
  });
  const bundle = await buildProjectEvaluationBundle({ repository, previousEvaluation });
  activity.push({
    phase: 'judge',
    level: 'info',
    source: 'project-evaluation',
    message: 'evaluation role で評価 JSON を生成します。',
    payload: { evidenceLevel: bundle.evidenceLevel },
  });
  return { repository, previousEvaluation, bundle, initialActivityEvents: activity.events };
}

async function completeProjectEvaluation(input: {
  evaluationId: string;
  bundle: Awaited<ReturnType<typeof prepareProjectEvaluationRun>>['bundle'];
  baselinePrompt?: string;
  startSeq: number;
}) {
  const activity = createActivityAppender({
    evaluationId: input.evaluationId,
    startSeq: input.startSeq,
  });
  try {
    const judged = await judgeProjectEvaluation({
      bundle: input.bundle,
      baselinePrompt: input.baselinePrompt,
      onLlmEvent: (event) => recordLlmActivity(activity, event),
    });
    await activity.push({
      phase: 'save',
      level: 'checkpoint',
      source: 'project-evaluation',
      message: `評価を保存します: ${judged.report.overallScore} / 100。`,
      payload: { selectedModel: judged.selectedModel },
    });
    await repo.completeProjectEvaluationRun({
      evaluationId: input.evaluationId,
      report: judged.report,
      rawOutput: judged.rawOutput,
      selectedModel: judged.selectedModel,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await activity.push({
      phase: 'judge',
      level: 'error',
      source: 'project-evaluation',
      message,
      status: 'failed',
    });
    await repo.failProjectEvaluationRun({
      evaluationId: input.evaluationId,
      message,
    });
    throw error;
  }
}

function runProjectEvaluationInBackground(input: {
  evaluationId: string;
  bundle: Awaited<ReturnType<typeof prepareProjectEvaluationRun>>['bundle'];
  baselinePrompt?: string;
  startSeq: number;
}) {
  void completeProjectEvaluation(input).catch(() => {
    // The failure is persisted as an activity event and failed run status.
  });
}

export async function runProjectEvaluation(input: {
  repositoryId: string;
  baselinePrompt?: string;
}) {
  const prepared = await prepareProjectEvaluationRun(input);
  const evaluation = await repo.createRunningProjectEvaluationRun({
    repositoryId: prepared.repository.id,
    bundle: prepared.bundle,
    previousEvaluationId: prepared.previousEvaluation?.id ?? null,
    activityEvents: prepared.initialActivityEvents,
  });

  try {
    await completeProjectEvaluation({
      evaluationId: evaluation.id,
      bundle: prepared.bundle,
      baselinePrompt: input.baselinePrompt,
      startSeq: prepared.initialActivityEvents.length,
    });
    return getProjectEvaluationDetail(evaluation.id);
  } catch (error) {
    throw new ValidationError('Project evaluation failed', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function startProjectEvaluation(input: {
  repositoryId: string;
  baselinePrompt?: string;
}) {
  const prepared = await prepareProjectEvaluationRun(input);
  const evaluation = await repo.createRunningProjectEvaluationRun({
    repositoryId: prepared.repository.id,
    bundle: prepared.bundle,
    previousEvaluationId: prepared.previousEvaluation?.id ?? null,
    activityEvents: prepared.initialActivityEvents,
  });
  runProjectEvaluationInBackground({
    evaluationId: evaluation.id,
    bundle: prepared.bundle,
    baselinePrompt: input.baselinePrompt,
    startSeq: prepared.initialActivityEvents.length,
  });
  return {
    evaluationId: evaluation.id,
    detail: await getProjectEvaluationDetail(evaluation.id),
  };
}

export async function generateProjectImprovements(input: {
  evaluationId: string;
  dimensionKeys: ProjectEvaluationDimensionKey[];
}) {
  const evaluation = await repo.getProjectEvaluation(input.evaluationId);
  if (!evaluation) throw new NotFoundError('Evaluation not found');
  const availableKeys = new Set(evaluation.dimensions.map((dimension) => dimension.key));
  const selectedKeys = [...new Set(input.dimensionKeys)].filter((key) => availableKeys.has(key));
  if (selectedKeys.length === 0) {
    throw new ValidationError('Select at least one dimension from the saved evaluation');
  }
  const activity = createActivityRecorder(Date.now());
  const generated = await generateIdeasWithLlm({
    evaluation,
    bundle: evaluation.bundle,
    dimensionKeys: selectedKeys,
    onLlmEvent: (event) => recordLlmActivity(activity, event),
  });
  const ideas = await repo.createProjectImprovementIdeas(evaluation.id, generated.ideas);
  activity.push({
    phase: 'improvements',
    level: 'checkpoint',
    source: 'project-evaluation',
    message: `${ideas.length} 件の改善案を保存しました。`,
    payload: { selectedKeys, selectedModel: generated.selectedModel },
  });
  await repo.createProjectEvaluationActivityEvents(evaluation.id, activity.events);
  return {
    ideas,
    selectedDimensionKeys: selectedKeys,
  };
}

export async function listProjectImprovements(evaluationId: string) {
  const evaluation = await repo.getProjectEvaluation(evaluationId);
  if (!evaluation) throw new NotFoundError('Evaluation not found');
  return { ideas: await repo.listProjectImprovementIdeas(evaluationId) };
}

function buildTaskDescription(evaluation: ProjectEvaluationRun, idea: ProjectImprovementIdea) {
  const impacts = idea.scoreImpacts
    .map(
      (impact) =>
        `- ${impact.dimensionKey}: +${impact.expectedScoreGain} (${impact.currentScore} -> ${impact.expectedScoreAfter})`
    )
    .join('\n');
  return [
    idea.summary,
    '',
    `Source evaluation: ${evaluation.id}`,
    `Target dimensions: ${idea.targetDimensions.join(', ')}`,
    impacts ? `Expected score impact:\n${impacts}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

function buildAcceptanceCriteria(idea: ProjectImprovementIdea) {
  return [
    idea.expectedOutcome,
    ...idea.implementationFocus.map((focus) => `実装焦点: ${focus}`),
    'repo-native verify が成功している、または失敗理由が記録されている。',
  ].join('\n');
}

export async function createTasksFromProjectImprovements(input: {
  evaluationId: string;
  ideaIds: string[];
  mode: 'draft' | 'ready';
}) {
  const evaluation = await repo.getProjectEvaluation(input.evaluationId);
  if (!evaluation) throw new NotFoundError('Evaluation not found');
  const uniqueIdeaIds = [...new Set(input.ideaIds)];
  const ideas = await repo.getProjectImprovementIdeasByIds(evaluation.id, uniqueIdeaIds);
  if (ideas.length !== uniqueIdeaIds.length) {
    throw new ValidationError('Some improvement ideas were not found for this evaluation');
  }
  const existing = await repo.existingTaskLinksForIdeas(evaluation.id, uniqueIdeaIds);
  if (existing.length > 0) {
    throw new ValidationError('Some improvement ideas already have linked tasks');
  }

  const created = [];
  for (let index = 0; index < ideas.length; index += 1) {
    const idea = ideas[index];
    if (!idea.id) continue;
    const maxGain = Math.max(0, ...idea.scoreImpacts.map((impact) => impact.expectedScoreGain));
    const task = await nightworkersRepo.createTask({
      repositoryId: evaluation.repositoryId,
      title: idea.title,
      description: buildTaskDescription(evaluation, idea),
      objective: idea.agentPrompt,
      acceptanceCriteria: buildAcceptanceCriteria(idea),
      status: input.mode,
      priority: maxGain * 10 + (ideas.length - index),
      createdBy: 'project-evaluation',
    });
    await repo.createProjectEvaluationTaskLink({
      evaluationId: evaluation.id,
      ideaId: idea.id,
      taskId: task.id,
    });
    created.push(task);
  }

  await repo.createProjectEvaluationActivityEvents(evaluation.id, [
    {
      seq: Date.now(),
      phase: 'tasks',
      level: 'checkpoint',
      source: 'project-evaluation',
      message: `${created.length} 件の Task を作成しました。`,
      payload: { taskIds: created.map((task) => task.id) },
      createdAt: new Date().toISOString(),
    },
  ]);

  return {
    tasks: created,
    taskLinks: await repo.listProjectEvaluationTaskLinks(evaluation.id),
  };
}
