import { apiFetch } from '../../lib/api-base';
import { jsonRequest } from '../../lib/api-request';

export function fetchImplementationQueue() {
  return apiFetch('/api/implementation-queue');
}

export function fetchImplementationQueueHealth() {
  return apiFetch('/api/implementation-queue/health');
}

export function createImplementationQueueEntry(sessionId: string) {
  return apiFetch('/api/implementation-queue/entries', jsonRequest('POST', { taskId: sessionId }));
}

export function archiveImplementationQueueEntry(entryId: string) {
  return apiFetch(`/api/implementation-queue/entries/${entryId}/archive`, { method: 'POST' });
}

export function cancelImplementationQueueEntry(entryId: string) {
  return apiFetch(
    `/api/implementation-queue/entries/${entryId}`,
    jsonRequest('PATCH', { action: 'cancel' })
  );
}

export function updateImplementationQueueEntry(
  entryId: string,
  input: { queuePosition?: number | null; priority?: number }
) {
  return apiFetch(`/api/implementation-queue/entries/${entryId}`, jsonRequest('PATCH', input));
}

export function requeueImplementationQueueEntry(entryId: string, input: { note?: string }) {
  return apiFetch(
    `/api/implementation-queue/entries/${entryId}/requeue`,
    jsonRequest('POST', input)
  );
}

export function recoverImplementationQueueEntry(
  entryId: string,
  input: { action: 'retry' | 'mark_needs_human' | 'cancel' | 'archive' | 'complete'; note?: string }
) {
  return apiFetch(
    `/api/implementation-queue/entries/${entryId}/recover`,
    jsonRequest('POST', input)
  );
}

export function updateImplementationQueueSettings(input: { processorCount: number }) {
  return apiFetch('/api/implementation-queue/settings', jsonRequest('PATCH', input));
}
