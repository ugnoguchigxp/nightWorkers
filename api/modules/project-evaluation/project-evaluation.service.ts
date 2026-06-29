import type {
  ProjectEvaluationActivityEvent,
  ProjectEvaluationDimensionKey,
  ProjectEvaluationRun,
  ProjectImprovementIdea,
} from '../../../shared/schemas/project-evaluation.schema';
import { NotFoundError, ValidationError } from '../../lib/errors';
import * as nightworkersRepo from '../nightworkers/nightworkers.repository';
import * as repo from './project-evaluation.repository';
import { buildProjectEvaluationBundle } from './project-evaluation-bundle.service';
import {
  generateProjectImprovementIdeas as generateIdeasWithLlm,
  judgeProjectEvaluation,
} from './project-evaluation-judge.service';

type ActivityDraft = Omit<ProjectEvaluationActivityEvent, 'id' | 'evaluationId'>;

function createActivityRecorder() {
  const events: ActivityDraft[] = [];
  return {
    events,
    push(event: Omit<ActivityDraft, 'seq' | 'createdAt'>) {
      events.push({
        ...event,
        seq: events.length,
        createdAt: new Date().toISOString(),
      });
    },
  };
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

export async function runProjectEvaluation(input: {
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

  try {
    const judged = await judgeProjectEvaluation({
      bundle,
      baselinePrompt: input.baselinePrompt,
    });
    activity.push({
      phase: 'save',
      level: 'checkpoint',
      source: 'project-evaluation',
      message: `評価を保存します: ${judged.report.overallScore} / 100。`,
      payload: { selectedModel: judged.selectedModel },
    });
    const evaluation = await repo.createProjectEvaluationRun({
      repositoryId: repository.id,
      bundle,
      report: judged.report,
      rawOutput: judged.rawOutput,
      selectedModel: judged.selectedModel,
      previousEvaluationId: previousEvaluation?.id ?? null,
      activityEvents: activity.events,
    });
    return getProjectEvaluationDetail(evaluation.id);
  } catch (error) {
    activity.push({
      phase: 'judge',
      level: 'error',
      source: 'project-evaluation',
      message: error instanceof Error ? error.message : String(error),
      status: 'failed',
    });
    throw new ValidationError('Project evaluation failed', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
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
  const generated = await generateIdeasWithLlm({
    evaluation,
    bundle: evaluation.bundle,
    dimensionKeys: selectedKeys,
  });
  const ideas = await repo.createProjectImprovementIdeas(evaluation.id, generated.ideas);
  await repo.createProjectEvaluationActivityEvents(evaluation.id, [
    {
      seq: Date.now(),
      phase: 'improvements',
      level: 'checkpoint',
      source: 'project-evaluation',
      message: `${ideas.length} 件の改善案を保存しました。`,
      payload: { selectedKeys, selectedModel: generated.selectedModel },
      createdAt: new Date().toISOString(),
    },
  ]);
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
    await nightworkersRepo.createTaskMessage({
      taskId: task.id,
      role: 'system',
      content: [
        'Project Evaluation 由来の Task です。',
        `evaluationId: ${evaluation.id}`,
        `ideaId: ${idea.id}`,
        `targetDimensions: ${idea.targetDimensions.join(', ')}`,
      ].join('\n'),
      messageType: 'text',
      payloadJson: { source: 'project-evaluation', evaluationId: evaluation.id, ideaId: idea.id },
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
