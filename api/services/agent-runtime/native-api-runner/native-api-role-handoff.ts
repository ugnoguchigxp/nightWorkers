import type { StructuredLlmRole } from '../../structured-llm/types';
import type { AgentRunContext } from '../types';
import {
  type NativeApiExecutionMode,
  nativeApiRoleForExecutionMode,
  readNativeApiExecutionMode,
} from './native-api-mode';

export type RoleHandoffArtifactV1 = {
  version: 1;
  runId: string;
  taskId: string;
  fromExecutionMode: NativeApiExecutionMode | null;
  toExecutionMode: NativeApiExecutionMode;
  fromRole: StructuredLlmRole | null;
  toRole: StructuredLlmRole;
  createdAt: string;
  sourceTurnId?: string | null;
  sourceEventSeq?: number | null;
  contextSnapshotId?: string | null;
  stateCardDigest?: string | null;
  currentTodo: {
    id: string;
    seq: number;
    title: string;
    status: string;
  } | null;
  completedWork: Array<{
    todoId?: string | null;
    summary: string;
    evidenceRefs: string[];
  }>;
  decisions: Array<{
    summary: string;
    reason?: string | null;
    evidenceRefs: string[];
  }>;
  openQuestions: Array<{
    summary: string;
    blocking: boolean;
    evidenceRefs: string[];
  }>;
  designReferences: Array<{
    path: string;
    section?: string | null;
    digest?: string | null;
    reason: string;
  }>;
  runtimeFacts: Array<{
    summary: string;
    source: 'todo' | 'task_event' | 'tool_call' | 'state_card' | 'user_request';
    evidenceRefs: string[];
  }>;
  discardPolicy: {
    discardedHistoryBeforeTurnId?: string | null;
    reason: string;
  };
};

export type RoleHandoffValidationResult =
  | { ok: true; artifact: RoleHandoffArtifactV1 }
  | { ok: false; errors: string[] };

export function buildDeterministicRoleHandoffArtifact(input: {
  context: AgentRunContext;
  createdAt?: string;
  fromExecutionMode?: NativeApiExecutionMode | null;
  fromRole?: StructuredLlmRole | null;
  previousEventSeq?: number | null;
}): RoleHandoffArtifactV1 {
  const toExecutionMode = readNativeApiExecutionMode(input.context);
  const toRole = nativeApiRoleForExecutionMode(toExecutionMode);
  const conversationContext = input.context.contextSnapshot.conversationContext;
  const todo = input.context.currentTodo ?? null;
  const todoPlan = input.context.todoPlan ?? [];
  return {
    version: 1,
    runId: input.context.runId,
    taskId: input.context.taskId,
    fromExecutionMode: input.fromExecutionMode ?? null,
    toExecutionMode,
    fromRole: input.fromRole ?? null,
    toRole,
    createdAt: input.createdAt ?? new Date().toISOString(),
    sourceEventSeq: input.previousEventSeq ?? null,
    contextSnapshotId: conversationContext?.snapshotId ?? null,
    stateCardDigest: readStateCardDigest(input.context),
    currentTodo: todo
      ? {
          id: todo.id,
          seq: todo.seq,
          title: todo.title,
          status: todo.status,
        }
      : null,
    completedWork: todoPlan
      .filter((item) => item.status === 'done' || item.status === 'passed')
      .map((item) => ({
        todoId: item.id,
        summary: `Todo #${item.seq}: ${item.title}`,
        evidenceRefs: [`todo:${item.id}`],
      })),
    decisions: [],
    openQuestions: todoPlan
      .filter((item) => item.status === 'blocked' || item.status === 'needs_human')
      .map((item) => ({
        summary: `Todo #${item.seq} requires follow-up: ${item.title}`,
        blocking: item.status !== 'done' && item.status !== 'passed',
        evidenceRefs: [`todo:${item.id}`],
      })),
    designReferences: buildDesignReferences(input.context),
    runtimeFacts: buildRuntimeFacts(input.context),
    discardPolicy: {
      reason:
        'Role boundary uses deterministic handoff plus Todo/state-card references instead of carrying raw provider history.',
    },
  };
}

