import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { client } from '../../../lib/api';
import { dedupeAndSortRunEvents, mergeRunEvents } from '../realtimeEvents';
import type {
  CreateProjectInput,
  CreateSessionInput,
  LlmProvider,
  LlmSettings,
  ProjectFileContent,
  ProjectFileEntry,
  Repository,
  ReviewOutcome,
  ReviewResult,
  ReviewRunInput,
  RunDetails,
  Task,
  TaskEvent,
  TaskMessage,
  TaskRun,
  TaskRunTodo,
  WorkbenchArtifactRef,
  WorkbenchChatIntent,
  WorkbenchMovableSessionGroup,
  WorkbenchSessionView,
} from '../types';
import {
  buildWorkbenchArtifactRefs,
  buildWorkbenchSessionView,
  groupWorkbenchSessions,
} from '../workbenchSelectors';

type FolderDir = { name: string; path: string };
type RealtimeStatus = 'initializing' | 'connecting' | 'connected' | 'disconnected';

export type NightWorkersWorkspaceState = {
  projects: Repository[];
  sessions: Task[];
  sessionViews: WorkbenchSessionView[];
  groupedSessionViews: Record<string, ProjectSessionGroups>;
  activeSessionId: string | null;
  activeSession: Task | null;
  activeSessionView: WorkbenchSessionView | null;
  activeProject: Repository | null;
  activeSessionRuns: TaskRun[];
  latestRun: TaskRun | undefined;
  taskMessages: TaskMessage[];
  latestRunEvents: TaskEvent[];
  latestRunTodos: TaskRunTodo[];
  latestRunReviews: ReviewResult[];
  activeArtifactRefs: WorkbenchArtifactRef[];
  projectFileEntries: ProjectFileEntry[];
  projectFileEntriesByDirectory: Record<string, ProjectFileEntry[]>;
  expandedProjectDirectories: Record<string, boolean>;
  loadingProjectDirectories: Record<string, boolean>;
  selectedProjectFile: ProjectFileContent | null;
  selectedProjectFilePath: string | null;
  isProjectFilesLoading: boolean;
  isProjectFileLoading: boolean;
  isRealtimeConnected: boolean;
  realtimeStatus: RealtimeStatus;
  isChatSubmitting: boolean;
  isProjectsLoading: boolean;
  isSessionsLoading: boolean;
  isAgentWorking: boolean;
  isAgentThinking: boolean;
  isUpdatingSessionStatus: boolean;
  expandedProjects: Record<string, boolean>;
  setExpandedProjects: Dispatch<SetStateAction<Record<string, boolean>>>;
  setActiveSessionId: (id: string | null) => void;
  createProject: (input: CreateProjectInput) => void;
  deleteProject: (id: string) => void;
  deleteSession: (id: string) => void;
  createSession: (input: CreateSessionInput) => Promise<Task>;
  startRun: (sessionId: string) => Promise<TaskRun>;
  queueSession: (sessionId: string) => Promise<Task>;
  updateSessionStatus: (sessionId: string, status: 'draft' | 'ready') => Promise<Task>;
  reorderQueueSessions: (sessionIds: string[]) => Promise<Task[]>;
  moveWorkbenchSession: (input: {
    sessionId: string;
    sourceGroup: WorkbenchMovableSessionGroup;
    targetGroup: WorkbenchMovableSessionGroup;
    processingIds: string[];
    queueIds: string[];
    archiveIds: string[];
  }) => Promise<void>;
  reviewRun: (input: ReviewRunInput) => Promise<{
    ok: boolean;
    status: string;
    outcome: ReviewOutcome;
    reviewResult: ReviewResult;
  }>;
  sendChatMessage: (sessionId: string, prompt: string) => Promise<void>;
  sendWorkbenchMessage: (
    sessionId: string,
    prompt: string,
    intent: WorkbenchChatIntent
  ) => Promise<void>;
  refreshWorkspace: () => void;
  currentBrowserPath: string | null;
  browserParentPath: string | null;
  browserDirectories: FolderDir[];
  isBrowserLoading: boolean;
  fetchDirectories: (targetPath?: string) => Promise<void>;
  llmSettings: LlmSettings | null;
  activeProvider: LlmProvider;
  providerModelOptions: Array<{ value: string; label: string }>;
  setActiveProvider: (provider: LlmProvider) => Promise<void>;
  toggleProviderEnabled: (provider: LlmProvider, enabled: boolean) => Promise<void>;
  updateProviderModel: (model: string) => Promise<void>;
  runLlmSmokeTest: () => Promise<{ ok: boolean; provider: string; message: string }>;
  toggleProjectDirectory: (path: string) => Promise<void>;
  openProjectFile: (path: string) => void;
};

