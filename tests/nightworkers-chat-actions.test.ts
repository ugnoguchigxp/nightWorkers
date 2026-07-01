import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { createNightWorkersChatActions } from '../src/modules/nightworkers/hooks/nightWorkersChatActions';
import { appendWorkbenchMessage } from '../src/modules/nightworkers/nightWorkersCommands';

vi.mock('../src/modules/nightworkers/nightWorkersCommands', () => ({
  appendWorkbenchMessage: vi.fn(),
}));

describe('createNightWorkersChatActions', () => {
  it('aborts the pending workbench intake request when chat submit is cancelled', async () => {
    const setIsChatSubmitting = vi.fn();
    const setPendingChatRunId = vi.fn();
    const setPendingAssistantTaskId = vi.fn();
    let observedSignal: AbortSignal | undefined;

    vi.mocked(appendWorkbenchMessage).mockImplementation(
      (_sessionId, _input, init) =>
        new Promise<Response>((_resolve, reject) => {
          observedSignal = init?.signal;
          init?.signal?.addEventListener('abort', () => {
            reject(init.signal?.reason ?? new DOMException('Aborted', 'AbortError'));
          });
        })
    );

    const actions = createNightWorkersChatActions({
      queryClient: new QueryClient(),
      wsRef: { current: null },
      lastSubmitRef: { current: null },
      pendingChatQueueRef: { current: [] },
      chatSubmitStartedAtRef: { current: null },
      chatSubmitTransportRef: { current: null },
      pendingChatRunIdRef: { current: null },
      pendingAssistantTaskIdRef: { current: null },
      pendingChatAbortControllerRef: { current: null },
      setIsChatSubmitting,
      setPendingChatRunId,
      setPendingAssistantTaskId,
    });

    const sendPromise = actions.sendWorkbenchMessage('task-1', 'Plan this', 'intake');
    await Promise.resolve();

    expect(observedSignal?.aborted).toBe(false);
    await actions.cancelChatSubmit();

    expect(observedSignal?.aborted).toBe(true);
    await expect(sendPromise).rejects.toMatchObject({ name: 'AbortError' });
    expect(setIsChatSubmitting).toHaveBeenLastCalledWith(false);
    expect(setPendingChatRunId).toHaveBeenLastCalledWith(null);
    expect(setPendingAssistantTaskId).toHaveBeenLastCalledWith(null);
  });
});
