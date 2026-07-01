import type { AgentRunContext } from '../types';
import {
  type NativeApiExecutionMode,
  nativeApiRoleForExecutionMode,
  readNativeApiExecutionMode,
} from './native-api-mode';
import type { RoleHandoffArtifactV1 } from './native-api-role-handoff';

export type RoleWorkingContextV1 = {
  version: 1;
  runId: string;
  taskId: string;
  executionMode: NativeApiExecutionMode;
  role: ReturnType<typeof nativeApiRoleForExecutionMode>;
  createdAt: string;
  source: 'deterministic' | 'llm_compacted';
  currentTodo: RoleHandoffArtifactV1['currentTodo'];
  previousTodoSummaries: Array<{
    id: string;
    seq: number;
    title: string;
    status: string;
    summary?: string | null;
  }>;
  stateCard: {
    snapshotId?: string | null;
    digest?: string | null;
    projectionSource: 'role_projection' | 'raw_snapshot' | 'omitted';
    text?: string | null;
  };
  designReferences: RoleHandoffArtifactV1['designReferences'];
  carryForwardFacts: RoleHandoffArtifactV1['runtimeFacts'];
  openQuestions: RoleHandoffArtifactV1['openQuestions'];
  budget: {
    estimatedPromptTokens?: number | null;
    modelContextWindowTokens?: number | null;
  };
};

export type RoleWorkingContextRenderResult = {
  context: RoleWorkingContextV1;
  renderedText: string;
};

export type RoleWorkingContextValidationResult =
  | { ok: true; context: RoleWorkingContextV1 }
  | { ok: false; errors: string[] };

export function buildDeterministicRoleWorkingContext(input: {
  context: AgentRunContext;
  handoff: RoleHandoffArtifactV1;
  createdAt?: string;
}): RoleWorkingContextRenderResult {
  const executionMode = readNativeApiExecutionMode(input.context);
  const role = nativeApiRoleForExecutionMode(executionMode);
  const conversationContext = input.context.contextSnapshot.conversationContext;
  const stateCardText = conversationContext?.stateCardText?.trim() || null;
  const workingContext: RoleWorkingContextV1 = {
    version: 1,
    runId: input.context.runId,
    taskId: input.context.taskId,
    executionMode,
    role,
    createdAt: input.createdAt ?? new Date().toISOString(),
    source: 'deterministic',
    currentTodo: input.handoff.currentTodo,
    previousTodoSummaries: (input.context.todoPlan ?? [])
      .filter((todo) => todo.status !== 'pending' && todo.status !== 'running')
      .sort((a, b) => a.seq - b.seq)
      .map((todo) => ({
        id: todo.id,
        seq: todo.seq,
        title: todo.title,
        status: todo.status,
        summary: todo.contextDigest ?? todo.procedureDigest ?? null,
      })),
    stateCard: {
      snapshotId: conversationContext?.snapshotId ?? null,
      digest: input.handoff.stateCardDigest ?? null,
      projectionSource: conversationContext?.projection?.source ?? 'omitted',
      ...(stateCardText ? { text: stateCardText } : {}),
    },
    designReferences: input.handoff.designReferences,
    carryForwardFacts: input.handoff.runtimeFacts,
    openQuestions: input.handoff.openQuestions,
    budget: {
      estimatedPromptTokens: conversationContext?.usage?.runtimeUserPromptTokens ?? null,
      modelContextWindowTokens: null,
    },
  };
  return {
    context: workingContext,
    renderedText: renderRoleWorkingContext(workingContext),
  };
}

export function validateRoleWorkingContext(input: unknown): RoleWorkingContextValidationResult {
  const errors: string[] = [];
  const value = asRecord(input);
  if (!value) return { ok: false, errors: ['working context must be an object'] };
  if (value.version !== 1) errors.push('version must be 1');
  requireNonEmptyString(value.runId, 'runId', errors);
  requireNonEmptyString(value.taskId, 'taskId', errors);
  requireNativeApiExecutionMode(value.executionMode, 'executionMode', errors);
  requireStructuredLlmRole(value.role, 'role', errors);
  requireNonEmptyString(value.createdAt, 'createdAt', errors);
  if (value.source !== 'deterministic' && value.source !== 'llm_compacted') {
    errors.push('source is invalid');
  }
  validateCurrentTodo(value.currentTodo, errors);
  validatePreviousTodoSummaries(value.previousTodoSummaries, errors);
  validateStateCard(value.stateCard, errors);
  validateDesignReferences(value.designReferences, errors);
  validateRuntimeFacts(value.carryForwardFacts, errors);
  validateOpenQuestions(value.openQuestions, errors);
  if (!asRecord(value.budget)) errors.push('budget must be an object');
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, context: input as RoleWorkingContextV1 };
}