export type ProjectSessionGroups = {
  processing: WorkbenchSessionView[];
  queue: WorkbenchSessionView[];
  archive: WorkbenchSessionView[];
};

export function useNightWorkersWorkspace(): NightWorkersWorkspaceState {
  const queryClient = useQueryClient();
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  const [currentBrowserPath, setCurrentBrowserPath] = useState<string | null>(null);
  const [browserDirectories, setBrowserDirectories] = useState<FolderDir[]>([]);
  const [browserParentPath, setBrowserParentPath] = useState<string | null>(null);
  const rootProjectDirectory = '';
  const [selectedProjectFilePath, setSelectedProjectFilePath] = useState<string | null>(null);
  const [projectFileEntriesByDirectory, setProjectFileEntriesByDirectory] = useState<
    Record<string, ProjectFileEntry[]>
  >({});
  const [expandedProjectDirectories, setExpandedProjectDirectories] = useState<
    Record<string, boolean>
  >({});
  const [loadingProjectDirectories, setLoadingProjectDirectories] = useState<
    Record<string, boolean>
  >({});
  const [isBrowserLoading, setIsBrowserLoading] = useState(false);
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(false);
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>('initializing');
  const [isChatSubmitting, setIsChatSubmitting] = useState(false);
  const [pendingChatRunId, setPendingChatRunId] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const lastSubmitRef = useRef<{ taskId: string; prompt: string; at: number } | null>(null);
  const pendingChatQueueRef = useRef<Array<{ taskId: string; prompt: string }>>([]);
  const chatSubmitStartedAtRef = useRef<number | null>(null);
  const pendingChatRunIdRef = useRef<string | null>(null);
  const lastSubmitRecoveryAtRef = useRef<number>(0);
  const [realtimeEvents, setRealtimeEvents] = useState<TaskEvent[]>([]);
  const [bufferedEventsByRun, setBufferedEventsByRun] = useState<Record<string, TaskEvent[]>>({});

  const fetchDirectories = async (targetPath?: string) => {
    setIsBrowserLoading(true);
    try {
      const url = targetPath
        ? `/api/utils/browse-folders?path=${encodeURIComponent(targetPath)}`
        : '/api/utils/browse-folders';
      const res = await fetch(url);
      if (!res.ok) return;
      const data = (await res.json()) as {
        currentPath: string | null;
        parentPath: string | null;
        directories: FolderDir[];
      };
      setCurrentBrowserPath(data.currentPath);
      setBrowserParentPath(data.parentPath);
      setBrowserDirectories(data.directories || []);
    } finally {
      setIsBrowserLoading(false);
    }
  };

  const { data: projects = [], isLoading: isProjectsLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const res = await client.repositories.$get();
      if (!res.ok) throw new Error('Failed to fetch projects');
      return (await res.json()) as Repository[];
    },
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const { data: sessions = [], isLoading: isSessionsLoading } = useQuery({
    queryKey: ['sessions'],
    queryFn: async () => {
      const res = await client.tasks.$get();
      if (!res.ok) throw new Error('Failed to fetch sessions');
      return (await res.json()) as Task[];
    },
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const { data: activeSessionRuns = [] } = useQuery({
    queryKey: ['sessionRuns', activeSessionId],
    queryFn: async () => {
      if (!activeSessionId) return [];
      const res = await client.tasks[':id'].runs.$get({ param: { id: activeSessionId } });
      if (!res.ok) throw new Error('Failed to fetch session runs');
      return (await res.json()) as TaskRun[];
    },
    enabled: !!activeSessionId,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const { data: taskMessages = [] } = useQuery({
    queryKey: ['taskMessages', activeSessionId],
    queryFn: async () => {
      if (!activeSessionId) return [];
      const res = await fetch(`/api/tasks/${activeSessionId}/messages`);
      if (!res.ok) throw new Error('Failed to fetch task messages');
      return (await res.json()) as TaskMessage[];
    },
    enabled: !!activeSessionId,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const { data: llmSettings = null } = useQuery({
    queryKey: ['llmSettings'],
    queryFn: async () => {
      const res = await fetch('/api/settings/llm');
      if (!res.ok) throw new Error('Failed to fetch llm settings');
      return (await res.json()) as LlmSettings;
    },
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const activeProvider = (llmSettings?.ACTIVE_LLM_PROVIDER || 'azure') as LlmProvider;

  const { data: providerModelOptions = [] } = useQuery({
    queryKey: ['llmModelOptions', activeProvider],
    queryFn: async () => {
      const res = await fetch('/api/settings/llm/models');
      if (!res.ok) throw new Error('Failed to fetch model options');
      const data = (await res.json()) as { options: Array<{ value: string; label: string }> };
      return data.options;
    },
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  useEffect(() => {
    if (!activeSessionId && sessions[0]) setActiveSessionId(sessions[0].id);
  }, [activeSessionId, sessions]);

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

  const createSessionMutation = useMutation({
    mutationFn: async (data: CreateSessionInput) => {
      const res = await fetch('/api/workbench/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to create session');
      return (await res.json()) as Task;
    },
    onSuccess: (newSession) => {
      setActiveSessionId(newSession.id);
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });

  const deleteSessionMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/workbench/sessions/${id}/archive`, { method: 'PATCH' });
      if (!res.ok) throw new Error('Failed to archive session');
      return res.json();
    },
    onSuccess: (_, deletedId) => {
      if (activeSessionId === deletedId) setActiveSessionId(null);
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({ queryKey: ['sessionRuns'] });
      queryClient.invalidateQueries({ queryKey: ['taskMessages'] });
    },
  });

  const startRunMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      const res = await fetch(`/api/workbench/sessions/${sessionId}/run`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to start run');
      return (await res.json()) as TaskRun;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({ queryKey: ['sessionRuns', activeSessionId] });
    },
  });

  const queueSessionMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      const res = await fetch(`/api/workbench/sessions/${sessionId}/queue`, { method: 'POST' });
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

  const updateSessionStatusMutation = useMutation({
    mutationFn: async (input: { sessionId: string; status: 'draft' | 'ready' }) => {
      const res = await client.tasks[':id'].$patch({
        param: { id: input.sessionId },
        json: { status: input.status },
      });
      if (!res.ok) throw new Error(await res.text());
      return (await res.json()) as Task;
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
          const res = await client.tasks[':id'].$patch({
            param: { id: sessionId },
            json: { priority },
          });
          if (!res.ok) throw new Error(await res.text());
          return (await res.json()) as Task;
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
        const res = await fetch(`/api/workbench/sessions/${input.sessionId}/run`, {
          method: 'POST',
        });
        if (!res.ok) throw new Error(await res.text());
      } else if (input.sourceGroup === 'processing' && input.targetGroup === 'queue') {
        const res = await client.tasks[':id'].$patch({
          param: { id: input.sessionId },
          json: { status: 'queued' },
        });
        if (!res.ok) throw new Error(await res.text());
      } else if (input.targetGroup === 'archive') {
        const res = await fetch(`/api/workbench/sessions/${input.sessionId}/archive`, {
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
          const res = await client.tasks[':id'].$patch({
            param: { id: sessionId },
            json: { priority },
          });
          if (!res.ok) throw new Error(await res.text());
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

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? null,
    [activeSessionId, sessions]
  );
  const activeProject = useMemo(
    () =>
      activeSession
        ? (projects.find((p) => p.id === activeSession.repositoryId) ?? null)
        : (projects[0] ?? null),
    [activeSession, projects]
  );
  const activeProjectId = activeProject?.id;

  const { data: projectFileEntries = [], isLoading: isProjectFilesLoading } = useQuery({
    queryKey: ['projectFiles', activeProjectId, rootProjectDirectory],
    queryFn: async () => {
      if (!activeProjectId) return [];
      const params = new URLSearchParams();
      if (rootProjectDirectory) params.set('path', rootProjectDirectory);
      const query = params.toString();
      const res = await fetch(
        `/api/repositories/${activeProjectId}/files${query ? `?${query}` : ''}`
      );
      if (!res.ok) throw new Error('Failed to fetch project files');
      return (await res.json()) as ProjectFileEntry[];
    },
    enabled: !!activeProjectId,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const mergedProjectFileEntriesByDirectory = useMemo<Record<string, ProjectFileEntry[]>>(
    () => ({
      ...projectFileEntriesByDirectory,
      [rootProjectDirectory]: projectFileEntries,
    }),
    [projectFileEntries, projectFileEntriesByDirectory]
  );

  const { data: selectedProjectFile = null, isLoading: isProjectFileLoading } = useQuery({
    queryKey: ['projectFile', activeProjectId, selectedProjectFilePath],
    queryFn: async () => {
      if (!activeProjectId || !selectedProjectFilePath) return null;
      const params = new URLSearchParams({ path: selectedProjectFilePath });
      const res = await fetch(`/api/repositories/${activeProjectId}/file?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch project file');
      return (await res.json()) as ProjectFileContent;
    },
    enabled: !!activeProjectId && !!selectedProjectFilePath,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const latestRun = activeSessionRuns[0];
  const { data: latestRunDetails = null } = useQuery({
    queryKey: ['runDetails', latestRun?.id],
    queryFn: async () => {
      if (!latestRun?.id) return null;
      const res = await client.runs[':id'].$get({ param: { id: latestRun.id } });
      if (!res.ok) throw new Error('Failed to fetch run details');
      return (await res.json()) as RunDetails;
    },
    enabled: !!latestRun?.id,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  // 入力ロックは「送信待ち」の間だけに限定する。
  // run status に依存すると、サーバーダウン時に running が残って永久ロックになる。
  const isAgentWorking = isChatSubmitting;
  const isAgentThinking =
    isChatSubmitting ||
    Boolean(pendingChatRunId) ||
    isActiveRunStatus(latestRun?.status) ||
    isActiveTaskStatus(activeSession?.status);
  const latestRunEvents =
    realtimeEvents.length > 0 ? realtimeEvents : latestRunDetails?.events || [];
  const latestRunTodos = latestRunDetails?.todos || [];
  const latestRunReviews = latestRunDetails?.reviews || [];
  const activeArtifactRefs = useMemo(
    () =>
      activeSession
        ? buildWorkbenchArtifactRefs({
            task: activeSession,
            latestRun,
            todos: latestRunTodos,
            events: latestRunEvents,
            reviews: latestRunReviews,
            messages: taskMessages,
          })
        : [],
    [activeSession, latestRun, latestRunEvents, latestRunReviews, latestRunTodos, taskMessages]
  );
  const activeSessionView = useMemo(
    () =>
      activeSession
        ? buildWorkbenchSessionView(activeSession, {
            latestRun,
            todos: latestRunTodos,
            events: latestRunEvents,
            reviews: latestRunReviews,
            messages: taskMessages,
          })
        : null,
    [activeSession, latestRun, latestRunEvents, latestRunReviews, latestRunTodos, taskMessages]
  );
  const sessionViews = useMemo(
    () =>
      sessions.map((session) =>
        session.id === activeSession?.id && activeSessionView
          ? activeSessionView
          : buildWorkbenchSessionView(session)
      ),
    [activeSession?.id, activeSessionView, sessions]
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
        if (session.task.status === 'draft') return { ...session, queuePosition: undefined };
        queuePosition += 1;
        return { ...session, queuePosition };
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

  useEffect(() => {
    // サーバーダウンやWS切断時に入力が永久ロックされるのを防ぐ
    if (realtimeStatus !== 'disconnected') return;
    setIsChatSubmitting(false);
    chatSubmitStartedAtRef.current = null;
    pendingChatRunIdRef.current = null;
    setPendingChatRunId(null);
    pendingChatQueueRef.current = [];
  }, [realtimeStatus]);

  useEffect(() => {
    if (!activeSessionId) return;
    const timer = setInterval(() => {
      if (!isChatSubmitting) return;
      const startedAt = chatSubmitStartedAtRef.current;
      if (!startedAt) return;
      const elapsed = Date.now() - startedAt;
      // 接続が生きて見えても応答が詰まるケース向けのフェイルセーフ
      if (elapsed < 20000) return;

      const hasAcceptedOrActiveRun =
        Boolean(pendingChatRunIdRef.current || pendingChatRunId) ||
        isActiveRunStatus(latestRun?.status) ||
        isActiveTaskStatus(activeSession?.status);

      if (!hasAcceptedOrActiveRun && Date.now() - lastSubmitRecoveryAtRef.current > 15000) {
        lastSubmitRecoveryAtRef.current = Date.now();
        const timeoutMessage: TaskMessage = {
          id: `chat-timeout-${Date.now()}`,
          taskId: activeSessionId,
          role: 'assistant',
          content: '応答待機がタイムアウトしたため入力ロックを解除しました。再送してください。',
          messageType: 'text',
          createdAt: new Date().toISOString(),
        };
        queryClient.setQueryData<TaskMessage[]>(['taskMessages', activeSessionId], (prev = []) => [
          ...prev,
          timeoutMessage,
        ]);
      }

      setIsChatSubmitting(false);
      chatSubmitStartedAtRef.current = null;
      pendingChatRunIdRef.current = null;
      setPendingChatRunId(null);
      pendingChatQueueRef.current = [];
    }, 2000);
    return () => clearInterval(timer);
  }, [
    activeSession?.status,
    activeSessionId,
    isChatSubmitting,
    latestRun?.status,
    pendingChatRunId,
    queryClient,
  ]);

  useEffect(() => {
    const runId = latestRun?.id;
    if (!runId) {
      setRealtimeEvents(
        mergeRunEvents({
          latestRunId: null,
          restEvents: latestRunDetails?.events || [],
          bufferedEventsByRun,
        })
      );
      return;
    }
    const merged = mergeRunEvents({
      latestRunId: runId,
      restEvents: (latestRunDetails?.events || []) as TaskEvent[],
      bufferedEventsByRun,
    });
    setRealtimeEvents(merged);
  }, [latestRun?.id, latestRunDetails?.events, bufferedEventsByRun]);

  useEffect(() => {
    setRealtimeStatus('connecting');
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const configuredUrl = (import.meta as any).env?.VITE_NIGHTWORKERS_WS_URL as string | undefined;
    const primaryUrl = configuredUrl || `${protocol}//${window.location.host}/api/ws/nightworkers`;
    const fallbackUrl =
      !configuredUrl &&
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
        ? `${protocol}//localhost:39173/api/ws/nightworkers`
        : null;

    let ws: WebSocket | null = null;
    let closedManually = false;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 8;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let initialConnectTimer: ReturnType<typeof setTimeout> | null = null;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    let usingFallback = false;

    const connect = (url: string) => {
      ws = new WebSocket(url);
      wsRef.current = ws;

      ws.addEventListener('open', () => {
        reconnectAttempts = 0;
        setIsRealtimeConnected(true);
        setRealtimeStatus('connected');
        if (activeSessionId) {
          ws?.send(JSON.stringify({ type: 'subscribe_task', taskId: activeSessionId }));
        }
        if (pendingChatQueueRef.current.length > 0) {
          const queued = [...pendingChatQueueRef.current];
          pendingChatQueueRef.current = [];
          for (const item of queued) {
            ws?.send(
              JSON.stringify({
                type: 'chat_submit',
                taskId: item.taskId,
                prompt: item.prompt,
              })
            );
          }
        }
      });

      ws.addEventListener('message', (event) => {
        try {
          const msg = JSON.parse(String(event.data)) as {
            type?: string;
            runId?: string;
            seq?: number;
            message?: string;
            payload?: { message?: TaskMessage; run?: TaskRun; status?: string; task?: Task };
            event?: {
              id: string;
              actor?: string;
              type?: string;
              eventType?: string | null;
              payloadJson?: any;
              message: string;
              timestamp?: unknown;
            };
          };
          if (msg.type === 'task_event_created' && msg.runId && msg.event) {
            const eventPayload = { ...(msg.event as TaskEvent), runId: msg.runId } as TaskEvent;
            setBufferedEventsByRun((prev) => {
              const next = { ...prev };
              const current = next[msg.runId as string] || [];
              next[msg.runId as string] = dedupeAndSortRunEvents([...current, eventPayload]);
              return next;
            });
            queryClient.invalidateQueries({ queryKey: ['runDetails', msg.runId] });
          }
          if (msg.type === 'task_message_created' && msg.payload?.message) {
            const incoming = msg.payload.message;
            queryClient.setQueryData<TaskMessage[]>(
              ['taskMessages', activeSessionId],
              (prev = []) => {
                if (!incoming) return prev;
                const next = [...prev];
                if (incoming.role === 'user') {
                  const optimisticIndex = next.findIndex(
                    (m) =>
                      m.id.startsWith('optimistic-user-') &&
                      m.role === 'user' &&
                      m.content === incoming.content
                  );
                  if (optimisticIndex >= 0) next.splice(optimisticIndex, 1);
                }
                next.push(incoming);
                return next;
              }
            );
            if (
              incoming.role === 'assistant' &&
              (!pendingChatRunIdRef.current || incoming.runId === pendingChatRunIdRef.current)
            ) {
              setIsChatSubmitting(false);
              chatSubmitStartedAtRef.current = null;
              pendingChatRunIdRef.current = null;
              setPendingChatRunId(null);
            }
          }
          if (msg.type === 'chat_submit_enqueued') {
            pendingChatRunIdRef.current = msg.runId || null;
            setPendingChatRunId(msg.runId || null);
          }
          if (msg.type === 'error') {
            setIsChatSubmitting(false);
            chatSubmitStartedAtRef.current = null;
            pendingChatRunIdRef.current = null;
            setPendingChatRunId(null);
            if (!activeSessionId) return;
            const errorMessage: TaskMessage = {
              id: `chat-error-${Date.now()}`,
              taskId: activeSessionId,
              role: 'assistant',
              content: msg.message || '送信に失敗しました。接続状態を確認してください。',
              messageType: 'text',
              createdAt: new Date().toISOString(),
            };
            queryClient.setQueryData<TaskMessage[]>(
              ['taskMessages', activeSessionId],
              (prev = []) => [...prev, errorMessage]
            );
          }
          if (msg.type === 'task_run_updated' && msg.payload?.run) {
            const incomingRun = msg.payload.run as TaskRun;
            queryClient.setQueryData<TaskRun[]>(['sessionRuns', activeSessionId], (prev = []) => {
              const next = [...prev];
              const idx = next.findIndex((r) => r.id === incomingRun.id);
              if (idx >= 0) {
                next[idx] = incomingRun;
              } else {
                next.unshift(incomingRun);
              }
              return next;
            });
            queryClient.invalidateQueries({ queryKey: ['runDetails', incomingRun.id] });
          }
          if (msg.type === 'task_status_updated' && msg.payload?.task) {
            const incomingTask = msg.payload.task as Task;
            queryClient.setQueryData<Task[]>(['sessions'], (prev = []) => {
              const next = [...prev];
              const idx = next.findIndex((t) => t.id === incomingTask.id);
              if (idx >= 0) {
                next[idx] = incomingTask;
              } else {
                next.unshift(incomingTask);
              }
              return next;
            });
          }
        } catch {
          // ignore malformed payload
        }
      });

      ws.addEventListener('close', () => {
        setIsRealtimeConnected(false);
        setRealtimeStatus('disconnected');
        if (closedManually) return;
        if (reconnectAttempts >= maxReconnectAttempts) {
          setIsChatSubmitting(false);
          return;
        }
        const backoffMs = Math.min(1000 * 2 ** reconnectAttempts, 15000);
        reconnectAttempts += 1;
        reconnectTimer = setTimeout(() => {
          const nextUrl = usingFallback && fallbackUrl ? fallbackUrl : url;
          connect(nextUrl);
        }, backoffMs);
      });
      ws.addEventListener('error', () => {
        setIsRealtimeConnected(false);
        setRealtimeStatus('disconnected');
      });
    };

    initialConnectTimer = setTimeout(() => connect(primaryUrl), 0);

    fallbackTimer = setTimeout(() => {
      const notConnected = !ws || ws.readyState !== WebSocket.OPEN;
      if (notConnected && !closedManually && fallbackUrl && fallbackUrl !== primaryUrl) {
        try {
          ws?.close();
        } catch {
          // noop
        }
        usingFallback = true;
        connect(fallbackUrl);
      }
    }, 1500);

    return () => {
      closedManually = true;
      if (initialConnectTimer) clearTimeout(initialConnectTimer);
      if (fallbackTimer) clearTimeout(fallbackTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try {
        if (activeSessionId) {
          ws?.send(JSON.stringify({ type: 'unsubscribe_task', taskId: activeSessionId }));
        }
      } catch {
        // noop
      }
      ws?.close();
      wsRef.current = null;
      setIsRealtimeConnected(false);
      setRealtimeStatus('disconnected');
    };
  }, [activeSessionId, queryClient]);

  return {
    projects,
    sessions,
    sessionViews,
    groupedSessionViews,
    activeSessionId,
    activeSession,
    activeSessionView: activeSessionViewWithQueuePosition,
    activeProject,
    activeSessionRuns,
    latestRun,
    taskMessages,
    latestRunEvents,
    latestRunTodos,
    latestRunReviews,
    activeArtifactRefs,
    projectFileEntries,
    projectFileEntriesByDirectory: mergedProjectFileEntriesByDirectory,
    expandedProjectDirectories,
    loadingProjectDirectories,
    selectedProjectFile,
    selectedProjectFilePath,
    isProjectFilesLoading,
    isProjectFileLoading,
    isRealtimeConnected,
    realtimeStatus,
    isChatSubmitting,
    isProjectsLoading,
    isSessionsLoading,
    isAgentWorking,
    isAgentThinking,
    isUpdatingSessionStatus: updateSessionStatusMutation.isPending,
    expandedProjects,
    setExpandedProjects,
    setActiveSessionId,
    createProject: (input) => createProjectMutation.mutate(input),
    deleteProject: (id) => deleteProjectMutation.mutate(id),
    deleteSession: (id) => deleteSessionMutation.mutate(id),
    createSession: (input) => createSessionMutation.mutateAsync(input),
    startRun: (sessionId) => startRunMutation.mutateAsync(sessionId),
    queueSession: (sessionId) => queueSessionMutation.mutateAsync(sessionId),
    updateSessionStatus: (sessionId, status) =>
      updateSessionStatusMutation.mutateAsync({ sessionId, status }),
    reorderQueueSessions: (sessionIds) => reorderQueueSessionsMutation.mutateAsync(sessionIds),
    moveWorkbenchSession: (input) => moveWorkbenchSessionMutation.mutateAsync(input),
    reviewRun: async (input) => {
      const res = await fetch(`/api/runs/${input.runId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error('Failed to submit review');
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({ queryKey: ['sessionRuns', activeSessionId] });
      return (await res.json()) as {
        ok: boolean;
        status: string;
        outcome: ReviewOutcome;
        reviewResult: ReviewResult;
      };
    },
    sendChatMessage: async (sessionId, prompt) => {
      const content = prompt.trim();
      if (!content) return;
      if (!appendOptimisticUserMessage(sessionId, content, lastSubmitRef, queryClient)) return;
      setIsChatSubmitting(true);
      chatSubmitStartedAtRef.current = Date.now();
      pendingChatRunIdRef.current = null;
      setPendingChatRunId(null);
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        pendingChatQueueRef.current.push({ taskId: sessionId, prompt: content });
        return;
      }
      ws.send(
        JSON.stringify({
          type: 'chat_submit',
          taskId: sessionId,
          prompt: content,
        })
      );
    },
    sendWorkbenchMessage: async (sessionId, prompt, intent) => {
      const content = prompt.trim();
      if (!content) return;
      if (!appendOptimisticUserMessage(sessionId, content, lastSubmitRef, queryClient)) return;
      setIsChatSubmitting(true);
      chatSubmitStartedAtRef.current = Date.now();
      pendingChatRunIdRef.current = null;
      setPendingChatRunId(null);
      try {
        const res = await fetch(`/api/workbench/sessions/${sessionId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: content, intent }),
        });
        if (!res.ok) throw new Error(await res.text());
        const result = (await res.json()) as {
          task?: Task;
          run?: TaskRun | null;
          messages?: TaskMessage[];
        };
        if (result.messages) queryClient.setQueryData(['taskMessages', sessionId], result.messages);
        if (result.task) {
          queryClient.setQueryData<Task[]>(['sessions'], (prev = []) => {
            const next = [...prev];
            const idx = next.findIndex((task) => task.id === result.task?.id);
            if (idx >= 0 && result.task) next[idx] = result.task;
            else if (result.task) next.unshift(result.task);
            return next;
          });
        }
        if (result.run) {
          pendingChatRunIdRef.current = result.run.id;
          setPendingChatRunId(result.run.id);
        }
        queryClient.invalidateQueries({ queryKey: ['sessions'] });
        queryClient.invalidateQueries({ queryKey: ['sessionRuns', sessionId] });
      } finally {
        setIsChatSubmitting(false);
        chatSubmitStartedAtRef.current = null;
        if (intent !== 'run_task') {
          pendingChatRunIdRef.current = null;
          setPendingChatRunId(null);
        }
      }
    },
    refreshWorkspace: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({ queryKey: ['sessionRuns', activeSessionId] });
      queryClient.invalidateQueries({ queryKey: ['runDetails', latestRun?.id] });
    },
    currentBrowserPath,
    browserParentPath,
    browserDirectories,
    isBrowserLoading,
    fetchDirectories,
    llmSettings,
    activeProvider,
    providerModelOptions,
    setActiveProvider: async (provider) => {
      const merged = { ...(llmSettings || {}), ACTIVE_LLM_PROVIDER: provider } as LlmSettings;
      const res = await fetch('/api/settings/llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(merged),
      });
      if (!res.ok) throw new Error('Failed to save llm settings');
      queryClient.invalidateQueries({ queryKey: ['llmSettings'] });
      queryClient.invalidateQueries({ queryKey: ['llmModelOptions'] });
    },
    toggleProviderEnabled: async (provider, enabled) => {
      if (!llmSettings) return;
      const flagKey: Record<LlmProvider, keyof LlmSettings> = {
        openai: 'OPENAI_ENABLED',
        azure: 'AZURE_OPENAI_ENABLED',
        bedrock: 'AWS_BEDROCK_ENABLED',
        codex: 'CODEX_ENABLED',
      };
      const merged = { ...llmSettings, [flagKey[provider]]: enabled };
      const res = await fetch('/api/settings/llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(merged),
      });
      if (!res.ok) throw new Error('Failed to save llm settings');
      queryClient.invalidateQueries({ queryKey: ['llmSettings'] });
    },
    updateProviderModel: async (model) => {
      if (!llmSettings) return;
      const modelKey: Record<LlmProvider, keyof LlmSettings> = {
        openai: 'OPENAI_MODEL',
        azure: 'AZURE_OPENAI_DEPLOYMENT_NAME',
        bedrock: 'AWS_BEDROCK_MODEL',
        codex: 'CODEX_MODEL',
      };
      const merged = { ...llmSettings, [modelKey[activeProvider]]: model };
      const res = await fetch('/api/settings/llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(merged),
      });
      if (!res.ok) throw new Error('Failed to save model settings');
      queryClient.invalidateQueries({ queryKey: ['llmSettings'] });
      queryClient.invalidateQueries({ queryKey: ['llmModelOptions'] });
    },
    runLlmSmokeTest: async () => {
      const res = await fetch('/api/settings/llm/smoke', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to run smoke');
      return (await res.json()) as { ok: boolean; provider: string; message: string };
    },
    toggleProjectDirectory: async (path) => {
      const nextExpanded = !expandedProjectDirectories[path];
      setExpandedProjectDirectories((prev) => ({ ...prev, [path]: nextExpanded }));
      if (!nextExpanded || mergedProjectFileEntriesByDirectory[path] || !activeProjectId) return;
      setLoadingProjectDirectories((prev) => ({ ...prev, [path]: true }));
      try {
        const params = new URLSearchParams({ path });
        const res = await fetch(`/api/repositories/${activeProjectId}/files?${params.toString()}`);
        if (!res.ok) throw new Error('Failed to fetch project files');
        const entries = (await res.json()) as ProjectFileEntry[];
        setProjectFileEntriesByDirectory((prev) => ({ ...prev, [path]: entries }));
      } finally {
        setLoadingProjectDirectories((prev) => ({ ...prev, [path]: false }));
      }
    },
    openProjectFile: (path) => {
      setSelectedProjectFilePath(path);
    },
  };
}

function isActiveRunStatus(status: string | undefined): boolean {
  return (
    status === 'running' ||
    status === 'context_compiling' ||
    status === 'compiling_context' ||
    status === 'finalizing'
  );
}

function appendOptimisticUserMessage(
  sessionId: string,
  content: string,
  lastSubmitRef: MutableRefObject<{ taskId: string; prompt: string; at: number } | null>,
  queryClient: QueryClient
): boolean {
  const now = Date.now();
  const lastSubmit = lastSubmitRef.current;
  if (
    lastSubmit &&
    lastSubmit.taskId === sessionId &&
    lastSubmit.prompt === content &&
    now - lastSubmit.at < 1500
  ) {
    return false;
  }
  lastSubmitRef.current = { taskId: sessionId, prompt: content, at: now };
  const optimisticUserMessage: TaskMessage = {
    id: `optimistic-user-${Date.now()}`,
    taskId: sessionId,
    role: 'user',
    content,
    messageType: 'text',
    createdAt: new Date().toISOString(),
  };
  queryClient.setQueryData<TaskMessage[]>(['taskMessages', sessionId], (prev = []) => [
    ...prev,
    optimisticUserMessage,
  ]);
  return true;
}

function buildPriorityUpdates(sessionIds: string[], sessions: Task[]) {
  const currentPriorityById = new Map(sessions.map((session) => [session.id, session.priority]));
  return sessionIds
    .map((sessionId, index) => ({
      sessionId,
      priority: sessionIds.length - index,
    }))
    .filter(({ sessionId, priority }) => currentPriorityById.get(sessionId) !== priority);
}

function isActiveTaskStatus(status: string | undefined): boolean {
  return (
    status === 'running' ||
    status === 'context_compiling' ||
    status === 'compiling_context' ||
    status === 'finalizing'
  );
}
