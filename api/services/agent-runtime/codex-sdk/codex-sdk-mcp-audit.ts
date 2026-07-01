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

export type CodexReadEvidence = {
  sequence: number;
  path: string;
  source: 'command_execution' | 'mcp_tool';
  kind: 'content' | 'diff';
  command?: string | null;
  normalizedCommand?: string | null;
  providerItemId?: string | null;
};

export type RuntimeTodoEvidenceReadResult = {
  todo: RuntimeTodoEvidence | null;
  source: 'db' | 'context' | 'none';
  dbReadFailed: boolean;
};

export type CodexRuntimeAuditState = {
  sawNightworkersTodoReplace: boolean;
  sawAnyNightworkersTodo: boolean;
  sawNightworkersTodoMutation: boolean;
  sawNightworkersTodoList: boolean;
  firstNightworkersTodoMutationSequence: number | null;
  lastNightworkersTodoMutationSequence: number | null;
  lastNightworkersTodoMutationOperation: string | null;
  lastProgressValidSequence: number | null;
  lastTodoEvidenceSource: RuntimeTodoEvidenceReadResult['source'] | null;
  structuralTodoReplanRequired: boolean;
  structuralTodoReplanEvidence: string[];
  lastTodoTransitionResult: string | null;
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
  lastFileChangeSequence: number | null;
  lastFileChangeProviderItemId: string | null;
  lastChangedFiles: string[];
  readEvidenceByPath: Map<string, CodexReadEvidence[]>;
  createdFileContextEvidenceByDirectory: Map<string, CodexReadEvidence[]>;
  mcpConfig: CodexRuntimeMcpConfigState;
};

export function createCodexRuntimeAuditState(
  input: { executionMode?: string } = {}
): CodexRuntimeAuditState {
  return {
    sawNightworkersTodoReplace: false,
    sawAnyNightworkersTodo: false,
    sawNightworkersTodoMutation: false,
    sawNightworkersTodoList: false,
    firstNightworkersTodoMutationSequence: null,
    lastNightworkersTodoMutationSequence: null,
    lastNightworkersTodoMutationOperation: null,
    lastProgressValidSequence: null,
    lastTodoEvidenceSource: null,
    structuralTodoReplanRequired: false,
    structuralTodoReplanEvidence: [],
    lastTodoTransitionResult: null,
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
    lastFileChangeSequence: null,
    lastFileChangeProviderItemId: null,
    lastChangedFiles: [],
    readEvidenceByPath: new Map(),
    createdFileContextEvidenceByDirectory: new Map(),
    mcpConfig: resolveCodexRuntimeMcpConfigState({
      env: input.executionMode ? { NIGHTWORKERS_EXECUTION_MODE: input.executionMode } : undefined,
    }),
  };
}

export function buildCodexRuntimeContractSnapshot(state: CodexRuntimeAuditState) {
  return {
    lane: 'codex-sdk',
    warnings: state.contractWarnings,
    summary: buildCodexRuntimeContractSummary(state),
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

export function addContractWarning(
  state: CodexRuntimeAuditState,
  warning: CodexContractWarning
): { warning: CodexContractWarning; isNew: boolean } {
  const normalized = normalizeContractWarning(warning);
  const key = contractWarningAggregationKey(normalized);
  const existing = state.contractWarnings.find(
    (item) => contractWarningAggregationKey(item) === key
  );
  if (existing) {
    existing.count = Math.max(1, existing.count ?? 1) + Math.max(1, normalized.count ?? 1);
    return { warning: existing, isNew: false };
  }
  state.contractWarnings.push(normalized);
  return { warning: normalized, isNew: true };
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

function contractWarningAggregationKey(warning: CodexContractWarning) {
  const changedFiles = [...(warning.changedFiles ?? [])].sort().join(',');
  const code = warning.code;
  if (changedFiles || code.includes('file_change') || code.includes('todo_progress')) {
    return [code, warning.todoSeq ?? '', changedFiles].join('|');
  }
  return [
    code,
    warning.providerItemId ?? '',
    warning.toolName ?? '',
    warning.command ?? '',
    warning.todoId ?? '',
    warning.todoSeq ?? '',
  ].join('|');
}

function buildCodexRuntimeContractSummary(state: CodexRuntimeAuditState) {
  const warnings = state.contractWarnings;
  const warningCount = (code: string) =>
    warnings
      .filter((warning) => warning.code === code)
      .reduce((sum, warning) => sum + Math.max(1, warning.count ?? 1), 0);
  return {
    todoProgress: {
      missingCount: warningCount('codex_todo_progress_missing'),
      listOnlyCount: warningCount('codex_todo_progress_list_only'),
      staleBeforeVerifyCount: warningCount('codex_todo_progress_stale_before_verify'),
    },
    readBeforeEdit: {
      missingPriorReadCount: warningCount('codex_file_change_without_prior_read'),
      coveredFileCount: state.readEvidenceByPath.size,
      warningCount: warningCount('codex_file_change_without_prior_read'),
    },
  };
}
