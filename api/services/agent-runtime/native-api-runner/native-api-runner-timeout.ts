export function createNativeApiTimeoutSignal(
  parent: AbortSignal | undefined,
  runSignal: AbortSignal,
  timeoutSeconds: number
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error(`NativeApiRunner timed out after ${timeoutSeconds}s`));
  }, Math.max(1, timeoutSeconds) * 1000);
  const abortFromParent = () => controller.abort(parent?.reason);
  const abortFromRun = () => controller.abort(runSignal.reason);
  if (parent?.aborted) {
    abortFromParent();
  } else {
    parent?.addEventListener('abort', abortFromParent, { once: true });
  }
  if (runSignal.aborted) {
    abortFromRun();
  } else {
    runSignal.addEventListener('abort', abortFromRun, { once: true });
  }
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timeout);
      parent?.removeEventListener('abort', abortFromParent);
      runSignal.removeEventListener('abort', abortFromRun);
    },
  };
}

export function createNativeApiAttemptTimeoutSignal(parent: AbortSignal, timeoutMs?: number) {
  const controller = new AbortController();
  let timedOut = false;
  const effectiveTimeoutMs =
    Number.isFinite(timeoutMs) && (timeoutMs ?? 0) > 0 ? Math.floor(timeoutMs ?? 0) : 0;
  const timeout =
    effectiveTimeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          controller.abort(
            new Error(
              `NativeApiRunner provider route attempt timed out after ${effectiveTimeoutMs}ms`
            )
          );
        }, effectiveTimeoutMs)
      : null;
  const abortFromParent = () => controller.abort(parent.reason);
  if (parent.aborted) {
    abortFromParent();
  } else {
    parent.addEventListener('abort', abortFromParent, { once: true });
  }
  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    dispose: () => {
      if (timeout) clearTimeout(timeout);
      parent.removeEventListener('abort', abortFromParent);
    },
  };
}
