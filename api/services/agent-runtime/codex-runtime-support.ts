import path from 'node:path';
import * as repo from '../../modules/nightworkers/nightworkers.repository';
import { normalizeCodexCommand } from './codex-sdk/codex-sdk-event-adapter';
import type {
  CodexReadEvidence,
  CodexRuntimeAuditState,
  RuntimeTodoEvidence,
  RuntimeTodoEvidenceReadResult,
} from './codex-sdk/codex-sdk-mcp-audit';
import { addContractWarning, normalizeContractWarning } from './codex-sdk/codex-sdk-mcp-audit';
import type { RuntimeSessionStateStore } from './runtime-session-state';
import type { AgentRunContext, AgentRuntimeEvent, CodexContractWarning } from './types';

export async function persistCodexProviderThreadIfPresent(
  store: RuntimeSessionStateStore,
  context: AgentRunContext,
  event: AgentRuntimeEvent
) {
  const payload = readEventPayload(event);
  if (event.type !== 'runtime_started') return;
  const providerThreadId = readString(payload.providerThreadId);
  if (!providerThreadId) return;
  await store.upsertRuntimeSessionState({
    taskId: context.taskId,
    repositoryId: context.repositoryId,
    runId: context.runId,
    runtimeLane: 'codex-sdk',
    provider: 'codex',
    providerSessionId: providerThreadId,
    executionMode: readCodexRuntimeExecutionMode(context),
    model: readCodexRuntimeModel(context),
    metadata: {
      source: 'thread.started',
      providerThreadId,
    },
  });
}

export function normalizeRetryLimit(value: number | undefined, fallback: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

export function normalizeRetryDelayMs(value: number | undefined, fallback: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

export async function sleep(ms: number, signal: AbortSignal) {
  if (ms <= 0 || signal.aborted) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true }
    );
  });
}

export function readEventPayload(event: AgentRuntimeEvent): Record<string, unknown> {
  return event.payload && typeof event.payload === 'object'
    ? (event.payload as Record<string, unknown>)
    : {};
}

export function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function readExitCode(payload: Record<string, unknown>): number | null {
  if (typeof payload.exitCode === 'number') return payload.exitCode;
  if (typeof payload.exit_code === 'number') return payload.exit_code;
  return null;
}

export function readChangedFiles(payload: Record<string, unknown>): string[] {
  return Array.isArray(payload.changedFiles)
    ? payload.changedFiles.filter((file): file is string => typeof file === 'string')
    : [];
}

export function readCodexRuntimeExecutionMode(context: AgentRunContext) {
  const value = context.runtimeOptions?.executionMode;
  if (
    value === 'planning' ||
    value === 'implementation' ||
    value === 'review' ||
    value === 'runtime_debug' ||
    value === 'general_answer'
  ) {
    return value;
  }
  const snapshotValue = context.contextSnapshot.executionMode;
  if (
    snapshotValue === 'planning' ||
    snapshotValue === 'implementation' ||
    snapshotValue === 'review' ||
    snapshotValue === 'runtime_debug' ||
    snapshotValue === 'general_answer'
  ) {
    return snapshotValue;
  }
  return 'implementation';
}

export function readPromptPartObservabilityEnabled(context: AgentRunContext) {
  const llmUsage =
    context.runtimeOptions?.llmUsage && typeof context.runtimeOptions.llmUsage === 'object'
      ? (context.runtimeOptions.llmUsage as Record<string, unknown>)
      : null;
  return llmUsage?.promptPartObservabilityEnabled !== false;
}

export function readCodexRuntimeModel(context: AgentRunContext) {
  const codex = readRecord(context.runtimeOptions?.codex);
  return readString(codex?.model);
}

export function toContractWarningEvent(
  auditState: CodexRuntimeAuditState,
  warning: CodexContractWarning
): AgentRuntimeEvent | null {
  const normalized = normalizeContractWarning({
    ...warning,
    sequence: warning.sequence ?? auditState.eventSequence,
    occurredAt: warning.occurredAt ?? new Date().toISOString(),
    count: warning.count ?? 1,
  });
  const added = addContractWarning(auditState, normalized);
  if (!added.isNew && normalized.severity !== 'error') return null;
  return {
    type: 'runtime_warning',
    message: `[Codex Contract Warning] ${normalized.message}`,
    payload: normalized,
  };
}

