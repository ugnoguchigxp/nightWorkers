import { NotFoundError } from '../../lib/errors';
import type { RuntimeLaneResult } from '../../services/agent-runtime/shared/contracts';
import { buildReviewResult } from '../../services/review-results/build-review-result';
import { collectDefaultReviewEvidence } from '../../services/review-results/evidence-collector';
import type { ReviewRunRequest } from '../../services/review-results/types';
import { decideRunOutcome } from '../../services/run-control/run-outcome-gate';
import { configureQueueDrainRunner } from '../queue/queue-scheduler-port';
import { createTask } from './nightworkers.basic.service';
import { assertRunnableWorkbenchTask } from './nightworkers.planning-helpers.service';
import * as repo from './nightworkers.repository';
import {
  archiveImplementationQueueEntryForRun,
  completeImplementationQueueEntryForRun,
  runImplementationQueue,
  runSessionQueueForRepository,
  shouldContinueSessionQueue,
  startTaskRun,
} from './nightworkers.run-orchestration.service';

configureQueueDrainRunner(runImplementationQueue);

export {
  generateBlueprintArtifact as generateSpecificationStatusBlueprint,
  getBlueprintArtifactAdoption,
  getBlueprintDesignSettings,
  getBlueprintDesignTokenAdoption,
  saveBlueprintArtifactAdoption,
  saveBlueprintDesignSettings,
  saveBlueprintDesignTokenAdoption,
} from '../blueprint/blueprint.service';
export { generateDataModelArtifact as generateSpecificationStatusDataModel } from '../dataModel/dataModel.service';
export {
  acceptDesignQuestionnaireReview,
  createDesignQuestionnaire,
  generateDesignQuestionnaireFollowUp,
  generateDesignQuestionnaireReview,
  getDesignQuestionnaireSession,
  leaveDesignQuestionnaireReviewUnadopted,
  listDesignQuestionnaires,
  saveDesignQuestionnaireAnswers,
} from '../questionnaire/questionnaire.service';
export {
  generateFeaturePlanArtifact as generateSpecificationStatusDesignDocument,
  getPlanModeWorkspace,
} from '../specification/specification.service';
export {
  getTaskBackgroundProcess,
  listTaskBackgroundProcesses,
  startTaskBackgroundProcess,
  stopTaskBackgroundProcess,
} from './nightworkers.background-process.service';
export type { BlueprintPlanningReadiness } from './nightworkers.basic.service';
export {
  createRepository,
  createTask,
  deleteRepository,
  getOverviewDashboard,
  getRepository,
  getTask,
  getTaskLlmUsageSummary,
  listRepositories,
  listTaskActivityEvents,
  listTaskMessages,
  listTasks,
  resolveBlueprintPlanningReadiness,
  updateRepository,
  updateTask,
} from './nightworkers.basic.service';
export {
  assertRunnableWorkbenchTask,
  buildBlueprintPlanningReadiness,
  isAppBlueprintMessage,
  isBlueprintMessage,
  isBlueprintRouting,
} from './nightworkers.planning-helpers.service';
export type { WorkbenchChatIntent } from './nightworkers.workbench.service';
export {
  appendTaskMessage,
  appendWorkbenchMessage,
  createPlanningArtifactMessageIfNeeded,
} from './nightworkers.workbench.service';

export async function startWorkbenchTaskRun(taskId: string) {
  const task = await repo.getTask(taskId);
  const messages = await repo.listTaskMessages(taskId);
  assertRunnableWorkbenchTask(task, messages);
  return startTaskRun(taskId, {
    executionMode: 'implementation',
    executionModeSource: 'workbench_run',
  });
}

export async function createWorkbenchSession(data: {
  repositoryId: string;
  title?: string;
  description?: string | null;
  objective?: string | null;
  acceptanceCriteria?: string | null;
  timeoutSeconds?: number;
  priority?: number;
  createdBy?: string | null;
}) {
  return createTask({
    repositoryId: data.repositoryId,
    title: data.title?.trim() || 'New Session',
    description: data.description || '',
    objective: data.objective || '',
    acceptanceCriteria: data.acceptanceCriteria || '',
    timeoutSeconds: data.timeoutSeconds,
    priority: data.priority,
    createdBy: data.createdBy,
  });
}

export async function archiveTask(id: string) {
  const task = await repo.getTask(id);
  if (!task) throw new NotFoundError('Task not found');
  if (['completed', 'cancelled', 'failed'].includes(task.status)) return task;
  const archived = await repo.updateTask(id, { status: 'cancelled' });
  if (!archived) throw new NotFoundError('Task not found');
  return archived;
}

export async function deleteTask(id: string) {
  return repo.deleteTask(id);
}

