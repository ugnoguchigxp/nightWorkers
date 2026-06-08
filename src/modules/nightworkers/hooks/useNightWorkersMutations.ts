import { type QueryClient, useMutation } from '@tanstack/react-query';
import type { Dispatch, SetStateAction } from 'react';
import { client } from '../../../lib/api';
import { apiFetch } from '../../../lib/api-base';
import type {
  CreateProjectInput,
  CreateSessionInput,
  Repository,
  Task,
  TaskRun,
  TodoWorkflowSettings,
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

type UseNightWorkersMutationsInput = {
  activeSessionId: string | null;
  queryClient: QueryClient;
  setActiveSessionId: Dispatch<SetStateAction<string | null>>;
};

async function patchTask(sessionId: string, input: TaskPatchInput) {
  const res = await apiFetch(`/api/tasks/${sessionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
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
      const res = await apiFetch('/api/workbench/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
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
      const res = await apiFetch(`/api/tasks/${id}`, { method: 'DELETE' });
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
      const res = await apiFetch(`/api/workbench/sessions/${sessionId}/run`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to start run');
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
          session.id === run.taskId ? { ...session, status: 'running' } : session
        )
      );
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({ queryKey: ['sessionRuns', run.taskId] });
    },
  });

  const stopRunMutation = useMutation({
    mutationFn: async (runId: string) => {
      const res = await apiFetch(`/api/runs/${runId}/stop`, { method: 'POST' });
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

  const queueSessionMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      const res = await apiFetch(`/api/workbench/sessions/${sessionId}/queue`, { method: 'POST' });
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

  const createImplementationQueueEntryMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      const res = await apiFetch('/api/implementation-queue/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: sessionId }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['implementationQueue'] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });

  const archiveImplementationQueueEntryMutation = useMutation({
    mutationFn: async (entryId: string) => {
      const res = await apiFetch(`/api/implementation-queue/entries/${entryId}/archive`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['implementationQueue'] });
    },
  });

  const removeImplementationQueueEntryMutation = useMutation({
    mutationFn: async (entryId: string) => {
      const cancelRes = await apiFetch(`/api/implementation-queue/entries/${entryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' }),
      });
      if (!cancelRes.ok) throw new Error(await cancelRes.text());
      const archiveRes = await apiFetch(`/api/implementation-queue/entries/${entryId}/archive`, {
        method: 'POST',
      });
      if (!archiveRes.ok) throw new Error(await archiveRes.text());
      return archiveRes.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['implementationQueue'] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });

  const submitRunReviewMutation = useMutation({
    mutationFn: async (input: {
      runId: string;
      data: { action: 'complete' | 'cancel'; note?: string };
    }) => {
      const res = await apiFetch(`/api/runs/${input.runId}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input.data),
      });
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

  const requeueImplementationQueueEntryMutation = useMutation({
    mutationFn: async (input: { entryId: string; note?: string }) => {
      const res = await apiFetch(`/api/implementation-queue/entries/${input.entryId}/requeue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: input.note }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({ queryKey: ['implementationQueue'] });
      queryClient.invalidateQueries({ queryKey: ['sessionRuns'] });
      if (activeSessionId) {
        queryClient.invalidateQueries({ queryKey: ['sessionRuns', activeSessionId] });
      }
    },
  });

  const updateImplementationQueueProcessorCountMutation = useMutation({
    mutationFn: async (processorCount: number) => {
      const res = await apiFetch('/api/implementation-queue/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ processorCount }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['implementationQueue'] });
    },
  });

  const updateTodoWorkflowSettingsMutation = useMutation({
    mutationFn: async (input: Partial<TodoWorkflowSettings>) => {
      const res = await apiFetch('/api/todo-workflow/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error(await res.text());
      return (await res.json()) as TodoWorkflowSettings;
    },
    onSuccess: (settings) => {
      queryClient.setQueryData(['todoWorkflowSettings'], settings);
      queryClient.invalidateQueries({ queryKey: ['todoWorkflowSettings'] });
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
        const res = await apiFetch(`/api/workbench/sessions/${input.sessionId}/queue`, {
          method: 'POST',
        });
        if (!res.ok) throw new Error(await res.text());
      } else if (input.targetGroup === 'archive') {
        const res = await apiFetch(`/api/workbench/sessions/${input.sessionId}/archive`, {
          method: 'PATCH',
        });
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
    queueSessionMutation,
    createImplementationQueueEntryMutation,
    archiveImplementationQueueEntryMutation,
    removeImplementationQueueEntryMutation,
    submitRunReviewMutation,
    requeueImplementationQueueEntryMutation,
    updateImplementationQueueProcessorCountMutation,
    updateTodoWorkflowSettingsMutation,
    updateSessionStatusMutation,
    reorderQueueSessionsMutation,
    moveWorkbenchSessionMutation,
  };
}
