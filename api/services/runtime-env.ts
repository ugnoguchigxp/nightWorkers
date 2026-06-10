export type NightWorkersRuntimeEnv = Pick<
  NodeJS.ProcessEnv,
  | 'ACTIVE_LLM_PROVIDER'
  | 'CODEX_ENABLED'
  | 'NIGHTWORKERS_RUNTIME_LANE'
  | 'NIGHTWORKERS_DISABLE_AUTO_QUEUE_DRAIN'
  | 'NODE_ENV'
  | 'SESSION_QUEUE_MAX_CONCURRENCY'
>;

export function readNightWorkersRuntimeEnv(
  env: NodeJS.ProcessEnv = process.env
): NightWorkersRuntimeEnv {
  return {
    ACTIVE_LLM_PROVIDER: env.ACTIVE_LLM_PROVIDER,
    CODEX_ENABLED: env.CODEX_ENABLED,
    NIGHTWORKERS_RUNTIME_LANE: env.NIGHTWORKERS_RUNTIME_LANE,
    NIGHTWORKERS_DISABLE_AUTO_QUEUE_DRAIN: env.NIGHTWORKERS_DISABLE_AUTO_QUEUE_DRAIN,
    NODE_ENV: env.NODE_ENV,
    SESSION_QUEUE_MAX_CONCURRENCY: env.SESSION_QUEUE_MAX_CONCURRENCY,
  };
}

export function isAutoQueueDrainEnabled(
  env: NightWorkersRuntimeEnv = readNightWorkersRuntimeEnv()
) {
  return env.NIGHTWORKERS_DISABLE_AUTO_QUEUE_DRAIN !== 'true';
}

export function shouldWaitForWorkbenchIntakeInTests(
  env: NightWorkersRuntimeEnv = readNightWorkersRuntimeEnv()
) {
  return env.NODE_ENV === 'test';
}

export function getSessionQueueMaxConcurrencyFromEnv(
  env: NightWorkersRuntimeEnv = readNightWorkersRuntimeEnv()
) {
  const parsed = Number(env.SESSION_QUEUE_MAX_CONCURRENCY || 2);
  if (!Number.isFinite(parsed)) return 2;
  return Math.max(1, Math.floor(parsed));
}
