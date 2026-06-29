type QueueDrainRunner = () => Promise<unknown> | unknown;

let queueDrainRunner: QueueDrainRunner | null = null;

export function configureQueueDrainRunner(runner: QueueDrainRunner) {
  queueDrainRunner = runner;
}

export function triggerConfiguredQueueDrain() {
  if (!queueDrainRunner) return;
  void queueDrainRunner();
}