export async function readCurrentTodoEvidence(
  context: AgentRunContext
): Promise<RuntimeTodoEvidenceReadResult> {
  try {
    const todos = await repo.listTaskRunTodosForRun(context.runId);
    const current = todos
      .filter((todo) => todo.status === 'running')
      .sort((a, b) => a.seq - b.seq)[0];
    if (!current) return { todo: null, source: 'none', dbReadFailed: false };
    return {
      todo: {
        id: current.id,
        seq: current.seq,
        title: current.title,
        procedureId: current.procedureId ?? null,
      },
      source: 'db',
      dbReadFailed: false,
    };
  } catch {
    if (context.currentTodo?.status === 'running') {
      return {
        todo: {
          id: context.currentTodo.id,
          seq: context.currentTodo.seq,
          title: context.currentTodo.title,
          procedureId: context.currentTodo.procedureId ?? null,
        },
        source: 'context',
        dbReadFailed: true,
      };
    }
    if (context.todoPlan?.length) {
      const current = context.todoPlan
        .filter((todo) => todo.status === 'running')
        .sort((a, b) => a.seq - b.seq)[0];
      if (current) {
        return {
          todo: {
            id: current.id,
            seq: current.seq,
            title: current.title,
            procedureId: current.procedureId ?? null,
          },
          source: 'context',
          dbReadFailed: true,
        };
      }
    }
    return { todo: null, source: 'none', dbReadFailed: true };
  }
}

export function readToolOperation(payload: Record<string, unknown>): string | null {
  const args = payload.arguments;
  if (!args || typeof args !== 'object' || Array.isArray(args)) return null;
  const operation = (args as Record<string, unknown>).operation;
  return typeof operation === 'string' ? operation : null;
}

export function readTodoTransitionResult(payload: Record<string, unknown>): string | null {
  const todoPayload = readTodoActionPayload(payload);
  const operation = readToolOperation(payload);
  const nextCurrentSeq = readRecord(todoPayload?.transition)?.nextCurrentSeq;
  if (typeof nextCurrentSeq === 'number') return `${operation || 'todo'}:next:${nextCurrentSeq}`;
  if (todoPayload?.currentTodo)
    return `${operation || 'todo'}:current:${todoPayload.currentTodo.seq}`;
  return operation ? `${operation}:no_current` : null;
}

export function isValidTodoProgressOperation(
  operation: string | null,
  payload: Record<string, unknown>
) {
  if (operation === 'start' || operation === 'replace') return true;
  if (operation === 'done') {
    const todoPayload = readTodoActionPayload(payload);
    return Boolean(todoPayload?.currentTodo || todoPayload?.nextTodo);
  }
  return false;
}

export function readTodoActionPayload(payload: Record<string, unknown>): {
  currentTodo?: RuntimeTodoEvidence | null;
  nextTodo?: RuntimeTodoEvidence | null;
  transition?: Record<string, unknown> | null;
} | null {
  const record = readMcpGenericPayloadRecord(payload.result);
  if (!record) return null;
  const currentTodo = readTodoEvidenceRecord(readRecord(record.currentTodo));
  const nextTodo = readTodoEvidenceRecord(readRecord(record.nextTodo));
  return {
    currentTodo,
    nextTodo,
    transition: readRecord(record.transition),
  };
}

function readMcpGenericPayloadRecord(value: unknown): Record<string, unknown> | null {
  const record = readRecord(value);
  if (!record) return null;
  const payload = readRecord(record.payload);
  if (payload) return payload;
  const structuredPayload = readRecord(readRecord(record.structuredContent)?.payload);
  if (structuredPayload) return structuredPayload;
  const content = Array.isArray(record.content) ? record.content : [];
  for (const item of content) {
    const text = readString(readRecord(item)?.text);
    if (!text) continue;
    const parsed = parseJsonRecord(text);
    if (!parsed) continue;
    return readRecord(parsed.payload) ?? parsed;
  }
  return record;
}

function readTodoEvidenceRecord(
  record: Record<string, unknown> | null
): RuntimeTodoEvidence | null {
  if (!record) return null;
  const id = readString(record.id);
  const title = readString(record.title);
  const seq = record.seq;
  if (!id || !title || typeof seq !== 'number') return null;
  return {
    id,
    seq,
    title,
    procedureId: readString(record.procedureId),
  };
}

