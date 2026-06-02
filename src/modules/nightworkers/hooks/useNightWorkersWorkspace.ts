import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Dispatch, SetStateAction } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { client } from '../../../lib/api';
import { dedupeAndSortRunEvents, mergeRunEvents } from '../realtimeEvents';
import type {
  CreateProjectInput,
  CreateSessionInput,
  LlmProvider,
  LlmSettings,
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
} from '../types';

type FolderDir = { name: string; path: string };
type RealtimeStatus = 'initializing' | 'connecting' | 'connected' | 'disconnected';

export type NightWorkersWorkspaceState = {
  projects: Repository[];
  sessions: Task[];
  activeSessionId: string | null;
  activeSession: Task | null;
  activeProject: Repository | null;
  activeSessionRuns: TaskRun[];
  latestRun: TaskRun | undefined;
  taskMessages: TaskMessage[];
  latestRunEvents: TaskEvent[];
  latestRunTodos: TaskRunTodo[];
  isRealtimeConnected: boolean;
  realtimeStatus: RealtimeStatus;
  isChatSubmitting: boolean;
  isProjectsLoading: boolean;
  isSessionsLoading: boolean;
  isAgentWorking: boolean;
  isAgentThinking: boolean;
  expandedProjects: Record<string, boolean>;
  setExpandedProjects: Dispatch<SetStateAction<Record<string, boolean>>>;
  setActiveSessionId: (id: string | null) => void;
  createProject: (input: CreateProjectInput) => void;
  deleteProject: (id: string) => void;
  deleteSession: (id: string) => void;
  createSession: (input: CreateSessionInput) => Promise<Task>;
  startRun: (sessionId: string) => Promise<TaskRun>;
  reviewRun: (input: ReviewRunInput) => Promise<{
    ok: boolean;
    status: string;
    outcome: ReviewOutcome;
    reviewResult: ReviewResult;
  }>;
  sendChatMessage: (sessionId: string, prompt: string) => Promise<void>;
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
};

export function useNightWorkersWorkspace(): NightWorkersWorkspaceState {
  const queryClient = useQueryClient();
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  const [currentBrowserPath, setCurrentBrowserPath] = useState<string | null>(null);
  const [browserDirectories, setBrowserDirectories] = useState<FolderDir[]>([]);
  const [browserParentPath, setBrowserParentPath] = useState<string | null>(null);
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
      const res = await client.repositories.$post({ json: data });
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
      const res = await client.tasks.$post({ json: data });
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
      const res = await client.tasks[':id'].$delete({ param: { id } });
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
      const res = await client.tasks[':id'].run.$post({ param: { id: sessionId } });
      if (!res.ok) throw new Error('Failed to start run');
      return (await res.json()) as TaskRun;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({ queryKey: ['sessionRuns', activeSessionId] });
    },
  });

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? null,
    [activeSessionId, sessions]
  );
  const activeProject = useMemo(
    () =>
      activeSession ? (projects.find((p) => p.id === activeSession.repositoryId) ?? null) : null,
    [activeSession, projects]
  );

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
    activeSessionId,
    activeSession,
    activeProject,
    activeSessionRuns,
    latestRun,
    taskMessages,
    latestRunEvents,
    latestRunTodos,
    isRealtimeConnected,
    realtimeStatus,
    isChatSubmitting,
    isProjectsLoading,
    isSessionsLoading,
    isAgentWorking,
    isAgentThinking,
    expandedProjects,
    setExpandedProjects,
    setActiveSessionId,
    createProject: (input) => createProjectMutation.mutate(input),
    deleteProject: (id) => deleteProjectMutation.mutate(id),
    deleteSession: (id) => deleteSessionMutation.mutate(id),
    createSession: (input) => createSessionMutation.mutateAsync(input),
    startRun: (sessionId) => startRunMutation.mutateAsync(sessionId),
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
      const now = Date.now();
      const lastSubmit = lastSubmitRef.current;
      if (
        lastSubmit &&
        lastSubmit.taskId === sessionId &&
        lastSubmit.prompt === content &&
        now - lastSubmit.at < 1500
      ) {
        return;
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

function isActiveTaskStatus(status: string | undefined): boolean {
  return (
    status === 'running' ||
    status === 'context_compiling' ||
    status === 'compiling_context' ||
    status === 'finalizing'
  );
}
