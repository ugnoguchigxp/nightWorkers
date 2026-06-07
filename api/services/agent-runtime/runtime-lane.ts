import type { AgentRuntimeKind } from './types';

export type RuntimeLane = 'native-supervisor' | 'codex-agent';
export type RuntimeLaneSource = 'task' | 'queue' | 'settings' | 'env_default';

export type RuntimeLaneResolution = {
  lane: RuntimeLane;
  workerKind: Extract<AgentRuntimeKind, 'native-local' | 'codex-agent'>;
  source: RuntimeLaneSource;
  diagnostics: Array<{ level: 'info' | 'warning'; message: string }>;
};

export type RuntimeLaneInput = {
  taskRuntimeLane?: unknown;
  queueRuntimeLane?: unknown;
  settingsRuntimeLane?: unknown;
  activeLlmProvider?: unknown;
  codexEnabled?: unknown;
  env?: NodeJS.ProcessEnv;
};

export function resolveRuntimeLane(input: RuntimeLaneInput = {}): RuntimeLaneResolution {
  const diagnostics: RuntimeLaneResolution['diagnostics'] = [];
  const env = input.env ?? process.env;
  const candidates: Array<{ source: RuntimeLaneSource; value: unknown }> = [
    { source: 'task', value: input.taskRuntimeLane },
    { source: 'queue', value: input.queueRuntimeLane },
    { source: 'settings', value: input.settingsRuntimeLane },
    { source: 'env_default', value: env.NIGHTWORKERS_RUNTIME_LANE },
  ];

  for (const candidate of candidates) {
    if (candidate.value === undefined || candidate.value === null || candidate.value === '') {
      continue;
    }
    const lane = normalizeRuntimeLane(candidate.value);
    if (lane) {
      return {
        lane,
        workerKind: runtimeLaneToWorkerKind(lane),
        source: candidate.source,
        diagnostics,
      };
    }
    diagnostics.push({
      level: 'warning',
      message: `Ignoring unsupported runtime lane from ${candidate.source}: ${String(candidate.value)}`,
    });
  }

  const activeProvider =
    typeof input.activeLlmProvider === 'string'
      ? input.activeLlmProvider
      : typeof env.ACTIVE_LLM_PROVIDER === 'string'
        ? env.ACTIVE_LLM_PROVIDER
        : null;
  const codexEnabled =
    typeof input.codexEnabled === 'boolean'
      ? input.codexEnabled
      : String(env.CODEX_ENABLED || '').toLowerCase() === 'true';
  if (activeProvider === 'codex' && codexEnabled) {
    return {
      lane: 'codex-agent',
      workerKind: 'codex-agent',
      source: 'settings',
      diagnostics,
    };
  }

  return {
    lane: 'native-supervisor',
    workerKind: 'native-local',
    source: 'env_default',
    diagnostics,
  };
}

export function normalizeRuntimeLane(value: unknown): RuntimeLane | null {
  if (value === 'native-supervisor' || value === 'native-local') return 'native-supervisor';
  if (value === 'codex-agent') return 'codex-agent';
  return null;
}

function runtimeLaneToWorkerKind(
  lane: RuntimeLane
): Extract<AgentRuntimeKind, 'native-local' | 'codex-agent'> {
  return lane === 'codex-agent' ? 'codex-agent' : 'native-local';
}
