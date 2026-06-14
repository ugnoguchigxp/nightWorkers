import { readNightWorkersRuntimeEnv } from '../runtime-env';
import type { AgentRuntimeKind } from './types';

export type RuntimeLane = 'native-supervisor' | 'codex-sdk';
export type RuntimeLaneAlias = RuntimeLane | 'native-local' | 'codex-agent';
export type RuntimeLaneSource = 'task' | 'queue' | 'settings' | 'env' | 'provider_default';

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
  envRuntimeLane?: unknown;
  envActiveLlmProvider?: unknown;
  envCodexEnabled?: unknown;
};

export function readRuntimeLaneConfigFromEnv(env: NodeJS.ProcessEnv = process.env) {
  const runtimeEnv = readNightWorkersRuntimeEnv(env);
  return {
    envRuntimeLane: runtimeEnv.NIGHTWORKERS_RUNTIME_LANE,
    envActiveLlmProvider: runtimeEnv.ACTIVE_LLM_PROVIDER,
    envCodexEnabled: runtimeEnv.CODEX_ENABLED,
  } satisfies Pick<RuntimeLaneInput, 'envRuntimeLane' | 'envActiveLlmProvider' | 'envCodexEnabled'>;
}

export function resolveRuntimeLane(input: RuntimeLaneInput = {}): RuntimeLaneResolution {
  const diagnostics: RuntimeLaneResolution['diagnostics'] = [];
  const candidates: Array<{ source: RuntimeLaneSource; value: unknown }> = [
    { source: 'task', value: input.taskRuntimeLane },
    { source: 'queue', value: input.queueRuntimeLane },
    { source: 'settings', value: input.settingsRuntimeLane },
    { source: 'env', value: input.envRuntimeLane },
  ];

  for (const candidate of candidates) {
    if (candidate.value === undefined || candidate.value === null || candidate.value === '') {
      continue;
    }
    const lane = normalizeRuntimeLane(candidate.value);
    if (lane) {
      if (isLegacyRuntimeLaneAlias(candidate.value, lane)) {
        diagnostics.push({
          level: 'info',
          message: `Runtime lane "${String(candidate.value)}" is a compatibility alias for "${lane}".`,
        });
      }
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
      : typeof input.envActiveLlmProvider === 'string'
        ? input.envActiveLlmProvider
        : null;
  const codexEnabled =
    typeof input.codexEnabled === 'boolean'
      ? input.codexEnabled
      : String(input.envCodexEnabled || '').toLowerCase() === 'true';
  if (activeProvider === 'codex' && codexEnabled) {
    diagnostics.push({
      level: 'warning',
      message:
        'ACTIVE_LLM_PROVIDER=codex is a legacy implementation-lane default. Set IMPLEMENTATION_RUNTIME_LANE=codex-sdk instead.',
    });
    return {
      lane: 'codex-sdk',
      workerKind: 'codex-agent',
      source: 'provider_default',
      diagnostics,
    };
  }

  return {
    lane: 'native-supervisor',
    workerKind: 'native-local',
    source: 'provider_default',
    diagnostics,
  };
}

export function normalizeRuntimeLane(value: unknown): RuntimeLane | null {
  if (value === 'native-supervisor' || value === 'native-local') return 'native-supervisor';
  if (value === 'codex-sdk' || value === 'codex-agent') return 'codex-sdk';
  return null;
}

function isLegacyRuntimeLaneAlias(value: unknown, lane: RuntimeLane) {
  return (
    (value === 'native-local' && lane === 'native-supervisor') ||
    (value === 'codex-agent' && lane === 'codex-sdk')
  );
}

function runtimeLaneToWorkerKind(
  lane: RuntimeLane
): Extract<AgentRuntimeKind, 'native-local' | 'codex-agent'> {
  return lane === 'codex-sdk' ? 'codex-agent' : 'native-local';
}