export function isTodoProgressMutationOperation(value: string | null) {
  return (
    value === 'replace' ||
    value === 'start' ||
    value === 'done' ||
    value === 'block' ||
    value === 'fail'
  );
}

export function hasValidTodoProgressBeforeFileChange(
  auditState: CodexRuntimeAuditState,
  fileChangeSequence: number
) {
  if (
    auditState.lastProgressValidSequence === null ||
    auditState.lastProgressValidSequence >= fileChangeSequence
  ) {
    return false;
  }
  if (
    auditState.lastNightworkersTodoMutationSequence !== null &&
    auditState.lastNightworkersTodoMutationSequence > auditState.lastProgressValidSequence &&
    (auditState.lastNightworkersTodoMutationOperation === 'done' ||
      auditState.lastNightworkersTodoMutationOperation === 'block' ||
      auditState.lastNightworkersTodoMutationOperation === 'fail')
  ) {
    return false;
  }
  return true;
}

export function recordCommandReadEvidence(input: {
  auditState: CodexRuntimeAuditState;
  repoRoot: string;
  sequence: number;
  command: string | null;
  commandClass: string | null;
  exitCode: number | null;
  status: string | null;
  providerItemId: string | null;
}) {
  if (!input.command) return;
  if (input.status && input.status !== 'completed') return;
  if (input.exitCode !== null && input.exitCode !== 0) return;
  const normalizedCommand = normalizeCodexCommand(input.command);
  const normalizedClass =
    input.commandClass === 'inspection' || classifyInspectionCommand(normalizedCommand)
      ? 'inspection'
      : input.commandClass;
  if (normalizedClass !== 'inspection') return;
  const paths = extractReadEvidencePaths(normalizedCommand, input.repoRoot);
  for (const { path: pathValue, kind } of paths) {
    const evidence: CodexReadEvidence = {
      sequence: input.sequence,
      path: pathValue,
      source: 'command_execution',
      kind,
      command: input.command,
      normalizedCommand,
      providerItemId: input.providerItemId,
    };
    appendMapValue(input.auditState.readEvidenceByPath, pathValue, evidence);
    appendMapValue(
      input.auditState.createdFileContextEvidenceByDirectory,
      path.posix.dirname(pathValue),
      evidence
    );
  }
}

function classifyInspectionCommand(command: string) {
  return (
    /^(?:pwd|ls|find|tree|wc)\b/.test(command) ||
    /^(?:rg|grep|cat|sed|awk|head|tail|nl)\b/.test(command) ||
    /^git\s+(?:status|diff|log|show|branch|rev-parse)\b/.test(command)
  );
}

function extractReadEvidencePaths(command: string, repoRoot: string) {
  const tokens = tokenizeShellLike(command);
  const paths = new Map<string, CodexReadEvidence['kind']>();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === 'cat' || token === 'nl' || token === 'head' || token === 'tail') {
      collectPathArgs(tokens, index + 1, repoRoot, paths, 'content');
    }
    if (token === 'sed') {
      collectPathArgs(tokens, index + 1, repoRoot, paths, 'content');
    }
    if (token === 'rg' || token === 'grep') {
      collectSearchPathArgs(tokens, index + 1, repoRoot, paths);
    }
    if (token === 'git' && tokens[index + 1] === 'diff') {
      const separatorIndex = tokens.indexOf('--', index + 2);
      if (separatorIndex >= 0) collectPathArgs(tokens, separatorIndex + 1, repoRoot, paths, 'diff');
    }
  }
  return [...paths.entries()].map(([path, kind]) => ({ path, kind }));
}

function collectPathArgs(
  tokens: string[],
  startIndex: number,
  repoRoot: string,
  output: Map<string, CodexReadEvidence['kind']>,
  kind: CodexReadEvidence['kind']
) {
  for (let index = startIndex; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (isCommandBoundary(token)) break;
    if (token.startsWith('-')) continue;
    if (!isLikelyPathToken(token)) continue;
    output.set(normalizeRepoRelativePath(token, repoRoot), kind);
  }
}

function collectSearchPathArgs(
  tokens: string[],
  startIndex: number,
  repoRoot: string,
  output: Map<string, CodexReadEvidence['kind']>
) {
  let sawPattern = false;
  for (let index = startIndex; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (isCommandBoundary(token)) break;
    if (token.startsWith('-')) continue;
    if (!sawPattern) {
      sawPattern = true;
      continue;
    }
    if (!isLikelyPathToken(token)) continue;
    output.set(normalizeRepoRelativePath(token, repoRoot), 'content');
  }
}

