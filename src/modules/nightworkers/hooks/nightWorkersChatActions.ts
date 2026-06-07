import type { QueryClient } from '@tanstack/react-query';
import type { MutableRefObject } from 'react';
import { apiFetch } from '../../../lib/api-base';
import type { Task, TaskMessage, WorkbenchChatIntent } from '../types';
import type { WorkbenchMessageResult } from './nightWorkersWorkspaceState';

type ChatActionsInput = {
  queryClient: QueryClient;
  wsRef: MutableRefObject<WebSocket | null>;
  lastSubmitRef: MutableRefObject<{ taskId: string; prompt: string; at: number } | null>;
  pendingChatQueueRef: MutableRefObject<Array<{ taskId: string; prompt: string }>>;
  chatSubmitStartedAtRef: MutableRefObject<number | null>;
  chatSubmitTransportRef: MutableRefObject<'http' | 'websocket' | null>;
  pendingChatRunIdRef: MutableRefObject<string | null>;
  pendingAssistantTaskIdRef: MutableRefObject<string | null>;
  setIsChatSubmitting: (value: boolean) => void;
  setPendingChatRunId: (value: string | null) => void;
  setPendingAssistantTaskId: (value: string | null) => void;
};

function appendOptimisticUserMessage(
  sessionId: string,
  content: string,
  lastSubmitRef: ChatActionsInput['lastSubmitRef'],
  queryClient: QueryClient
): boolean {
  const now = Date.now();
  const lastSubmit = lastSubmitRef.current;
  if (
    lastSubmit &&
    lastSubmit.taskId === sessionId &&
    lastSubmit.prompt === content &&
    now - lastSubmit.at < 1500
  )
    return false;
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

export function createNightWorkersChatActions(input: ChatActionsInput) {
  const {
    queryClient,
    wsRef,
    lastSubmitRef,
    pendingChatQueueRef,
    chatSubmitStartedAtRef,
    chatSubmitTransportRef,
    pendingChatRunIdRef,
    pendingAssistantTaskIdRef,
    setIsChatSubmitting,
    setPendingChatRunId,
    setPendingAssistantTaskId,
  } = input;
  return {
    sendChatMessage: async (sessionId: string, prompt: string) => {
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
    sendWorkbenchMessage: async (
      sessionId: string,
      prompt: string,
      intent: WorkbenchChatIntent
    ) => {
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
  };
}
