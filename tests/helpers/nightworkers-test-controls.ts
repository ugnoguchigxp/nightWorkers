export async function flushPendingWorkbenchTasks() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => setImmediate(resolve));
}

export function disableAutoQueueDrainForTest() {
  process.env.NIGHTWORKERS_DISABLE_AUTO_QUEUE_DRAIN = 'true';
}

export function restoreAutoQueueDrainForTest() {
  delete process.env.NIGHTWORKERS_DISABLE_AUTO_QUEUE_DRAIN;
}
