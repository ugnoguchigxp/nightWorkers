import type { QueryClient } from '@tanstack/react-query';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { useEffect } from 'react';
import { devWsFallbackPath, wsPath } from '../../../lib/api-base';
import { dedupeAndSortActivityEvents } from '../activityTranscript';
import {
  dedupeAndSortRunEvents,
  getRealtimeMessageDedupeKey,
  mergeRealtimeRunDetails,
  mergeRealtimeRunList,
  mergeRealtimeTodoIntoRunDetails,
} from '../realtimeEvents';
import type {
  ActivityEvent,
  ActivityReplay,
  ProjectFileEntry,
  RunDetails,
  Task,
  TaskEvent,
  TaskMessage,
  TaskRun,
  TaskRunTodo,
} from '../types';

type RealtimeStatus = 'initializing' | 'connecting' | 'connected' | 'disconnected';
const emptyActivityReplay: ActivityReplay = { events: [], artifacts: [] };

type UseNightWorkersRealtimeInput = {
  activeSessionId: string | null;
  queryClient: QueryClient;
  wsRef: MutableRefObject<WebSocket | null>;
  latestRunSubscriptionRef: MutableRefObject<{ runId: string | null; afterSeq?: number }>;
  pendingChatQueueRef: MutableRefObject<Array<{ taskId: string; prompt: string }>>;
  processedRealtimeMessageKeysRef: MutableRefObject<Set<string>>;
  pendingChatRunIdRef: MutableRefObject<string | null>;
  pendingAssistantTaskIdRef: MutableRefObject<string | null>;
  chatSubmitStartedAtRef: MutableRefObject<number | null>;
  setIsRealtimeConnected: Dispatch<SetStateAction<boolean>>;
  setRealtimeStatus: Dispatch<SetStateAction<RealtimeStatus>>;
  setBufferedEventsByRun: Dispatch<SetStateAction<Record<string, TaskEvent[]>>>;
  setStreamingTextByTask: Dispatch<SetStateAction<Record<string, string>>>;
  setIsChatSubmitting: Dispatch<SetStateAction<boolean>>;
  setPendingChatRunId: Dispatch<SetStateAction<string | null>>;
  setPendingAssistantTaskId: Dispatch<SetStateAction<string | null>>;
  setProjectFileEntriesByDirectory: Dispatch<SetStateAction<Record<string, ProjectFileEntry[]>>>;
};

function isTerminalRunStatus(status: string | undefined): boolean {
  return (
    status === 'completed' ||
    status === 'needs_review' ||
    status === 'needs_human' ||
    status === 'failed' ||
    status === 'blocked' ||
    status === 'timed_out' ||
    status === 'cancelled'
  );
}

export function useNightWorkersRealtime({
  activeSessionId,
  queryClient,
  wsRef,
  latestRunSubscriptionRef,
  pendingChatQueueRef,
  processedRealtimeMessageKeysRef,
  pendingChatRunIdRef,
  pendingAssistantTaskIdRef,
  chatSubmitStartedAtRef,
  setIsRealtimeConnected,
  setRealtimeStatus,
  setBufferedEventsByRun,
  setStreamingTextByTask,
  setIsChatSubmitting,
  setPendingChatRunId,
  setPendingAssistantTaskId,
  setProjectFileEntriesByDirectory,
}: UseNightWorkersRealtimeInput) {
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
              todo?: TaskRunTodo;
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
            if (incoming.metadataJson?.intent === 'design_questionnaire_ready') {
              void queryClient.invalidateQueries({
                queryKey: ['specificationWorkspace', incoming.taskId],
              });
            }
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
              return mergeRealtimeRunList(prev, incomingRun);
            });
            queryClient.setQueryData<RunDetails | null>(
              ['runDetails', incomingRun.id],
              (prev) => mergeRealtimeRunDetails(prev, incomingRun) ?? prev
            );
            queryClient.invalidateQueries({ queryKey: ['runDetails', incomingRun.id] });
            queryClient.invalidateQueries({ queryKey: ['implementationQueue'] });
            if (isTerminalRunStatus(incomingRun.status) && incomingRun.repositoryId) {
              setProjectFileEntriesByDirectory({});
              queryClient.invalidateQueries({
                queryKey: ['projectFiles', incomingRun.repositoryId],
              });
              queryClient.removeQueries({ queryKey: ['projectFile', incomingRun.repositoryId] });
            }
          }
          if (msg.type === 'task_run_updated' && msg.payload?.todo) {
            const incomingTodo = msg.payload.todo as TaskRunTodo;
            queryClient.setQueryData<RunDetails | null>(
              ['runDetails', incomingTodo.runId],
              (prev) => mergeRealtimeTodoIntoRunDetails(prev, incomingTodo) ?? prev
            );
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
  }, [
    activeSessionId,
    queryClient,
    wsRef,
    latestRunSubscriptionRef,
    pendingChatQueueRef,
    processedRealtimeMessageKeysRef,
    pendingChatRunIdRef,
    pendingAssistantTaskIdRef,
    chatSubmitStartedAtRef,
    setIsRealtimeConnected,
    setRealtimeStatus,
    setBufferedEventsByRun,
    setStreamingTextByTask,
    setIsChatSubmitting,
    setPendingChatRunId,
    setPendingAssistantTaskId,
    setProjectFileEntriesByDirectory,
  ]);
}