export function hasPriorReadEvidence(
  auditState: CodexRuntimeAuditState,
  repoRoot: string,
  filePath: string,
  fileChangeSequence: number,
  payload: Record<string, unknown>
) {
  const normalizedPath = normalizeRepoRelativePath(filePath, repoRoot);
  const created = isCreatedFileChange(payload, filePath);
  if (
    !created &&
    hasEvidenceBefore(auditState.readEvidenceByPath.get(normalizedPath), fileChangeSequence)
  ) {
    return true;
  }
  if (!created) return false;
  return createdFileContextDirectories(normalizedPath).some((directory) =>
    hasEvidenceBefore(
      auditState.createdFileContextEvidenceByDirectory.get(directory),
      fileChangeSequence,
      { allowDiff: false }
    )
  );
}

function createdFileContextDirectories(normalizedPath: string) {
  const direct = path.posix.dirname(normalizedPath);
  const parent = path.posix.dirname(direct);
  return [direct, parent].filter(
    (directory, index, directories) =>
      directory !== '.' && directory !== '/' && directories.indexOf(directory) === index
  );
}

function hasEvidenceBefore(
  evidence: CodexReadEvidence[] | undefined,
  sequence: number,
  input: { allowDiff?: boolean } = {}
) {
  const allowDiff = input.allowDiff ?? true;
  return Boolean(
    evidence?.some((item) => item.sequence < sequence && (allowDiff || item.kind !== 'diff'))
  );
}

function isCreatedFileChange(payload: Record<string, unknown>, filePath: string) {
  const changes = Array.isArray(payload.changes) ? payload.changes : [];
  return changes.some((change) => {
    if (!change || typeof change !== 'object') return false;
    const record = change as Record<string, unknown>;
    const changePath =
      readString(record.path) ?? readString(record.filePath) ?? readString(record.relativePath);
    if (changePath && !filePathsMatch(changePath, filePath)) return false;
    const value = readString(record.type) ?? readString(record.status) ?? readString(record.kind);
    return value === 'add' || value === 'added' || value === 'create' || value === 'created';
  });
}

function filePathsMatch(observedPath: string, failurePath: string) {
  const normalizedObserved = observedPath.replaceAll('\\', '/');
  const normalizedFailure = failurePath.replaceAll('\\', '/');
  return (
    normalizedObserved === normalizedFailure ||
    normalizedFailure.endsWith(`/${normalizedObserved}`) ||
    normalizedObserved.endsWith(`/${normalizedFailure}`)
  );
}

function appendMapValue<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const existing = map.get(key);
  if (existing) {
    existing.push(value);
    return;
  }
  map.set(key, [value]);
}

function tokenizeShellLike(command: string) {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    if (
      (char === '&' && command[index + 1] === '&') ||
      (char === '|' && command[index + 1] === '|')
    ) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      tokens.push(`${char}${command[index + 1]}`);
      index += 1;
      continue;
    }
    if (char === ';' || char === '|' || char === '<' || char === '>') {
      if (current) {
        tokens.push(current);
        current = '';
      }
      tokens.push(char);
      continue;
    }
    current += char;
  }
  if (current) tokens.push(current);
  return tokens;
}

function isCommandBoundary(token: string) {
  return (
    token === '&&' ||
    token === '||' ||
    token === ';' ||
    token === '|' ||
    token === '<' ||
    token === '>'
  );
}

function isLikelyPathToken(token: string) {
  if (!token || token.includes('$(') || token.includes('`')) return false;
  if (/^[0-9]+(?:,[0-9]+)?p$/.test(token)) return false;
  return (
    token.includes('/') ||
    token.startsWith('.') ||
    /\.(?:[cm]?[jt]sx?|css|scss|md|json|ya?ml|toml|sql|rs|py|go|java|html|txt)$/.test(token)
  );
}