export function validateRoleHandoffArtifact(input: unknown): RoleHandoffValidationResult {
  const errors: string[] = [];
  const value = asRecord(input);
  if (!value) {
    return { ok: false, errors: ['artifact must be an object'] };
  }
  if (value.version !== 1) errors.push('version must be 1');
  requireNonEmptyString(value.runId, 'runId', errors);
  requireNonEmptyString(value.taskId, 'taskId', errors);
  requireNativeApiExecutionMode(value.toExecutionMode, 'toExecutionMode', errors);
  requireStructuredLlmRole(value.toRole, 'toRole', errors);
  requireOptionalNativeApiExecutionMode(value.fromExecutionMode, 'fromExecutionMode', errors);
  requireOptionalStructuredLlmRole(value.fromRole, 'fromRole', errors);
  requireNonEmptyString(value.createdAt, 'createdAt', errors);
  validateCurrentTodo(value.currentTodo, errors);
  validateEvidenceArray(value.completedWork, 'completedWork', errors);
  validateEvidenceArray(value.decisions, 'decisions', errors);
  validateOpenQuestions(value.openQuestions, errors);
  validateDesignReferences(value.designReferences, errors);
  validateRuntimeFacts(value.runtimeFacts, errors);
  const discardPolicy = asRecord(value.discardPolicy);
  if (!discardPolicy) {
    errors.push('discardPolicy must be an object');
  } else {
    requireNonEmptyString(discardPolicy.reason, 'discardPolicy.reason', errors);
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, artifact: input as RoleHandoffArtifactV1 };
}

