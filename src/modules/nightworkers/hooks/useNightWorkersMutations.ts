import { type QueryClient, useMutation } from '@tanstack/react-query';
import type { Dispatch, SetStateAction } from 'react';
import { client } from '../../../lib/api';
import {
  applyReviewFinalAction,
  archiveWorkbenchSession,
  createReviewKnowledgeCandidate,
  createReviewPromptSuggestions,
  createWorkbenchSession,
  deleteTask,
  markReviewPromptSuggestionUsed,
  patchTask as patchTaskCommand,
  queueWorkbenchSession,
  runReviewSection,
  sendReviewKnowledgeCandidate,
  startReviewSession,
  startWorkbenchRun,
  stopBackgroundProcess,
  stopRun,
  submitRunReview,
  updateReviewFindingDisposition,
  updateReviewKnowledgeCandidate,
  updateReviewPromptSuggestion,
} from '../nightWorkersCommands';
import { mergeRealtimeRunDetails, mergeRealtimeRunList } from '../realtimeEvents';
import type {
  BackgroundProcess,
  CreateProjectInput,
  CreateSessionInput,
  Repository,
  ReviewSessionDetail,
  RunDetails,
  Task,
  TaskRun,
  UpdateProjectInput,
  WorkbenchMovableSessionGroup,
} from '../types';

type TaskPatchInput = {
  title?: string;
  description?: string;
  objective?: string;
  acceptanceCriteria?: string;
  status?: string;
  priority?: number;
};

type ReviewKnowledgeCandidateInput = {
  findingId: string;
  candidateType?: 'rule' | 'procedure' | 'failure_pattern';
  title?: string;
  body?: string;
  avoid?: string | null;
  prefer?: string | null;
};

type ReviewKnowledgeCandidateUpdateInput = {
  candidateType?: 'rule' | 'procedure' | 'failure_pattern';
  title?: string;
  body?: string;
  avoid?: string | null;
  prefer?: string | null;
  status?: 'discarded';
};

type ReviewFindingDispositionInput = {
  disposition:
    | 'human_callout'
    | 'agent_followup'
    | 'prompt_suggestion'
    | 'security_plugin_handoff'
    | 'knowledge_candidate'
    | 'accepted_risk'
    | 'ignored';
  note?: string;
  evidenceRefs?: unknown[];
};

type UseNightWorkersMutationsInput = {
  activeSessionId: string | null;
  queryClient: QueryClient;
  setActiveSessionId: Dispatch<SetStateAction<string | null>>;
};

async function patchTask(sessionId: string, input: TaskPatchInput) {
  const res = await patchTaskCommand(sessionId, input);
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as Task;
}

function resolveNextActiveSessionId(currentId: string | null, sessions: Pick<Task, 'id'>[]) {
  if (currentId && sessions.some((session) => session.id === currentId)) return currentId;
  return sessions[0]?.id ?? null;
}

function buildPriorityUpdates(sessionIds: string[], sessions: Task[]) {
  const currentPriorityById = new Map(sessions.map((session) => [session.id, session.priority]));
  return sessionIds
    .map((sessionId, index) => ({ sessionId, priority: sessionIds.length - index }))
    .filter(({ sessionId, priority }) => currentPriorityById.get(sessionId) !== priority);
}

