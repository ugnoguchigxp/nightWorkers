import { AppError, NotFoundError } from '../../lib/errors';
import type { SupervisorRoutingHypothesis } from '../../services/supervisor/skills/types';
import type * as repo from './nightworkers.repository';

type TaskMessageRow = Awaited<ReturnType<typeof repo.listTaskMessages>>[number];

export function buildBlueprintPlanningReadiness(
  source: 'adopted' | 'latest_generated',
  message: TaskMessageRow
): import('./nightworkers.basic.service').BlueprintPlanningReadiness {
  const metadata = message.metadataJson as { appBlueprint?: unknown; mockBlueprint?: unknown };
  const blueprint = metadata.appBlueprint || metadata.mockBlueprint;
  return {
    source,
    diagnostic: source === 'adopted' ? 'adopted_blueprint' : 'using_latest_generated_blueprint',
    messageId: message.id,
    blueprint,
    summary: summarizePlanningBlueprint(source, blueprint),
  };
}

export function summarizePlanningBlueprint(
  source: 'adopted' | 'latest_generated',
  blueprint: unknown
): string {
  const prefix =
    source === 'adopted'
      ? 'Adopted Blueprint artifact is available for task planning.'
      : 'No adopted Blueprint artifact is available; using the latest generated Blueprint.';
  if (!blueprint || typeof blueprint !== 'object' || Array.isArray(blueprint)) return prefix;
  const value = blueprint as {
    id?: unknown;
    name?: unknown;
    screens?: unknown;
    implementationTasks?: unknown;
  };
  const screens = Array.isArray(value.screens) ? value.screens.length : 0;
  const sections = Array.isArray(value.screens)
    ? value.screens.reduce((total, screen) => {
        if (!screen || typeof screen !== 'object' || Array.isArray(screen)) return total;
        const screenSections = (screen as { sections?: unknown }).sections;
        return total + (Array.isArray(screenSections) ? screenSections.length : 0);
      }, 0)
    : 0;
  const implementationTasks = Array.isArray(value.implementationTasks)
    ? value.implementationTasks.length
    : 0;
  return [
    prefix,
    `Blueprint id: ${String(value.id || 'unknown')}`,
    `Blueprint name: ${String(value.name || 'Untitled Blueprint')}`,
    `Screens: ${screens}`,
    `Sections: ${sections}`,
    `Implementation tasks: ${implementationTasks}`,
  ].join('\n');
}

export function isBlueprintRouting(routing: SupervisorRoutingHypothesis | undefined): boolean {
  if (!routing) return false;
  return (
    routing.subtype === 'app_blueprint' ||
    routing.workKinds.includes('blueprint') ||
    routing.nextReferenceFiles.includes('references/work_kinds/blueprint.md')
  );
}

export function assertRunnableWorkbenchTask(
  task: Awaited<ReturnType<typeof repo.getTask>>,
  messages: TaskMessageRow[] = []
) {
  if (!task) throw new NotFoundError('Task not found');
  if (!['queued', 'ready'].includes(task.status))
    throw new AppError(
      409,
      'TASK_NOT_READY_TO_RUN',
      'Workbench runs require a ready or queued task. Draft the task first, then queue or run it.'
    );
  assertTaskDraftComplete(task, messages);
}

export function assertTaskDraftComplete(
  task: Awaited<ReturnType<typeof repo.getTask>>,
  messages: TaskMessageRow[] = []
) {
  if (!task) throw new NotFoundError('Task not found');
  const missing = getTaskDraftMissingFields(task);
  if (missing.length > 0 && hasImplementationPlanEvidence(messages)) return;
  if (missing.length > 0)
    throw new AppError(422, 'TASK_DRAFT_INCOMPLETE', `Missing draft fields: ${missing.join(', ')}`);
}

export function getTaskDraftMissingFields(task: Awaited<ReturnType<typeof repo.getTask>>) {
  if (!task) return ['task'];
  return [
    !task.title?.trim() || task.title === 'New Session' ? 'title' : null,
    !task.objective?.trim() ? 'objective' : null,
    !task.acceptanceCriteria?.trim() ? 'acceptanceCriteria' : null,
  ].filter(Boolean);
}

export function hasImplementationPlanEvidence(messages: TaskMessageRow[]) {
  return messages.some((message) => {
    if (message.messageType !== 'markdown_document') return false;
    const metadata = (message.metadataJson || {}) as { intent?: unknown };
    const intent = String(metadata.intent || '').toLowerCase();
    return intent === 'implementation_plan' || intent === 'feature_plan';
  });
}

export function isAppBlueprintMessage(message: TaskMessageRow): boolean {
  const metadata = message.metadataJson;
  return Boolean(
    metadata &&
      typeof metadata === 'object' &&
      !Array.isArray(metadata) &&
      (metadata as { intent?: unknown; appBlueprint?: unknown }).intent === 'app_blueprint' &&
      (metadata as { appBlueprint?: unknown }).appBlueprint
  );
}

export function isBlueprintMessage(message: TaskMessageRow): boolean {
  const metadata = message.metadataJson;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
  const record = metadata as { intent?: unknown; appBlueprint?: unknown; mockBlueprint?: unknown };
  return Boolean(
    (record.intent === 'app_blueprint' && record.appBlueprint) ||
      (record.intent === 'mock_blueprint' && record.mockBlueprint)
  );
}
