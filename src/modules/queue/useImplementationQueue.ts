import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ImplementationQueueDashboard,
  ImplementationQueueHealth,
} from '../nightworkers/types';
import {
  archiveImplementationQueueEntry,
  cancelImplementationQueueEntry,
  createImplementationQueueEntry,
  fetchImplementationQueue,
  fetchImplementationQueueHealth,
  recoverImplementationQueueEntry,
  requeueImplementationQueueEntry,
  updateImplementationQueueEntry,
  updateImplementationQueueSettings,
} from './queueCommands';

function invalidateQueueState(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['implementationQueue'] });
  queryClient.invalidateQueries({ queryKey: ['implementationQueueHealth'] });
}

export function useImplementationQueue() {
  const queryClient = useQueryClient();
  const { data: implementationQueue = null, isLoading: isImplementationQueueLoading } = useQuery({
    queryKey: ['implementationQueue'],
    queryFn: async () => {
      const res = await fetchImplementationQueue();
      if (!res.ok) throw new Error('Failed to fetch implementation queue');
      return (await res.json()) as ImplementationQueueDashboard;
    },
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const { data: implementationQueueHealth = null, isLoading: isImplementationQueueHealthLoading } =
    useQuery({
      queryKey: ['implementationQueueHealth'],
      queryFn: async () => {
        const res = await fetchImplementationQueueHealth();
        if (!res.ok) throw new Error('Failed to fetch implementation queue health');
        return (await res.json()) as ImplementationQueueHealth;
      },
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    });

  const createImplementationQueueEntryMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      const res = await createImplementationQueueEntry(sessionId);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      invalidateQueueState(queryClient);
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });

  const archiveImplementationQueueEntryMutation = useMutation({
    mutationFn: async (entryId: string) => {
      const res = await archiveImplementationQueueEntry(entryId);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => invalidateQueueState(queryClient),
  });

  const removeImplementationQueueEntryMutation = useMutation({
    mutationFn: async (entryId: string) => {
      const cancelRes = await cancelImplementationQueueEntry(entryId);
      if (!cancelRes.ok) throw new Error(await cancelRes.text());
      const archiveRes = await archiveImplementationQueueEntry(entryId);
      if (!archiveRes.ok) throw new Error(await archiveRes.text());
      return archiveRes.json();
    },
    onSuccess: () => {
      invalidateQueueState(queryClient);
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });

  const requeueImplementationQueueEntryMutation = useMutation({
    mutationFn: async (input: { entryId: string; note?: string }) => {
      const res = await requeueImplementationQueueEntry(input.entryId, { note: input.note });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      invalidateQueueState(queryClient);
      queryClient.invalidateQueries({ queryKey: ['sessionRuns'] });
    },
  });

  const updateImplementationQueueEntryMutation = useMutation({
    mutationFn: async (input: {
      entryId: string;
      data: { queuePosition?: number | null; priority?: number };
    }) => {
      const res = await updateImplementationQueueEntry(input.entryId, input.data);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      invalidateQueueState(queryClient);
    },
  });

  const updateImplementationQueueProcessorCountMutation = useMutation({
    mutationFn: async (processorCount: number) => {
      const res = await updateImplementationQueueSettings({ processorCount });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => invalidateQueueState(queryClient),
  });

  const recoverImplementationQueueEntryMutation = useMutation({
    mutationFn: async (input: {
      entryId: string;
      action: 'retry' | 'mark_needs_human' | 'cancel' | 'archive' | 'complete';
      note?: string;
    }) => {
      const res = await recoverImplementationQueueEntry(input.entryId, {
        action: input.action,
        note: input.note,
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({ queryKey: ['sessionRuns'] });
      invalidateQueueState(queryClient);
    },
  });

  return {
    implementationQueue,
    implementationQueueHealth,
    isImplementationQueueLoading,
    isImplementationQueueHealthLoading,
    createImplementationQueueEntry: async (sessionId: string) => {
      await createImplementationQueueEntryMutation.mutateAsync(sessionId);
    },
    archiveImplementationQueueEntry: async (entryId: string) => {
      await archiveImplementationQueueEntryMutation.mutateAsync(entryId);
    },
    removeImplementationQueueEntry: async (entryId: string) => {
      await removeImplementationQueueEntryMutation.mutateAsync(entryId);
    },
    requeueImplementationQueueEntry: async (entryId: string, note?: string) => {
      await requeueImplementationQueueEntryMutation.mutateAsync({ entryId, note });
    },
    updateImplementationQueueEntry: async (
      entryId: string,
      input: { queuePosition?: number | null; priority?: number }
    ) => {
      await updateImplementationQueueEntryMutation.mutateAsync({ entryId, data: input });
    },
    updateImplementationQueueProcessorCount: async (processorCount: number) => {
      await updateImplementationQueueProcessorCountMutation.mutateAsync(processorCount);
    },
    recoverImplementationQueueEntry: async (
      entryId: string,
      action: 'retry' | 'mark_needs_human' | 'cancel' | 'archive' | 'complete',
      note?: string
    ) => {
      await recoverImplementationQueueEntryMutation.mutateAsync({ entryId, action, note });
    },
  };
}
