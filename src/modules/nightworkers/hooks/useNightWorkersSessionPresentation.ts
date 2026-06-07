import { useMemo } from 'react';
import type {
  BlueprintSpecificationWorkspace,
  ImplementationQueueDashboard,
  Repository,
  ReviewResult,
  Task,
  TaskEvent,
  TaskMessage,
  TaskRun,
  TaskRunTodo,
} from '../types';
import {
  buildWorkbenchArtifactRefs,
  buildWorkbenchSessionView,
  groupWorkbenchSessions,
} from '../workbenchSelectors';
import type { ProjectSessionGroups } from './nightWorkersWorkspaceState';

function hasSpecificationWorkspaceEvidence(workspace: BlueprintSpecificationWorkspace) {
  return Boolean(
    workspace.blueprintArtifacts.length ||
      workspace.dbDesignArtifacts.length ||
      workspace.questionnaireSessions.length ||
      workspace.decisionReviews.length ||
      workspace.implementationReferences.length
  );
}

function summarizeSpecificationWorkspace(workspace: BlueprintSpecificationWorkspace) {
  return [
    `${workspace.blueprintArtifacts.length} Blueprint`,
    `${workspace.dbDesignArtifacts.length} DB Design`,
    `${workspace.questionnaireSessions.length} Questionnaire`,
    `${workspace.decisionReviews.length} Decision Review`,
    `${workspace.implementationReferences.length} Implementation`,
  ].join(' · ');
}

type UseNightWorkersSessionPresentationInput = {
  activeSession: Task | null;
  activeSpecificationWorkspace: BlueprintSpecificationWorkspace | null;
  implementationQueue: ImplementationQueueDashboard | null;
  latestRun: TaskRun | undefined;
  latestRunEvents: TaskEvent[];
  latestRunReviews: ReviewResult[];
  latestRunTodos: TaskRunTodo[];
  taskMessages: TaskMessage[];
  sessions: Task[];
  projects: Repository[];
};

export function useNightWorkersSessionPresentation({
  activeSession,
  activeSpecificationWorkspace,
  implementationQueue,
  latestRun,
  latestRunEvents,
  latestRunReviews,
  latestRunTodos,
  taskMessages,
  sessions,
  projects,
}: UseNightWorkersSessionPresentationInput) {
  const activeArtifactRefs = useMemo(() => {
    if (!activeSession) return [];
    const refs = buildWorkbenchArtifactRefs({
      task: activeSession,
      latestRun,
      todos: latestRunTodos,
      events: latestRunEvents,
      reviews: latestRunReviews,
      messages: taskMessages,
    });
    if (
      activeSpecificationWorkspace &&
      hasSpecificationWorkspaceEvidence(activeSpecificationWorkspace) &&
      !refs.some((artifact) => artifact.kind === 'blueprint_workspace')
    ) {
      refs.unshift({
        id: `blueprint-workspace-${activeSession.id}`,
        taskId: activeSession.id,
        kind: 'blueprint_workspace',
        title: 'Specification Workspace',
        summary: summarizeSpecificationWorkspace(activeSpecificationWorkspace),
        source: {
          type: 'task_message',
          messageId:
            activeSpecificationWorkspace.decisionReviews[0]?.sourceMessageId ||
            activeSpecificationWorkspace.blueprintArtifacts[0]?.sourceMessageId ||
            activeSpecificationWorkspace.dbDesignArtifacts[0]?.sourceMessageId ||
            activeSpecificationWorkspace.questionnaireSessions[0]?.sourceBlueprintMessageId ||
            activeSpecificationWorkspace.implementationReferences[0]?.sourceMessageId ||
            '',
        },
        createdAt: activeSpecificationWorkspace.generatedAt || String(activeSession.updatedAt),
        metadata: { specificationWorkspace: activeSpecificationWorkspace },
      });
    }
    return refs;
  }, [
    activeSession,
    activeSpecificationWorkspace,
    latestRun,
    latestRunEvents,
    latestRunReviews,
    latestRunTodos,
    taskMessages,
  ]);
  const queueEntryByTaskId = useMemo(() => {
    const map = new Map<string, ImplementationQueueDashboard['queued'][number]>();
    if (!implementationQueue) return map;
    const processorEntries = implementationQueue.processors
      .map((processor) => processor.entry)
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
    for (const entry of [
      ...implementationQueue.queued,
      ...processorEntries,
      ...implementationQueue.completed,
    ]) {
      map.set(entry.taskId, entry);
    }
    return map;
  }, [implementationQueue]);
  const planReadyTaskIds = useMemo(
    () => new Set((implementationQueue?.notQueued || []).map((item) => item.task.id)),
    [implementationQueue]
  );
  const activeSessionView = useMemo(
    () =>
      activeSession
        ? buildWorkbenchSessionView(activeSession, {
            latestRun,
            queueEntry: queueEntryByTaskId.get(activeSession.id),
            planReady: planReadyTaskIds.has(activeSession.id),
            todos: latestRunTodos,
            events: latestRunEvents,
            reviews: latestRunReviews,
            messages: taskMessages,
          })
        : null,
    [
      activeSession,
      latestRun,
      latestRunEvents,
      latestRunReviews,
      latestRunTodos,
      planReadyTaskIds,
      queueEntryByTaskId,
      taskMessages,
    ]
  );
  const sessionViews = useMemo(
    () =>
      sessions.map((session) =>
        session.id === activeSession?.id && activeSessionView
          ? activeSessionView
          : buildWorkbenchSessionView(session, {
              queueEntry: queueEntryByTaskId.get(session.id),
              planReady: planReadyTaskIds.has(session.id),
            })
      ),
    [activeSession?.id, activeSessionView, planReadyTaskIds, queueEntryByTaskId, sessions]
  );
  const groupedSessionViews = useMemo(() => {
    const grouped: Record<string, ProjectSessionGroups> = {};
    for (const project of projects) {
      grouped[project.id] = { processing: [], queue: [], archive: [] };
    }
    for (const session of sessionViews) {
      const repositoryId = session.task.repositoryId;
      grouped[repositoryId] ||= { processing: [], queue: [], archive: [] };
      grouped[repositoryId][session.group].push(session);
    }
    for (const groups of Object.values(grouped)) {
      const sorted = groupWorkbenchSessions([
        ...groups.processing,
        ...groups.queue,
        ...groups.archive,
      ]);
      let queuePosition = 0;
      groups.processing = sorted.processing;
      groups.queue = sorted.queue.map((session) => {
        if (session.emailState !== 'queued') return { ...session, queuePosition: undefined };
        queuePosition += 1;
        return { ...session, queuePosition: session.queueEntry?.queuePosition ?? queuePosition };
      });
      groups.archive = sorted.archive;
    }
    return grouped;
  }, [projects, sessionViews]);
  const activeSessionViewWithQueuePosition = useMemo(() => {
    if (!activeSessionView) return null;
    const groups = groupedSessionViews[activeSessionView.task.repositoryId];
    if (!groups) return activeSessionView;
    return (
      groups.processing.find((session) => session.task.id === activeSessionView.task.id) ||
      groups.queue.find((session) => session.task.id === activeSessionView.task.id) ||
      groups.archive.find((session) => session.task.id === activeSessionView.task.id) ||
      activeSessionView
    );
  }, [activeSessionView, groupedSessionViews]);

  return {
    activeArtifactRefs,
    activeSessionView,
    activeSessionViewWithQueuePosition,
    groupedSessionViews,
    sessionViews,
  };
}