function normalizeRepoRelativePath(value: string, repoRoot: string) {
  const normalizedRoot = path.resolve(repoRoot).replaceAll('\\', '/');
  const normalizedValue = value.replaceAll('\\', '/');
  const absolute = path.isAbsolute(normalizedValue)
    ? path.normalize(normalizedValue).replaceAll('\\', '/')
    : path.resolve(repoRoot, normalizedValue).replaceAll('\\', '/');
  const relative = absolute.startsWith(`${normalizedRoot}/`)
    ? absolute.slice(normalizedRoot.length + 1)
    : normalizedValue;
  return path.posix.normalize(relative).replace(/^\.\//, '');
}

export function hasTodoProgressWarning(auditState: CodexRuntimeAuditState) {
  return auditState.contractWarnings.some(
    (warning) =>
      warning.code === 'codex_todo_progress_missing' ||
      warning.code === 'codex_todo_progress_list_only'
  );
}

export function isFailedToolPayload(payload: Record<string, unknown>) {
  return (
    payload.status === 'failed' ||
    payload.status === 'error' ||
    payload.status === 'cancelled' ||
    typeof payload.error === 'string' ||
    readMcpResultError(payload.result) !== null
  );
}

export function isMcpToolPayload(payload: Record<string, unknown>) {
  return typeof payload.mcpServer === 'string' && typeof payload.mcpTool === 'string';
}

export function isCodexFileChangeEvent(payload: Record<string, unknown>) {
  return payload.provider === 'codex' && Array.isArray(payload.changedFiles);
}

export function todoPayload(todo: RuntimeTodoEvidence | null) {
  if (!todo) return {};
  return {
    todoId: todo.id,
    todoSeq: todo.seq,
    todoTitle: todo.title,
    todoProcedureId: todo.procedureId ?? null,
  };
}

export function readImportProjectSuccessPayload(payload: Record<string, unknown>): {
  recommendedVerificationCommands: string[];
} | null {
  if (isFailedToolPayload(payload)) return null;
  const resultRecord = readMcpPayloadRecord(payload.result);
  if (!resultRecord) return null;
  const postImport = readRecord(resultRecord.postImport);
  const manifest = readRecord(postImport?.manifest);
  const commands = Array.isArray(manifest?.recommendedVerificationCommands)
    ? manifest.recommendedVerificationCommands.filter(
        (command): command is string => typeof command === 'string' && command.trim().length > 0
      )
    : [];
  return { recommendedVerificationCommands: commands };
}

function readMcpPayloadRecord(value: unknown): Record<string, unknown> | null {
  const record = readRecord(value);
  if (!record) return null;
  if (isImportProjectPayloadRecord(record)) return record;
  const payload = readRecord(record.payload);
  if (payload && isImportProjectPayloadRecord(payload)) return payload;
  const structuredPayload = readRecord(readRecord(record.structuredContent)?.payload);
  if (structuredPayload && isImportProjectPayloadRecord(structuredPayload)) {
    return structuredPayload;
  }
  const content = Array.isArray(record.content) ? record.content : [];
  for (const item of content) {
    const text = readString(readRecord(item)?.text);
    if (!text) continue;
    const parsed = parseJsonRecord(text);
    if (!parsed) continue;
    if (isImportProjectPayloadRecord(parsed)) return parsed;
    const parsedPayload = readRecord(parsed.payload);
    if (parsedPayload && isImportProjectPayloadRecord(parsedPayload)) return parsedPayload;
  }
  return null;
}

function readMcpResultError(value: unknown): string | null {
  const record = readRecord(value);
  if (!record) return null;
  const directError = readRecord(record.error);
  const structuredError = readRecord(readRecord(record.structuredContent)?.error);
  const message = readString(directError?.message) ?? readString(structuredError?.message);
  if (message) return message;
  const content = Array.isArray(record.content) ? record.content : [];
  for (const item of content) {
    const text = readString(readRecord(item)?.text);
    if (!text) continue;
    const parsedError = readRecord(parseJsonRecord(text)?.error);
    const parsedMessage = readString(parsedError?.message);
    if (parsedMessage) return parsedMessage;
  }
  return record.isError === true ? 'NightWorkers MCP tool returned an error result.' : null;
}

function isImportProjectPayloadRecord(value: Record<string, unknown>) {
  return 'postImport' in value || ('template' in value && 'git' in value);
}

function parseJsonRecord(text: string): Record<string, unknown> | null {
  try {
    return readRecord(JSON.parse(text));
  } catch {
    return null;
  }
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function changedFilesFromDiff(diff: string): string[] {
  const files = new Set<string>();
  for (const line of diff.split('\n')) {
    const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (match?.[2]) files.add(match[2]);
  }
  return [...files];
}