export function renderRoleWorkingContext(context: RoleWorkingContextV1) {
  const lines = [
    `<ROLE_WORKING_CONTEXT version="1" source="${context.source}">`,
    `executionMode=${context.executionMode}`,
    `role=${context.role}`,
    context.currentTodo
      ? `currentTodo=#${context.currentTodo.seq} ${context.currentTodo.title} status=${context.currentTodo.status}`
      : 'currentTodo=none',
    `previousTodoSummaries=${context.previousTodoSummaries.length}`,
    `stateCardProjection=${context.stateCard.projectionSource}`,
    context.stateCard.snapshotId ? `stateCardSnapshot=${context.stateCard.snapshotId}` : null,
    context.stateCard.digest ? `stateCardDigest=${context.stateCard.digest}` : null,
    ...context.designReferences.map(
      (ref) =>
        `designReference path=${ref.path} section=${ref.section ?? 'none'} digest=${ref.digest ?? 'none'} reason=${ref.reason}`
    ),
    ...context.carryForwardFacts.map(
      (fact) =>
        `runtimeFact source=${fact.source} evidenceRefs=${fact.evidenceRefs.join(',') || 'none'} summary=${fact.summary}`
    ),
    ...context.openQuestions.map(
      (question) =>
        `openQuestion blocking=${question.blocking ? 'true' : 'false'} evidenceRefs=${question.evidenceRefs.join(',') || 'none'} summary=${question.summary}`
    ),
    context.stateCard.text ? `[Projected State Card]\n${context.stateCard.text}` : null,
    '</ROLE_WORKING_CONTEXT>',
  ].filter((line): line is string => Boolean(line));
  return lines.join('\n');
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

function validatePreviousTodoSummaries(value: unknown, errors: string[]) {
  if (!Array.isArray(value)) {
    errors.push('previousTodoSummaries must be an array');
    return;
  }
  value.forEach((item, index) => {
    const summary = asRecord(item);
    if (!summary) {
      errors.push(`previousTodoSummaries[${index}] must be an object`);
      return;
    }
    requireNonEmptyString(summary.id, `previousTodoSummaries[${index}].id`, errors);
    if (!Number.isInteger(summary.seq)) {
      errors.push(`previousTodoSummaries[${index}].seq must be an integer`);
    }
    requireNonEmptyString(summary.title, `previousTodoSummaries[${index}].title`, errors);
    requireNonEmptyString(summary.status, `previousTodoSummaries[${index}].status`, errors);
  });
}

function validateStateCard(value: unknown, errors: string[]) {
  const stateCard = asRecord(value);
  if (!stateCard) {
    errors.push('stateCard must be an object');
    return;
  }
  if (
    stateCard.projectionSource !== 'role_projection' &&
    stateCard.projectionSource !== 'raw_snapshot' &&
    stateCard.projectionSource !== 'omitted'
  ) {
    errors.push('stateCard.projectionSource is invalid');
  }
}

function validateDesignReferences(value: unknown, errors: string[]) {
  if (!Array.isArray(value)) {
    errors.push('designReferences must be an array');
    return;
  }
  value.forEach((item, index) => {
    const ref = asRecord(item);
    if (!ref) {
      errors.push(`designReferences[${index}] must be an object`);
      return;
    }
    requireNonEmptyString(ref.path, `designReferences[${index}].path`, errors);
    requireNonEmptyString(ref.reason, `designReferences[${index}].reason`, errors);
    if ('content' in ref || 'text' in ref || 'body' in ref) {
      errors.push(`designReferences[${index}] must not include document body`);
    }
  });
}

function validateRuntimeFacts(value: unknown, errors: string[]) {
  if (!Array.isArray(value)) {
    errors.push('carryForwardFacts must be an array');
    return;
  }
  value.forEach((item, index) => {
    const fact = asRecord(item);
    if (!fact) {
      errors.push(`carryForwardFacts[${index}] must be an object`);
      return;
    }
    requireNonEmptyString(fact.summary, `carryForwardFacts[${index}].summary`, errors);
    validateStringArray(fact.evidenceRefs, `carryForwardFacts[${index}].evidenceRefs`, errors);
  });
}

function validateOpenQuestions(value: unknown, errors: string[]) {
  if (!Array.isArray(value)) {
    errors.push('openQuestions must be an array');
    return;
  }
  value.forEach((item, index) => {
    const question = asRecord(item);
    if (!question) {
      errors.push(`openQuestions[${index}] must be an object`);
      return;
    }
    requireNonEmptyString(question.summary, `openQuestions[${index}].summary`, errors);
    if (typeof question.blocking !== 'boolean') {
      errors.push(`openQuestions[${index}].blocking must be boolean`);
    }
    validateStringArray(question.evidenceRefs, `openQuestions[${index}].evidenceRefs`, errors);
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