export function useNightWorkersMutations({
  activeSessionId,
  queryClient,
  setActiveSessionId,
}: UseNightWorkersMutationsInput) {
  const createProjectMutation = useMutation({
    mutationFn: async (data: CreateProjectInput) => {
      const res = await client.repositories.$post({
        json: { ...data, branch: data.branch || 'main' },
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  });

  const deleteProjectMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await client.repositories[':id'].$delete({ param: { id } });
      if (!res.ok) throw new Error('Failed to delete project');
      return res.json();
    },
    onSuccess: () => {
      setActiveSessionId(null);
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });

  const updateProjectMutation = useMutation({
    mutationFn: async (input: { id: string; data: UpdateProjectInput }) => {
      const res = await client.repositories[':id'].$patch({
        param: { id: input.id },
        json: input.data,
      });
      if (!res.ok) throw new Error(await res.text());
      return (await res.json()) as Repository;
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ['projects'] });
      const previous = queryClient.getQueryData<Repository[]>(['projects']);
      queryClient.setQueryData<Repository[]>(['projects'], (prev = []) =>
        prev.map((project) => (project.id === input.id ? { ...project, ...input.data } : project))
      );
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(['projects'], context.previous);
    },
    onSuccess: (project) => {
      queryClient.setQueryData<Repository[]>(['projects'], (prev = []) =>
        prev.map((candidate) => (candidate.id === project.id ? project : candidate))
      );
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  });

  const createSessionMutation = useMutation({
    mutationFn: async (data: CreateSessionInput) => {
      const res = await createWorkbenchSession(data);
      if (!res.ok) throw new Error('Failed to create session');
      return (await res.json()) as Task;
    },
    onSuccess: (newSession) => {
      setActiveSessionId(newSession.id);
      queryClient.setQueryData<Task[]>(['sessions'], (prev = []) => {
        const next = [...prev];
        const idx = next.findIndex((session) => session.id === newSession.id);
        if (idx >= 0) next[idx] = newSession;
        else next.unshift(newSession);
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });

  const deleteSessionMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await deleteTask(id);
      if (!res.ok) throw new Error('Failed to delete session');
      return res.json();
    },
    onSuccess: (_, deletedId) => {
      const remainingSessions = (queryClient.getQueryData<Task[]>(['sessions']) ?? []).filter(
        (session) => session.id !== deletedId
      );
      queryClient.setQueryData<Task[]>(['sessions'], remainingSessions);
      setActiveSessionId((currentId) => resolveNextActiveSessionId(currentId, remainingSessions));
      queryClient.removeQueries({ queryKey: ['sessionRuns', deletedId] });
      queryClient.removeQueries({ queryKey: ['taskMessages', deletedId] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({ queryKey: ['sessionRuns'] });
      queryClient.invalidateQueries({ queryKey: ['taskMessages'] });
    },
  });

  const startRunMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      const res = await startWorkbenchRun(sessionId);
      if (!res.ok) throw new Error('Failed to start run');
      return (await res.json()) as TaskRun;
    },
    onSuccess: (run) => {
      queryClient.setQueryData<TaskRun[]>(['sessionRuns', run.taskId], (prev = []) => {
        return mergeRealtimeRunList(prev, run);
      });
      queryClient.setQueryData<RunDetails | null>(['runDetails', run.id], (prev) => {
        return mergeRealtimeRunDetails(prev, run) ?? prev;
      });
      queryClient.setQueryData<Task[]>(['sessions'], (prev = []) =>
        prev.map((session) =>
          session.id === run.taskId ? { ...session, status: 'running' } : session
        )
      );
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({ queryKey: ['sessionRuns', run.taskId] });
    },
  });

  const stopRunMutation = useMutation({
    mutationFn: async (runId: string) => {
      const res = await stopRun(runId);
      if (!res.ok) throw new Error(await res.text());
      return (await res.json()) as TaskRun;
    },
    onSuccess: (run) => {
      queryClient.setQueryData<TaskRun[]>(['sessionRuns', run.taskId], (prev = []) => {
        const next = [...prev];
        const idx = next.findIndex((candidate) => candidate.id === run.id);
        if (idx >= 0) next[idx] = run;
        else next.unshift(run);
        return next;
      });
      queryClient.setQueryData<Task[]>(['sessions'], (prev = []) =>
        prev.map((session) =>
          session.id === run.taskId ? { ...session, status: 'ready' } : session
        )
      );
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({ queryKey: ['implementationQueue'] });
      queryClient.invalidateQueries({ queryKey: ['sessionRuns', run.taskId] });
      queryClient.invalidateQueries({ queryKey: ['runDetails', run.id] });
    },
  });

  const stopBackgroundProcessMutation = useMutation({
    mutationFn: async (processId: string) => {
      const res = await stopBackgroundProcess(processId);
      if (!res.ok) throw new Error(await res.text());
      return (await res.json()) as BackgroundProcess;
    },
    onSuccess: (processRecord) => {
      queryClient.setQueryData<BackgroundProcess[]>(
        ['backgroundProcesses', activeSessionId],
        (prev = []) =>
          prev.map((candidate) => (candidate.id === processRecord.id ? processRecord : candidate))
      );
      queryClient.invalidateQueries({ queryKey: ['backgroundProcesses'] });
      if (processRecord.taskId) {
        queryClient.invalidateQueries({ queryKey: ['activityReplay', processRecord.taskId] });
      }
    },
  });

  const queueSessionMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      const res = await queueWorkbenchSession(sessionId);
      if (!res.ok) throw new Error(await res.text());
      return (await res.json()) as Task;
    },
    onSuccess: (task) => {
      queryClient.setQueryData<Task[]>(['sessions'], (prev = []) => {
        const next = [...prev];
        const idx = next.findIndex((candidate) => candidate.id === task.id);
        if (idx >= 0) next[idx] = task;
        else next.unshift(task);
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });

  const submitRunReviewMutation = useMutation({
    mutationFn: async (input: {
      runId: string;
      data: { action: 'complete' | 'cancel'; note?: string };
    }) => {
      const res = await submitRunReview(input.runId, input.data);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: (_result, input) => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({ queryKey: ['implementationQueue'] });
      queryClient.invalidateQueries({ queryKey: ['sessionRuns'] });
      queryClient.invalidateQueries({ queryKey: ['runDetails', input.runId] });
      if (activeSessionId) {
        queryClient.invalidateQueries({ queryKey: ['sessionRuns', activeSessionId] });
      }
    },
  });

  const startReviewSessionMutation = useMutation({
    mutationFn: async (runId: string) => {
      const res = await startReviewSession(runId);
      if (!res.ok) throw new Error(await res.text());
      return (await res.json()) as ReviewSessionDetail;
    },
    onSuccess: (detail) => {
      queryClient.setQueryData<ReviewSessionDetail | null>(
        ['reviewSession', detail.session.taskId],
        detail
      );
      queryClient.invalidateQueries({ queryKey: ['reviewSession', detail.session.taskId] });
      queryClient.invalidateQueries({ queryKey: ['runDetails', detail.session.runId] });
    },
  });

  const runReviewSectionMutation = useMutation({
    mutationFn: async (input: { reviewSessionId: string; section: string }) => {
      const res = await runReviewSection(input.reviewSessionId, input.section);
      if (!res.ok) throw new Error(await res.text());
      return (await res.json()) as ReviewSessionDetail;
    },
    onSuccess: (detail) => {
      queryClient.setQueryData<ReviewSessionDetail | null>(
        ['reviewSession', detail.session.taskId],
        detail
      );
      queryClient.invalidateQueries({ queryKey: ['reviewSession', detail.session.taskId] });
    },
  });

  const updateReviewFindingDispositionMutation = useMutation({
    mutationFn: async (input: {
      reviewSessionId: string;
      findingId: string;
      data: ReviewFindingDispositionInput;
    }) => {
      const res = await updateReviewFindingDisposition(
        input.reviewSessionId,
        input.findingId,
        input.data
      );
      if (!res.ok) throw new Error(await res.text());
      return (await res.json()) as ReviewSessionDetail;
    },
    onSuccess: (detail) => {
      queryClient.setQueryData<ReviewSessionDetail | null>(
        ['reviewSession', detail.session.taskId],
        detail
      );
      queryClient.invalidateQueries({ queryKey: ['reviewSession', detail.session.taskId] });
    },
  });

  const createReviewPromptSuggestionsMutation = useMutation({
    mutationFn: async (reviewSessionId: string) => {
      const res = await createReviewPromptSuggestions(reviewSessionId);
      if (!res.ok) throw new Error(await res.text());
      return (await res.json()) as ReviewSessionDetail;
    },
    onSuccess: (detail) => {
      queryClient.setQueryData<ReviewSessionDetail | null>(
        ['reviewSession', detail.session.taskId],
        detail
      );
      queryClient.invalidateQueries({ queryKey: ['reviewSession', detail.session.taskId] });
    },
  });

  const updateReviewPromptSuggestionMutation = useMutation({
    mutationFn: async (input: {
      reviewSessionId: string;
      suggestionId: string;
      data: { status: 'dismissed' };
    }) => {
      const res = await updateReviewPromptSuggestion(
        input.reviewSessionId,
        input.suggestionId,
        input.data
      );
      if (!res.ok) throw new Error(await res.text());
      return (await res.json()) as ReviewSessionDetail;
    },
    onSuccess: (detail) => {
      queryClient.setQueryData<ReviewSessionDetail | null>(
        ['reviewSession', detail.session.taskId],
        detail
      );
      queryClient.invalidateQueries({ queryKey: ['reviewSession', detail.session.taskId] });
    },
  });

  const markReviewPromptSuggestionUsedMutation = useMutation({
    mutationFn: async (input: { reviewSessionId: string; suggestionId: string }) => {
      const res = await markReviewPromptSuggestionUsed(input.reviewSessionId, input.suggestionId);
      if (!res.ok) throw new Error(await res.text());
      return (await res.json()) as ReviewSessionDetail;
    },
    onSuccess: (detail) => {
      queryClient.setQueryData<ReviewSessionDetail | null>(
        ['reviewSession', detail.session.taskId],
        detail
      );
      queryClient.invalidateQueries({ queryKey: ['reviewSession', detail.session.taskId] });
    },
  });

  const createReviewKnowledgeCandidateMutation = useMutation({
    mutationFn: async (input: { reviewSessionId: string; data: ReviewKnowledgeCandidateInput }) => {
      const res = await createReviewKnowledgeCandidate(input.reviewSessionId, input.data);
      if (!res.ok) throw new Error(await res.text());
      return (await res.json()) as ReviewSessionDetail;
    },
    onSuccess: (detail) => {
      queryClient.setQueryData<ReviewSessionDetail | null>(
        ['reviewSession', detail.session.taskId],
        detail
      );
      queryClient.invalidateQueries({ queryKey: ['reviewSession', detail.session.taskId] });
    },
  });

  const updateReviewKnowledgeCandidateMutation = useMutation({
    mutationFn: async (input: {
      reviewSessionId: string;
      candidateId: string;
      data: ReviewKnowledgeCandidateUpdateInput;
    }) => {
      const res = await updateReviewKnowledgeCandidate(
        input.reviewSessionId,
        input.candidateId,
        input.data
      );
      if (!res.ok) throw new Error(await res.text());
      return (await res.json()) as ReviewSessionDetail;
    },
    onSuccess: (detail) => {
      queryClient.setQueryData<ReviewSessionDetail | null>(
        ['reviewSession', detail.session.taskId],
        detail
      );
      queryClient.invalidateQueries({ queryKey: ['reviewSession', detail.session.taskId] });
    },
  });

  const sendReviewKnowledgeCandidateMutation = useMutation({
    mutationFn: async (input: { reviewSessionId: string; candidateId: string }) => {
      const res = await sendReviewKnowledgeCandidate(input.reviewSessionId, input.candidateId);
      if (!res.ok) throw new Error(await res.text());
      return (await res.json()) as ReviewSessionDetail;
    },
    onSuccess: (detail) => {
      queryClient.setQueryData<ReviewSessionDetail | null>(
        ['reviewSession', detail.session.taskId],
        detail
      );
      queryClient.invalidateQueries({ queryKey: ['reviewSession', detail.session.taskId] });
    },
  });

  const applyReviewFinalActionMutation = useMutation({
    mutationFn: async (input: {
      reviewSessionId: string;
      data: {
        action: 'approve' | 'request_changes' | 'needs_human' | 'exit_review';
        note?: string;
      };
    }) => {
      const res = await applyReviewFinalAction(input.reviewSessionId, input.data);
      if (!res.ok) throw new Error(await res.text());
      return (await res.json()) as ReviewSessionDetail;
    },
    onSuccess: (detail) => {
      queryClient.setQueryData<ReviewSessionDetail | null>(
        ['reviewSession', detail.session.taskId],
        detail
      );
      queryClient.invalidateQueries({ queryKey: ['reviewSession', detail.session.taskId] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });

  const updateSessionStatusMutation = useMutation({
    mutationFn: async (input: { sessionId: string; status: 'draft' | 'ready' }) => {
      return patchTask(input.sessionId, { status: input.status });
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ['sessions'] });
      const previous = queryClient.getQueryData<Task[]>(['sessions']);
      queryClient.setQueryData<Task[]>(['sessions'], (prev = []) =>
        prev.map((session) =>
          session.id === input.sessionId ? { ...session, status: input.status } : session
        )
      );
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(['sessions'], context.previous);
    },
    onSuccess: (task) => {
      queryClient.setQueryData<Task[]>(['sessions'], (prev = []) => {
        const next = [...prev];
        const idx = next.findIndex((candidate) => candidate.id === task.id);
        if (idx >= 0) next[idx] = task;
        else next.unshift(task);
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });

  const reorderQueueSessionsMutation = useMutation({
    mutationFn: async (sessionIds: string[]) => {
      const updates = buildPriorityUpdates(
        sessionIds,
        queryClient.getQueryData<Task[]>(['sessions']) ?? []
      );
      const tasks = await Promise.all(
        updates.map(async ({ sessionId, priority }) => {
          return patchTask(sessionId, { priority });
        })
      );
      return tasks;
    },
    onMutate: async (sessionIds) => {
      await queryClient.cancelQueries({ queryKey: ['sessions'] });
      const previous = queryClient.getQueryData<Task[]>(['sessions']);
      const priorityById = new Map(sessionIds.map((id, index) => [id, sessionIds.length - index]));
      queryClient.setQueryData<Task[]>(['sessions'], (prev = []) =>
        prev.map((session) =>
          priorityById.has(session.id)
            ? { ...session, priority: priorityById.get(session.id) as number }
            : session
        )
      );
      return { previous };
    },
    onError: (_error, _sessionIds, context) => {
      if (context?.previous) queryClient.setQueryData(['sessions'], context.previous);
    },
    onSuccess: (tasks) => {
      queryClient.setQueryData<Task[]>(['sessions'], (prev = []) => {
        const taskById = new Map(tasks.map((task) => [task.id, task]));
        return prev.map((session) => taskById.get(session.id) || session);
      });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['sessions'] }),
  });

  const moveWorkbenchSessionMutation = useMutation({
    mutationFn: async (input: {
      sessionId: string;
      sourceGroup: WorkbenchMovableSessionGroup;
      targetGroup: WorkbenchMovableSessionGroup;
      processingIds: string[];
      queueIds: string[];
      archiveIds: string[];
    }) => {
      if (input.sourceGroup === 'queue' && input.targetGroup === 'processing') {
        await patchTask(input.sessionId, { status: 'draft' });
      } else if (input.sourceGroup === 'processing' && input.targetGroup === 'queue') {
        const res = await queueWorkbenchSession(input.sessionId);
        if (!res.ok) throw new Error(await res.text());
      } else if (input.targetGroup === 'archive') {
        const res = await archiveWorkbenchSession(input.sessionId);
        if (!res.ok) throw new Error(await res.text());
      }

      const rankedIds = [...input.processingIds, ...input.queueIds];
      const updates = buildPriorityUpdates(
        rankedIds,
        queryClient.getQueryData<Task[]>(['sessions']) ?? []
      );
      await Promise.all(
        updates.map(async ({ sessionId, priority }) => {
          await patchTask(sessionId, { priority });
        })
      );
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ['sessions'] });
      const previous = queryClient.getQueryData<Task[]>(['sessions']);
      const rankedIds = [...input.processingIds, ...input.queueIds];
      const priorityById = new Map(rankedIds.map((id, index) => [id, rankedIds.length - index]));
      queryClient.setQueryData<Task[]>(['sessions'], (prev = []) =>
        prev.map((session) => {
          const priority = priorityById.get(session.id);
          if (session.id === input.sessionId && input.targetGroup === 'queue') {
            return { ...session, status: 'queued', priority: priority ?? session.priority };
          }
          if (session.id === input.sessionId && input.targetGroup === 'processing') {
            return { ...session, status: 'draft', priority: priority ?? session.priority };
          }
          if (session.id === input.sessionId && input.targetGroup === 'archive') {
            return { ...session, status: 'cancelled', priority: priority ?? session.priority };
          }
          if (priority !== undefined) return { ...session, priority };
          return session;
        })
      );
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(['sessions'], context.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({ queryKey: ['sessionRuns'] });
      queryClient.invalidateQueries({ queryKey: ['runDetails'] });
    },
  });

  return {
    createProjectMutation,
    deleteProjectMutation,
    updateProjectMutation,
    createSessionMutation,
    deleteSessionMutation,
    startRunMutation,
    stopRunMutation,
    stopBackgroundProcessMutation,
    queueSessionMutation,
    submitRunReviewMutation,
    updateSessionStatusMutation,
    reorderQueueSessionsMutation,
    moveWorkbenchSessionMutation,
    startReviewSessionMutation,
    runReviewSectionMutation,
    updateReviewFindingDispositionMutation,
    createReviewPromptSuggestionsMutation,
    updateReviewPromptSuggestionMutation,
    markReviewPromptSuggestionUsedMutation,
    createReviewKnowledgeCandidateMutation,
    updateReviewKnowledgeCandidateMutation,
    sendReviewKnowledgeCandidateMutation,
    applyReviewFinalActionMutation,
  };
}
