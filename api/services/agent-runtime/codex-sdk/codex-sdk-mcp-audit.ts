import type { CodexContractWarning } from '../types';
import {
  type CodexRuntimeMcpConfigState,
  resolveCodexRuntimeMcpConfigState,
} from './codex-sdk-runtime-config';

export type RuntimeTodoEvidence = {
  id: string;
  seq: number;
  title: string;
  procedureId?: string | null;
};

export type RuntimeTodoEvidenceReadResult = {
  todo: RuntimeTodoEvidence | null;
  source: 'db' | 'context' | 'none';
  dbReadFailed: boolean;
};

export type CodexRuntimeAuditState = {
  sawNightworkersTodoReplace: boolean;
  sawAnyNightworkersTodo: boolean;
  sawNightworkersImportProjectSuccess: boolean;
  sawNightworkersImportProjectFailure: boolean;
  mcpDegraded: boolean;
  observedNightWorkersTools: Set<string>;
  contractWarnings: CodexContractWarning[];
  lastCurrentTodo: RuntimeTodoEvidence | null;
  eventSequence: number;
  importProjectSuccessSequence: number | null;
  importProjectProviderItemId: string | null;
  recommendedVerificationCommands: string[];
  verificationEvidence: Array<{
    sequence: number;
    command: string | null;
    normalizedCommand: string | null;
    commandClass: string | null;
    exitCode: number | null;
  }>;
  sawHighRiskNativeImportCommand: boolean;
  highRiskNativeImportCommand: string | null;
  highRiskNativeImportProviderItemId: string | null;
  mcpConfig: CodexRuntimeMcpConfigState;
};

export function createCodexRuntimeAuditState(): CodexRuntimeAuditState {
  return {
    sawNightworkersTodoReplace: false,
    sawAnyNightworkersTodo: false,
    sawNightworkersImportProjectSuccess: false,
    sawNightworkersImportProjectFailure: false,
    mcpDegraded: false,
    observedNightWorkersTools: new Set(),
    contractWarnings: [],
    lastCurrentTodo: null,
    eventSequence: 0,
    importProjectSuccessSequence: null,
    importProjectProviderItemId: null,
    recommendedVerificationCommands: [],
    verificationEvidence: [],
    sawHighRiskNativeImportCommand: false,
    highRiskNativeImportCommand: null,
    highRiskNativeImportProviderItemId: null,
    mcpConfig: resolveCodexRuntimeMcpConfigState(),
  };
}

export function buildCodexRuntimeContractSnapshot(state: CodexRuntimeAuditState) {
  return {
    lane: 'codex-sdk',
    warnings: state.contractWarnings,
    mcp: {
      configSource: state.mcpConfig.source,
      expectedTools: state.mcpConfig.expectedTools,
      hasInlineNightWorkersMcp: state.mcpConfig.hasInlineNightWorkersMcp,
      serverName: state.mcpConfig.serverName,
      observedNightWorkersTools: [...state.observedNightWorkersTools],
      degraded: state.mcpDegraded,
    },
  };
}

export function addContractWarning(state: CodexRuntimeAuditState, warning: CodexContractWarning) {
  const normalized = normalizeContractWarning(warning);
  const key = [
    normalized.code,
    normalized.providerItemId ?? '',
    normalized.toolName ?? '',
    normalized.command ?? '',
    normalized.todoId ?? '',
    normalized.todoSeq ?? '',
    (normalized.changedFiles ?? []).join(','),
  ].join('|');
  const existing = state.contractWarnings.find(
    (item) =>
      [
        item.code,
        item.providerItemId ?? '',
        item.toolName ?? '',
        item.command ?? '',
        item.todoId ?? '',
        item.todoSeq ?? '',
        (item.changedFiles ?? []).join(','),
      ].join('|') === key
  );
  if (existing) {
    existing.count = Math.max(1, existing.count ?? 1) + Math.max(1, normalized.count ?? 1);
    return;
  }
  state.contractWarnings.push(normalized);
}

export function normalizeContractWarning(warning: CodexContractWarning): CodexContractWarning {
  return {
    code: warning.code,
    severity: warning.severity,
    message: warning.message,
    providerItemId: warning.providerItemId ?? null,
    toolName: warning.toolName ?? null,
    todoId: warning.todoId ?? null,
    todoSeq: warning.todoSeq ?? null,
    ...(warning.changedFiles ? { changedFiles: warning.changedFiles } : {}),
    command: warning.command ?? null,
    ...(warning.todoEvidenceSource ? { todoEvidenceSource: warning.todoEvidenceSource } : {}),
    ...(typeof warning.sequence === 'number' && Number.isFinite(warning.sequence)
      ? { sequence: Math.max(0, Math.floor(warning.sequence)) }
      : {}),
    ...(typeof warning.occurredAt === 'string' && warning.occurredAt.length > 0
      ? { occurredAt: warning.occurredAt }
      : {}),
    ...(typeof warning.count === 'number' && Number.isFinite(warning.count)
      ? { count: Math.max(1, Math.floor(warning.count)) }
      : {}),
  };
}
