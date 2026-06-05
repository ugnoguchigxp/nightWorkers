import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { client } from '../../../lib/api';
import { apiFetch, devWsFallbackPath, wsPath } from '../../../lib/api-base';
import { dedupeAndSortActivityEvents } from '../activityTranscript';
import {
  dedupeAndSortRunEvents,
  getRealtimeMessageDedupeKey,
  mergeRunEvents,
} from '../realtimeEvents';
import type {
  ActivityArtifact,
  ActivityEvent,
  ActivityReplay,
  AgentHookConfig,
  AgentHookInput,
  AgentHookTestResult,
  CreateProjectInput,
  CreateSessionInput,
  ImplementationQueueDashboard,
  LlmProvider,
  LlmSettings,
  McpServerConfig,
  McpServerImportResult,
  McpServerInput,
  McpServerTestResult,
  ProjectFileContent,
  ProjectFileEntry,
  Repository,
  ReviewResult,
  RunDetails,
  Task,
  TaskEvent,
  TaskLlmUsageSummary,
  TaskMessage,
  TaskRun,
  TaskRunTodo,
  TodoWorkflowSettings,
  UpdateProjectInput,
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
type WorkbenchMessageResult = {
  task?: Task;
  run?: TaskRun | null;
  messages?: TaskMessage[];
};
type TaskPatchInput = {
  title?: string;
  description?: string;
  objective?: string;
  acceptanceCriteria?: string;
  status?: string;
  priority?: number;
};

const emptyActivityReplay: ActivityReplay = { events: [], artifacts: [] };

async function patchTask(sessionId: string, input: TaskPatchInput) {
  const res = await apiFetch(`/api/tasks/${sessionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as Task;
}

export function resolveNextActiveSessionId(currentId: string | null, sessions: Pick<Task, 'id'>[]) {
  if (currentId && sessions.some((session) => session.id === currentId)) return currentId;
  return sessions[0]?.id ?? null;
}

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
  llmUsageSummary: TaskLlmUsageSummary | null;
  activityEvents: ActivityEvent[];
  activityArtifacts: ActivityArtifact[];
  activeStreamingResponse: string;
  latestRunTodos: TaskRunTodo[];
  latestRunReviews: ReviewResult[];
  activeArtifactRefs: WorkbenchArtifactRef[];
  implementationQueue: ImplementationQueueDashboard | null;
  todoWorkflowSettings: TodoWorkflowSettings | null;
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
  isImplementationQueueLoading: boolean;
  expandedProjects: Record<string, boolean>;
  setExpandedProjects: Dispatch<SetStateAction<Record<string, boolean>>>;
  setActiveSessionId: (id: string | null) => void;
  createProject: (input: CreateProjectInput) => void;
  updateProject: (id: string, input: UpdateProjectInput) => Promise<Repository>;
  deleteProject: (id: string) => void;
  deleteSession: (id: string) => void;
  createSession: (input: CreateSessionInput) => Promise<Task>;
  startRun: (sessionId: string) => Promise<TaskRun>;
  queueSession: (sessionId: string) => Promise<Task>;
  createImplementationQueueEntry: (sessionId: string) => Promise<void>;
  archiveImplementationQueueEntry: (entryId: string) => Promise<void>;
  updateImplementationQueueProcessorCount: (processorCount: number) => Promise<void>;
  updateTodoWorkflowSettings: (input: Partial<TodoWorkflowSettings>) => Promise<void>;
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
  sendChatMessage: (sessionId: string, prompt: string) => Promise<void>;
  sendWorkbenchMessage: (
    sessionId: string,
    prompt: string,
    intent: WorkbenchChatIntent
  ) => Promise<WorkbenchMessageResult | undefined>;
  refreshWorkspace: () => void;
  currentBrowserPath: string | null;
  browserParentPath: string | null;
  browserDirectories: FolderDir[];
  isBrowserLoading: boolean;
  fetchDirectories: (targetPath?: string) => Promise<void>;
  llmSettings: LlmSettings | null;
  activeProvider: LlmProvider;
  providerModelOptions: Array<{ value: string; label: string }>;
  mcpServers: McpServerConfig[];
  agentHooks: AgentHookConfig[];
  createMcpServer: (input: McpServerInput) => Promise<McpServerConfig>;
  importMcpServers: (text: string, testAfterImport?: boolean) => Promise<McpServerImportResult>;
  updateMcpServer: (id: string, input: Partial<McpServerInput>) => Promise<McpServerConfig>;
  deleteMcpServer: (id: string) => Promise<void>;
  testMcpServer: (id: string) => Promise<McpServerTestResult>;
  createAgentHook: (input: AgentHookInput) => Promise<AgentHookConfig>;
  updateAgentHook: (id: string, input: Partial<AgentHookInput>) => Promise<AgentHookConfig>;
  deleteAgentHook: (id: string) => Promise<void>;
  testAgentHook: (id: string) => Promise<AgentHookTestResult>;
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
  const [pendingAssistantTaskId, setPendingAssistantTaskId] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const lastSubmitRef = useRef<{ taskId: string; prompt: string; at: number } | null>(null);
  const pendingChatQueueRef = useRef<Array<{ taskId: string; prompt: string }>>([]);
  const chatSubmitStartedAtRef = useRef<number | null>(null);
  const chatSubmitTransportRef = useRef<'http' | 'websocket' | null>(null);
  const pendingChatRunIdRef = useRef<string | null>(null);
  const pendingAssistantTaskIdRef = useRef<string | null>(null);
  const processedRealtimeMessageKeysRef = useRef<Set<string>>(new Set());
  const latestRunSubscriptionRef = useRef<{ runId: string | null; afterSeq?: number }>({
    runId: null,
  });
  const [realtimeEvents, setRealtimeEvents] = useState<TaskEvent[]>([]);
  const [bufferedEventsByRun, setBufferedEventsByRun] = useState<Record<string, TaskEvent[]>>({});
  const [streamingTextByTask, setStreamingTextByTask] = useState<Record<string, string>>({});

  const fetchDirectories = async (targetPath?: string) => {
    setIsBrowserLoading(true);
    try {
      const url = targetPath
        ? `/api/utils/browse-folders?path=${encodeURIComponent(targetPath)}`
        : '/api/utils/browse-folders';
      const res = await apiFetch(url);
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

  const { data: implementationQueue = null, isLoading: isImplementationQueueLoading } = useQuery({
    queryKey: ['implementationQueue'],
    queryFn: async () => {
      const res = await apiFetch('/api/implementation-queue');
      if (!res.ok) throw new Error('Failed to fetch implementation queue');
      return (await res.json()) as ImplementationQueueDashboard;
    },
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const { data: todoWorkflowSettings = null } = useQuery({
    queryKey: ['todoWorkflowSettings'],
    queryFn: async () => {
      const res = await apiFetch('/api/todo-workflow/settings');
      if (!res.ok) throw new Error('Failed to fetch Todo Workflow settings');
      return (await res.json()) as TodoWorkflowSettings;
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
      const res = await apiFetch(`/api/tasks/${activeSessionId}/messages`);
      if (!res.ok) throw new Error('Failed to fetch task messages');
      return (await res.json()) as TaskMessage[];
    },
    enabled: !!activeSessionId,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const { data: llmUsageSummary = null } = useQuery({
    queryKey: ['llmUsage', activeSessionId],
    queryFn: async () => {
      if (!activeSessionId) return null;
      const res = await apiFetch(`/api/tasks/${activeSessionId}/llm-usage`);
      if (!res.ok) throw new Error('Failed to fetch LLM usage summary');
      return (await res.json()) as TaskLlmUsageSummary;
    },
    enabled: !!activeSessionId,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const { data: activityReplay = emptyActivityReplay } = useQuery({
    queryKey: ['activityReplay', activeSessionId],
    queryFn: async () => {
      if (!activeSessionId) return emptyActivityReplay;
      const res = await apiFetch(`/api/tasks/${activeSessionId}/activity-events`);
      if (!res.ok) throw new Error('Failed to fetch activity events');
      return normalizeActivityReplay(await res.json());
    },
    enabled: !!activeSessionId,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const activityEvents = activityReplay.events;
  const activityArtifacts = activityReplay.artifacts;

  const { data: llmSettings = null } = useQuery({
    queryKey: ['llmSettings'],
    queryFn: async () => {
      const res = await apiFetch('/api/settings/llm');
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
      const res = await apiFetch('/api/settings/llm/models');
      if (!res.ok) throw new Error('Failed to fetch model options');
      const data = (await res.json()) as { options: Array<{ value: string; label: string }> };
      return data.options;
    },
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const { data: mcpServers = [] } = useQuery({
    queryKey: ['mcpServers'],
    queryFn: async () => {
      const res = await apiFetch('/api/settings/mcp/servers');
      if (!res.ok) throw new Error('Failed to fetch MCP servers');
      const data = (await res.json()) as { servers: McpServerConfig[] };
      return data.servers;
    },
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const { data: agentHooks = [] } = useQuery({
    queryKey: ['agentHooks'],
    queryFn: async () => {
      const res = await apiFetch('/api/settings/hooks');
      if (!res.ok) throw new Error('Failed to fetch Agent Hooks');
      const data = (await res.json()) as { hooks: AgentHookConfig[] };
      return data.hooks;
    },
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  useEffect(() => {
    const nextActiveSessionId = resolveNextActiveSessionId(activeSessionId, sessions);
    if (nextActiveSessionId !== activeSessionId) setActiveSessionId(nextActiveSessionId);
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({ queryKey: ['sessionRuns', activeSessionId] });
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
      const res = await apiFetch(
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
      const res = await apiFetch(`/api/repositories/${activeProjectId}/file?${params.toString()}`);
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

  // 入力ロックは「送信/初期スレッド作成待ち」の間だけに限定する。
  // run status に依存すると、サーバーダウン時に running が残って永久ロックになる。
  const isInitialSessionCreating = createSessionMutation.isPending;
  const isAgentWorking = isChatSubmitting || isInitialSessionCreating;
  const isAgentThinking =
    isInitialSessionCreating ||
    isChatSubmitting ||
    Boolean(pendingChatRunId) ||
    Boolean(activeSessionId && pendingAssistantTaskId === activeSessionId) ||
    isActiveRunStatus(latestRun?.status) ||
    isActiveTaskStatus(activeSession?.status);
  const latestRunEvents =
    realtimeEvents.length > 0 ? realtimeEvents : latestRunDetails?.events || [];
  const latestRunTodos = latestRunDetails?.todos || [];
  const latestRunReviews = latestRunDetails?.reviews || [];

  useEffect(() => {
    const runBelongsToActiveSession = Boolean(
      activeSessionId && latestRun?.id && latestRun.taskId === activeSessionId
    );
    const maxSeq = latestRunEvents.reduce<number | undefined>((currentMax, event) => {
      if (typeof event.seq !== 'number') return currentMax;
      if (currentMax === undefined) return event.seq;
      return Math.max(currentMax, event.seq);
    }, undefined);
    latestRunSubscriptionRef.current = {
      runId: runBelongsToActiveSession ? latestRun?.id || null : null,
      afterSeq: runBelongsToActiveSession ? maxSeq : undefined,
    };
  }, [activeSessionId, latestRun?.id, latestRun?.taskId, latestRunEvents]);
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
        if (session.task.status !== 'queued') return { ...session, queuePosition: undefined };
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
    chatSubmitTransportRef.current = null;
    pendingChatRunIdRef.current = null;
    setPendingChatRunId(null);
    pendingAssistantTaskIdRef.current = null;
    setPendingAssistantTaskId(null);
    pendingChatQueueRef.current = [];
  }, [realtimeStatus]);

  useEffect(() => {
    if (!activeSessionId) return;
    const timer = setInterval(() => {
      if (!isChatSubmitting) return;
      const startedAt = chatSubmitStartedAtRef.current;
      if (!startedAt) return;
      if (chatSubmitTransportRef.current === 'http') return;
      const elapsed = Date.now() - startedAt;
      // 接続が生きて見えても応答が詰まるケース向けのフェイルセーフ
      if (elapsed < 20000) return;

      const hasAcceptedOrActiveRun =
        Boolean(pendingChatRunIdRef.current || pendingChatRunId) ||
        isActiveRunStatus(latestRun?.status) ||
        isActiveTaskStatus(activeSession?.status);

      if (!hasAcceptedOrActiveRun) {
        setIsChatSubmitting(false);
        chatSubmitStartedAtRef.current = null;
        chatSubmitTransportRef.current = null;
        pendingChatRunIdRef.current = null;
        setPendingChatRunId(null);
        pendingAssistantTaskIdRef.current = null;
        setPendingAssistantTaskId(null);
        pendingChatQueueRef.current = [];
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [
    activeSession?.status,
    activeSessionId,
    isChatSubmitting,
    latestRun?.status,
    pendingChatRunId,
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
    const primaryUrl = wsPath('/api/ws/nightworkers');
    const fallbackUrl = devWsFallbackPath('/api/ws/nightworkers');

    let ws: WebSocket | null = null;
    let closedManually = false;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 8;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let initialConnectTimer: ReturnType<typeof setTimeout> | null = null;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    let usingFallback = false;
    let suppressNextReconnect = false;

    const connect = (url: string) => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      ws = new WebSocket(url);
      wsRef.current = ws;

      ws.addEventListener('open', () => {
        reconnectAttempts = 0;
        setIsRealtimeConnected(true);
        setRealtimeStatus('connected');
        if (activeSessionId) {
          const subscription = latestRunSubscriptionRef.current;
          ws?.send(
            JSON.stringify({
              type: 'subscribe_task',
              taskId: activeSessionId,
              ...(subscription.runId ? { runId: subscription.runId } : {}),
              ...(typeof subscription.afterSeq === 'number'
                ? { afterSeq: subscription.afterSeq }
                : {}),
            })
          );
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
            taskId?: string;
            runId?: string;
            seq?: number;
            message?: string;
            timestamp?: string;
            replayed?: boolean;
            payload?: {
              event?: ActivityEvent;
              message?: TaskMessage;
              run?: TaskRun;
              status?: string;
              task?: Task;
              text?: string;
            };
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
          if (msg.type === 'activity_event_created' && msg.payload?.event) {
            const incoming = msg.payload.event;
            if (activeSessionId && incoming.taskId !== activeSessionId) return;
            queryClient.setQueryData<ActivityReplay>(
              ['activityReplay', incoming.taskId],
              (prev = emptyActivityReplay) => ({
                ...prev,
                events: dedupeAndSortActivityEvents([...prev.events, incoming]),
              })
            );
            if (incoming.artifactId) {
              void queryClient.invalidateQueries({ queryKey: ['activityReplay', incoming.taskId] });
            }
            if (incoming.kind === 'llm.usage') {
              void queryClient.invalidateQueries({ queryKey: ['llmUsage', incoming.taskId] });
            }
          }
          if (msg.type === 'task_llm_delta' && activeSessionId) {
            const taskId = msg.taskId || activeSessionId;
            if (taskId !== activeSessionId) return;
            const messageKey = getRealtimeMessageDedupeKey({ ...msg, taskId });
            if (messageKey) {
              if (processedRealtimeMessageKeysRef.current.has(messageKey)) return;
              processedRealtimeMessageKeysRef.current.add(messageKey);
              if (processedRealtimeMessageKeysRef.current.size > 5000) {
                processedRealtimeMessageKeysRef.current.clear();
                processedRealtimeMessageKeysRef.current.add(messageKey);
              }
            }
            const text =
              typeof msg.payload?.text === 'string'
                ? msg.payload.text
                : typeof msg.message === 'string'
                  ? msg.message
                  : '';
            if (text) {
              setStreamingTextByTask((prev) => ({
                ...prev,
                [taskId]: `${prev[taskId] || ''}${text}`,
              }));
            }
          }
          if (msg.type === 'task_event_created' && msg.runId && msg.event) {
            const eventPayload = {
              ...(msg.event as TaskEvent),
              runId: msg.runId,
              seq: (msg.event as TaskEvent).seq ?? msg.seq,
            } as TaskEvent;
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
            void queryClient.invalidateQueries({ queryKey: ['llmUsage', incoming.taskId] });
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
              (incoming.role === 'assistant' || incoming.role === 'system') &&
              (!pendingAssistantTaskIdRef.current ||
                incoming.taskId === pendingAssistantTaskIdRef.current) &&
              (!pendingChatRunIdRef.current || incoming.runId === pendingChatRunIdRef.current)
            ) {
              setStreamingTextByTask((prev) => {
                const next = { ...prev };
                delete next[incoming.taskId];
                return next;
              });
              setIsChatSubmitting(false);
              chatSubmitStartedAtRef.current = null;
              pendingChatRunIdRef.current = null;
              setPendingChatRunId(null);
              pendingAssistantTaskIdRef.current = null;
              setPendingAssistantTaskId(null);
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
            pendingAssistantTaskIdRef.current = null;
            setPendingAssistantTaskId(null);
            if (!activeSessionId) return;
            const errorMessage: TaskMessage = {
              id: `chat-error-${Date.now()}`,
              taskId: activeSessionId,
              role: 'system',
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
            void queryClient.invalidateQueries({ queryKey: ['llmUsage', incomingRun.taskId] });
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
            queryClient.invalidateQueries({ queryKey: ['implementationQueue'] });
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
            queryClient.invalidateQueries({ queryKey: ['implementationQueue'] });
          }
        } catch {
          // ignore malformed payload
        }
      });

      ws.addEventListener('close', () => {
        setIsRealtimeConnected(false);
        setRealtimeStatus('disconnected');
        if (closedManually) return;
        if (suppressNextReconnect) {
          suppressNextReconnect = false;
          return;
        }
        if (reconnectAttempts >= maxReconnectAttempts) {
          setIsChatSubmitting(false);
          return;
        }
        const backoffMs = Math.min(2000 * 2 ** reconnectAttempts, 30000);
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
          suppressNextReconnect = true;
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
    llmUsageSummary,
    activityEvents,
    activityArtifacts,
    activeStreamingResponse: activeSessionId ? streamingTextByTask[activeSessionId] || '' : '',
    latestRunTodos,
    latestRunReviews,
    activeArtifactRefs,
    implementationQueue,
    todoWorkflowSettings,
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
    isImplementationQueueLoading,
    expandedProjects,
    setExpandedProjects,
    setActiveSessionId,
    createProject: (input) => createProjectMutation.mutate(input),
    updateProject: (id, input) => updateProjectMutation.mutateAsync({ id, data: input }),
    deleteProject: (id) => deleteProjectMutation.mutate(id),
    deleteSession: (id) => deleteSessionMutation.mutate(id),
    createSession: (input) => createSessionMutation.mutateAsync(input),
    startRun: (sessionId) => startRunMutation.mutateAsync(sessionId),
    queueSession: (sessionId) => queueSessionMutation.mutateAsync(sessionId),
    createImplementationQueueEntry: async (sessionId) => {
      await createImplementationQueueEntryMutation.mutateAsync(sessionId);
    },
    archiveImplementationQueueEntry: async (entryId) => {
      await archiveImplementationQueueEntryMutation.mutateAsync(entryId);
    },
    updateImplementationQueueProcessorCount: async (processorCount) => {
      await updateImplementationQueueProcessorCountMutation.mutateAsync(processorCount);
    },
    updateTodoWorkflowSettings: async (input) => {
      await updateTodoWorkflowSettingsMutation.mutateAsync(input);
    },
    updateSessionStatus: (sessionId, status) =>
      updateSessionStatusMutation.mutateAsync({ sessionId, status }),
    reorderQueueSessions: (sessionIds) => reorderQueueSessionsMutation.mutateAsync(sessionIds),
    moveWorkbenchSession: (input) => moveWorkbenchSessionMutation.mutateAsync(input),
    sendChatMessage: async (sessionId, prompt) => {
      const content = prompt.trim();
      if (!content) return;
      if (!appendOptimisticUserMessage(sessionId, content, lastSubmitRef, queryClient)) return;
      setIsChatSubmitting(true);
      chatSubmitStartedAtRef.current = Date.now();
      chatSubmitTransportRef.current = 'websocket';
      pendingChatRunIdRef.current = null;
      setPendingChatRunId(null);
      pendingAssistantTaskIdRef.current = sessionId;
      setPendingAssistantTaskId(sessionId);
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
      chatSubmitTransportRef.current = 'http';
      pendingChatRunIdRef.current = null;
      setPendingChatRunId(null);
      const expectsAssistantResponse = intent !== 'queue' && intent !== 'create_task';
      let shouldClearPendingAssistant = !expectsAssistantResponse;
      if (expectsAssistantResponse) {
        pendingAssistantTaskIdRef.current = sessionId;
        setPendingAssistantTaskId(sessionId);
      } else {
        pendingAssistantTaskIdRef.current = null;
        setPendingAssistantTaskId(null);
      }
      try {
        const res = await apiFetch(`/api/workbench/sessions/${sessionId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: content, intent }),
        });
        if (!res.ok) throw new Error(await res.text());
        const result = (await res.json()) as WorkbenchMessageResult;
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
        const latestMessage = result.messages?.[result.messages.length - 1];
        shouldClearPendingAssistant =
          !expectsAssistantResponse ||
          latestMessage?.role === 'assistant' ||
          latestMessage?.role === 'system';
        queryClient.invalidateQueries({ queryKey: ['sessions'] });
        queryClient.invalidateQueries({ queryKey: ['sessionRuns', sessionId] });
        return result;
      } catch (error) {
        shouldClearPendingAssistant = true;
        throw error;
      } finally {
        setIsChatSubmitting(false);
        chatSubmitStartedAtRef.current = null;
        chatSubmitTransportRef.current = null;
        if (!pendingChatRunIdRef.current) {
          pendingChatRunIdRef.current = null;
          setPendingChatRunId(null);
        }
        if (shouldClearPendingAssistant) {
          pendingAssistantTaskIdRef.current = null;
          setPendingAssistantTaskId(null);
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
    mcpServers,
    agentHooks,
    createMcpServer: async (input) => {
      const res = await apiFetch('/api/settings/mcp/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error(await res.text());
      const server = (await res.json()) as McpServerConfig;
      queryClient.invalidateQueries({ queryKey: ['mcpServers'] });
      return server;
    },
    importMcpServers: async (text, testAfterImport = true) => {
      const res = await apiFetch('/api/settings/mcp/servers/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, testAfterImport }),
      });
      if (!res.ok) throw new Error(await res.text());
      const result = (await res.json()) as McpServerImportResult;
      queryClient.invalidateQueries({ queryKey: ['mcpServers'] });
      return result;
    },
    updateMcpServer: async (id, input) => {
      const res = await apiFetch(`/api/settings/mcp/servers/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error(await res.text());
      const server = (await res.json()) as McpServerConfig;
      queryClient.invalidateQueries({ queryKey: ['mcpServers'] });
      return server;
    },
    deleteMcpServer: async (id) => {
      const res = await apiFetch(`/api/settings/mcp/servers/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
      queryClient.invalidateQueries({ queryKey: ['mcpServers'] });
    },
    testMcpServer: async (id) => {
      const res = await apiFetch(`/api/settings/mcp/servers/${id}/test`, { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      const result = (await res.json()) as McpServerTestResult;
      queryClient.invalidateQueries({ queryKey: ['mcpServers'] });
      return result;
    },
    createAgentHook: async (input) => {
      const res = await apiFetch('/api/settings/hooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error(await res.text());
      const hook = (await res.json()) as AgentHookConfig;
      queryClient.invalidateQueries({ queryKey: ['agentHooks'] });
      return hook;
    },
    updateAgentHook: async (id, input) => {
      const res = await apiFetch(`/api/settings/hooks/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error(await res.text());
      const hook = (await res.json()) as AgentHookConfig;
      queryClient.invalidateQueries({ queryKey: ['agentHooks'] });
      return hook;
    },
    deleteAgentHook: async (id) => {
      const res = await apiFetch(`/api/settings/hooks/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
      queryClient.invalidateQueries({ queryKey: ['agentHooks'] });
    },
    testAgentHook: async (id) => {
      const res = await apiFetch(`/api/settings/hooks/${id}/test`, { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      const result = (await res.json()) as AgentHookTestResult;
      queryClient.invalidateQueries({ queryKey: ['agentHooks'] });
      return result;
    },
    setActiveProvider: async (provider) => {
      const merged = { ...(llmSettings || {}), ACTIVE_LLM_PROVIDER: provider } as LlmSettings;
      const res = await apiFetch('/api/settings/llm', {
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
      const res = await apiFetch('/api/settings/llm', {
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
      const res = await apiFetch('/api/settings/llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(merged),
      });
      if (!res.ok) throw new Error('Failed to save model settings');
      queryClient.invalidateQueries({ queryKey: ['llmSettings'] });
      queryClient.invalidateQueries({ queryKey: ['llmModelOptions'] });
    },
    runLlmSmokeTest: async () => {
      const res = await apiFetch('/api/settings/llm/smoke', { method: 'POST' });
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
        const res = await apiFetch(
          `/api/repositories/${activeProjectId}/files?${params.toString()}`
        );
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

function normalizeActivityReplay(data: unknown): ActivityReplay {
  if (Array.isArray(data)) return { events: data as ActivityEvent[], artifacts: [] };
  if (!data || typeof data !== 'object') return emptyActivityReplay;
  const replay = data as Partial<ActivityReplay>;
  return {
    events: Array.isArray(replay.events) ? replay.events : [],
    artifacts: Array.isArray(replay.artifacts) ? replay.artifacts : [],
  };
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