function buildDesignReferences(
  context: AgentRunContext
): RoleHandoffArtifactV1['designReferences'] {
  const refs: RoleHandoffArtifactV1['designReferences'] = [];
  const compiledPrompt = context.compiledPrompt || context.latestUserMessage || '';
  const matches = compiledPrompt.matchAll(/\b(?:spec|docs|api|web|tests)\/[^\s"'<>]+/g);
  const seen = new Set<string>();
  for (const match of matches) {
    const path = match[0].replace(/[),.;:]+$/, '');
    if (!path || seen.has(path)) continue;
    seen.add(path);
    refs.push({
      path,
      digest: null,
      section: null,
      reason: 'Referenced by runtime prompt or user request.',
    });
  }
  return refs.slice(0, 12);
}

function buildRuntimeFacts(context: AgentRunContext): RoleHandoffArtifactV1['runtimeFacts'] {
  const facts: RoleHandoffArtifactV1['runtimeFacts'] = [];
  if (context.currentTodo) {
    facts.push({
      summary: `Current Todo #${context.currentTodo.seq}: ${context.currentTodo.title}`,
      source: 'todo',
      evidenceRefs: [`todo:${context.currentTodo.id}`],
    });
  }
  const projection = context.contextSnapshot.conversationContext?.projection;
  if (projection) {
    facts.push({
      summary: `State card projection source: ${projection.source}`,
      source: 'state_card',
      evidenceRefs: [
        context.contextSnapshot.conversationContext?.snapshotId
          ? `conversation_context:${context.contextSnapshot.conversationContext.snapshotId}`
          : 'conversation_context:runtime_snapshot',
      ],
    });
  }
  if (context.latestUserMessage.trim()) {
    facts.push({
      summary: 'Latest user request is included separately in provider history.',
      source: 'user_request',
      evidenceRefs: ['latest_user_message'],
    });
  }
  return facts;
}

function readStateCardDigest(context: AgentRunContext) {
  const snapshotJson = asRecord(context.contextSnapshot.conversationContext?.snapshotJson);
  const baseline = asRecord(snapshotJson?.contextBaseline);
  const digest = baseline?.stateCardDigest;
  return typeof digest === 'string' && digest.trim() ? digest : null;
}

function validateCurrentTodo(value: unknown, errors: string[]) {
  if (value === null) return;
  const todo = asRecord(value);
  if (!todo) {
    errors.push('currentTodo must be null or an object');
    return;
  }
  requireNonEmptyString(todo.id, 'currentTodo.id', errors);
  if (!Number.isInteger(todo.seq)) errors.push('currentTodo.seq must be an integer');
  requireNonEmptyString(todo.title, 'currentTodo.title', errors);
  requireNonEmptyString(todo.status, 'currentTodo.status', errors);
}

function validateEvidenceArray(value: unknown, label: string, errors: string[]) {
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array`);
    return;
  }
  value.forEach((item, index) => {
    const record = asRecord(item);
    if (!record) {
      errors.push(`${label}[${index}] must be an object`);
      return;
    }
    requireNonEmptyString(record.summary, `${label}[${index}].summary`, errors);
    validateStringArray(record.evidenceRefs, `${label}[${index}].evidenceRefs`, errors);
  });
}

function validateOpenQuestions(value: unknown, errors: string[]) {
  if (!Array.isArray(value)) {
    errors.push('openQuestions must be an array');
    return;
  }
  value.forEach((item, index) => {
    const record = asRecord(item);
    if (!record) {
      errors.push(`openQuestions[${index}] must be an object`);
      return;
    }
    requireNonEmptyString(record.summary, `openQuestions[${index}].summary`, errors);
    if (typeof record.blocking !== 'boolean') {
      errors.push(`openQuestions[${index}].blocking must be boolean`);
    }
    validateStringArray(record.evidenceRefs, `openQuestions[${index}].evidenceRefs`, errors);
  });
}

function validateDesignReferences(value: unknown, errors: string[]) {
  if (!Array.isArray(value)) {
    errors.push('designReferences must be an array');
    return;
  }
  value.forEach((item, index) => {
    const record = asRecord(item);
    if (!record) {
      errors.push(`designReferences[${index}] must be an object`);
      return;
    }
    requireNonEmptyString(record.path, `designReferences[${index}].path`, errors);
    requireNonEmptyString(record.reason, `designReferences[${index}].reason`, errors);
    if ('content' in record || 'text' in record || 'body' in record) {
      errors.push(`designReferences[${index}] must not include document body`);
    }
  });
}

function validateRuntimeFacts(value: unknown, errors: string[]) {
  if (!Array.isArray(value)) {
    errors.push('runtimeFacts must be an array');
    return;
  }
  value.forEach((item, index) => {
    const record = asRecord(item);
    if (!record) {
      errors.push(`runtimeFacts[${index}] must be an object`);
      return;
    }
    requireNonEmptyString(record.summary, `runtimeFacts[${index}].summary`, errors);
    if (
      record.source !== 'todo' &&
      record.source !== 'task_event' &&
      record.source !== 'tool_call' &&
      record.source !== 'state_card' &&
      record.source !== 'user_request'
    ) {
      errors.push(`runtimeFacts[${index}].source is invalid`);
    }
    validateStringArray(record.evidenceRefs, `runtimeFacts[${index}].evidenceRefs`, errors);
  });
}

function validateStringArray(value: unknown, label: string, errors: string[]) {
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array`);
    return;
  }
  value.forEach((item, index) => {
    if (typeof item !== 'string') {
      errors.push(`${label}[${index}] must be a string`);
    }
  });
}

function requireNonEmptyString(value: unknown, label: string, errors: string[]) {
  if (typeof value !== 'string' || !value.trim()) {
    errors.push(`${label} must be a non-empty string`);
  }
}

function requireNativeApiExecutionMode(value: unknown, label: string, errors: string[]) {
  if (
    value !== 'planning' &&
    value !== 'implementation' &&
    value !== 'review' &&
    value !== 'runtime_debug' &&
    value !== 'general_answer'
  ) {
    errors.push(`${label} is invalid`);
  }
}

function requireOptionalNativeApiExecutionMode(value: unknown, label: string, errors: string[]) {
  if (value === null || value === undefined) return;
  requireNativeApiExecutionMode(value, label, errors);
}

function requireStructuredLlmRole(value: unknown, label: string, errors: string[]) {
  if (
    value !== 'plan' &&
    value !== 'implementation' &&
    value !== 'test' &&
    value !== 'review' &&
    value !== 'mission_task_generation' &&
    value !== 'quality_gate' &&
    value !== 'completion'
  ) {
    errors.push(`${label} is invalid`);
  }
}

function requireOptionalStructuredLlmRole(value: unknown, label: string, errors: string[]) {
  if (value === null || value === undefined) return;
  requireStructuredLlmRole(value, label, errors);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