export {
  archiveImplementationQueueEntry,
  createImplementationQueueEntry,
  getTodoWorkflowSettings,
  listImplementationQueueDashboard,
  patchImplementationQueueEntry,
  queueTask,
  requeueImplementationQueueEntry,
  updateImplementationQueueSettings,
  updateTodoWorkflowSettings,
} from './nightworkers.queue-management.service';

// --- Execution Orchestration (Runner Integration) ---
export {
  archiveImplementationQueueEntryForRun,
  completeImplementationQueueEntryForRun,
  runImplementationQueue,
  runSessionQueueForRepository,
  shouldContinueSessionQueue,
  startTaskRun,
  stopTaskRun,
} from './nightworkers.run-orchestration.service';

export {
  getActiveTaskRun,
  getOntologyRunDebugReport,
  getTaskRun,
  getTaskRunsForTask,
  listTaskRunActivityEvents,
  listTaskRunEvents,
  listTaskRunEventsForReplay,
  recoverStaleActiveRuns,
} from './nightworkers.run-query.service';

export async function reviewTaskRun(runId: string, request: ReviewRunRequest) {
  const run = await repo.getTaskRun(runId);
  if (!run) throw new Error('Run not found');
  const events = await repo.listTaskEventsForRun(runId);
  const defaultEvidenceRefs = collectDefaultReviewEvidence(run, events);

  const outcome = decideRunOutcome({
    runtime: {
      finalReport: run.finalReport || '',
      terminalState: toRuntimeTerminalState(run.status),
      summary: run.summary || `Review action: ${request.action}`,
      stoppedBy: 'decision',
      riskLevel: 'medium',
    },
    humanAction: request.action,
  });
  const finalTaskStatus = outcome.status;
  const reviewResult = buildReviewResult({
    run: {
      id: run.id,
      taskId: run.taskId,
      status: run.status,
      summary: run.summary,
    },
    request,
    outcome,
    evidenceRefs: request.evidenceRefs?.length ? request.evidenceRefs : defaultEvidenceRefs,
  });

  await repo.createRunEvent(
    {
      version: 1,
      runId,
      taskId: run.taskId,
      timestamp: new Date().toISOString(),
      type: 'human.review_submitted',
      severity: 'info',
      actor: 'human',
      message: `Human review completed. Action: ${request.action}. Note: ${request.note || 'None'}`,
      data: { action: request.action, reviewResultId: reviewResult.id },
    },
    { payloadJson: { reviewResult } }
  );

  await repo.updateTaskRun(runId, {
    status: outcome.status,
    summary: request.note || outcome.summary,
  });

  await repo.updateTaskStatus(run.taskId, finalTaskStatus);
  await completeImplementationQueueEntryForRun(runId, finalTaskStatus);
  if (finalTaskStatus === 'completed') {
    await archiveImplementationQueueEntryForRun(runId);
  }
  if (shouldContinueSessionQueue(finalTaskStatus)) {
    const reviewedTask = run.repositoryId ? null : await repo.getTask(run.taskId);
    const repositoryId = run.repositoryId || reviewedTask?.repositoryId;
    if (repositoryId) void runSessionQueueForRepository(repositoryId);
  }

  await repo.createRunEvent(
    {
      version: 1,
      runId,
      taskId: run.taskId,
      timestamp: new Date().toISOString(),
      type: 'run.outcome_decided',
      severity: 'info',
      actor: 'human',
      message: `Run outcome decided: ${outcome.status} (${outcome.reason})`,
      data: { ...outcome, reviewResultId: reviewResult.id },
    },
    { legacyPayload: outcome, payloadJson: { reviewResultId: reviewResult.id } }
  );

  return { ok: true, status: finalTaskStatus, outcome, reviewResult };
}

function toRuntimeTerminalState(
  value: string
): Exclude<RuntimeLaneResult['terminalState'], 'cancelled'> {
  const allowed: Array<Exclude<RuntimeLaneResult['terminalState'], 'cancelled'>> = [
    'completed',
    'needs_review',
    'needs_human',
    'failed',
    'timed_out',
    'blocked',
  ];
  return allowed.includes(value as Exclude<RuntimeLaneResult['terminalState'], 'cancelled'>)
    ? (value as Exclude<RuntimeLaneResult['terminalState'], 'cancelled'>)
    : 'needs_review';
}

export {
  browseLocalFolders,
  createLocalFolder,
  createReviewerEvaluation,
  createReviewerReplayEvaluation,
  exportTaskRunJsonl,
  getReviewRubrics,
  listProjectFiles,
  readProjectFile,
  readRepositoryDiff,
} from './nightworkers.review-files.service';

export {
  applyReviewFinalAction,
  createReviewPromptSuggestions,
  getLatestReviewSessionDetailForTask,
  getOrCreateReviewRecommendation,
  getReviewSessionDetail,
  runReviewSection,
  setReviewFindingDisposition,
  startReviewSessionForRun,
  updateReviewPromptSuggestion,
  useReviewPromptSuggestion,
} from './nightworkers.review-mode.service';
