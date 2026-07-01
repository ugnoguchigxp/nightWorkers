import fs from 'node:fs/promises';
import { AppError, NotFoundError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { getCurrentSettings } from '../../routes/settings';
import { createLedgerSink } from '../../services/agent-runtime/ledger-sink';
import {
  type NativeApiExecutionMode,
  nativeApiRoleForExecutionMode,
  stateCardRoleForExecutionMode,
} from '../../services/agent-runtime/native-api-runner/native-api-mode';
import { buildNativeApiRoleContextSnapshot } from '../../services/agent-runtime/native-api-runner/native-api-role-context-events';
import {
  resolveAgentRuntime,
  resolveRuntimeLaneDefinition,
} from '../../services/agent-runtime/registry';
import {
  type RuntimeLaneResolution,
  readRuntimeLaneConfigFromEnv,
  resolveRuntimeLane,
} from '../../services/agent-runtime/runtime-lane';
import { RuntimeSessionStateStore } from '../../services/agent-runtime/runtime-session-state';
import {
  buildOpenTodoRuntimeContractWarning,
  mergeRuntimeContractSnapshot,
  normalizeRuntimeContractWarnings,
} from '../../services/agent-runtime/shared';
import type {
  AgentRuntimeKind,
  AgentRuntimeResult,
  AgentRuntimeSink,
  AgentSafetyPolicy,
} from '../../services/agent-runtime/types';
import {
  buildPromptWithStateCardParts,
  getLatestConversationContextForTask,
  type RefreshConversationContextInput,
  refreshConversationContextSnapshot,
} from '../../services/conversation-context';
import {
  isConversationContextBuildOnIdleEnabled,
  isConversationContextStateCardEnabled,
} from '../../services/conversation-context/flags';
import { projectConversationStateCardForRuntime } from '../../services/conversation-context/state-card-projection';
import {
  type CoverageAutonomyGateResult,
  evaluateCoverageAutonomyGate,
  formatCoverageAutonomyFinalReport,
} from '../../services/quality/coverage-autonomy-gate';
import { getSessionQueueMaxConcurrencyFromEnv } from '../../services/runtime-env';
import {
  buildPlanModeSettingsSnapshot,
  readGeneralSettings,
} from '../../services/settings/general-settings';
import { providerAdapterKey } from '../../services/structured-llm/request';
import {
  type ResolvedStructuredLlmRoute,
  resolveStructuredLlmRoleRoute,
  resolveStructuredLlmRoleRouteCandidates,
  structuredLlmRouteKey,
} from '../../services/structured-llm/role-routing';
import { normalizeStructuredLlmModelTarget } from '../../services/structured-llm/selection';
import {
  readStructuredLlmProviderSettings,
  type StructuredLlmModelTarget,
  type StructuredLlmProviderSettings,
  type StructuredLlmRole,
} from '../../services/structured-llm/settings';
import { digestText } from '../../services/text-digest';
import type { RuntimePromptSnapshot } from '../../services/todo-context';
import {
  buildStandardImplementationTodoList,
  evaluateTodoCompletionGate,
} from '../../services/todo-runtime';
import { getTodoWorkflowSettings } from '../queue/queue-management.service';
import {
  outcomeFromRuntimeResult,
  resolveBlueprintPlanningReadiness,
} from './nightworkers.basic.service';
import * as repo from './nightworkers.repository';
import { createPlanningArtifactMessageIfNeeded } from './nightworkers.workbench.service';

export const runStatusTransitionTable = {
  ready: ['queued', 'running'],
  queued: ['running', 'ready', 'cancelled'],
  running: ['finalizing', 'needs_human', 'failed', 'cancelled'],
  finalizing: ['needs_review', 'completed', 'failed', 'needs_human', 'cancelled'],
  needs_review: ['completed', 'failed', 'needs_human'],
  completed: [],
  failed: [],
  needs_human: ['queued', 'running', 'failed', 'cancelled'],
  cancelled: ['queued', 'running'],
  timed_out: ['queued', 'running', 'failed'],
} as const satisfies Record<string, readonly string[]>;

export function assertRunStatusTransition(from: string, to: string) {
  if (from === to) return;
  const transitionTable: Record<string, readonly string[]> = runStatusTransitionTable;
  const allowed = transitionTable[from];
  if (!allowed?.includes(to)) {
    throw new AppError(
      409,
      'INVALID_RUN_STATUS_TRANSITION',
      `Invalid run status transition: ${from} -> ${to}`
    );
  }
}

function listOpenTodos<TTodo extends { status: string }>(todos: TTodo[]) {
  return todos.filter((todo) => todo.status === 'pending' || todo.status === 'running');
}

async function applyCoverageAutonomyFallback(input: {
  runtimeResult: AgentRuntimeResult;
  repoRoot: string;
  safetyPolicy?: AgentSafetyPolicy;
  sink: AgentRuntimeSink;
}): Promise<AgentRuntimeResult> {
  if (readCoverageAutonomyResult(input.runtimeResult.testResults)) return input.runtimeResult;
  if (!['completed', 'needs_review'].includes(input.runtimeResult.terminalState)) {
    return input.runtimeResult;
  }

  const gate = await evaluateCoverageAutonomyGate({
    repoRoot: input.repoRoot,
    safetyPolicy: input.safetyPolicy,
  });
  await input.sink.emit({
    type: 'verification_finished',
    message: `[NightWorkers] coverage autonomy fallback gate ${gate.result.status}.`,
    payload: gate.result,
  });
  if (gate.result.status === 'disabled') return input.runtimeResult;

  const normalizedGate =
    gate.result.status === 'continue'
      ? ({
          ...gate.result,
          status: 'needs_human',
          shouldContinue: false,
          allowFinalize: true,
        } as CoverageAutonomyGateResult)
      : gate.result;
  const coverageReport = formatCoverageAutonomyFinalReport(normalizedGate);
  return {
    ...input.runtimeResult,
    finalReport: [input.runtimeResult.finalReport, coverageReport].filter(Boolean).join('\n\n'),
    summary:
      normalizedGate.status === 'passed'
        ? input.runtimeResult.summary
        : 'Coverage autonomy gate did not pass.',
    testResults: {
      ...(isRecord(input.runtimeResult.testResults) ? input.runtimeResult.testResults : {}),
      coverageAutonomy: normalizedGate,
    },
  };
}

function readCoverageAutonomyResult(testResults: unknown) {
  if (!isRecord(testResults)) return null;
  return isRecord(testResults.coverageAutonomy) ? testResults.coverageAutonomy : null;
}

function readRuntimeFailureTerminalReason(runtimeResult: AgentRuntimeResult): string | null {
  if (!isRecord(runtimeResult.testResults)) return null;
  const codexFailure = runtimeResult.testResults.codexFailure;
  if (!isRecord(codexFailure)) return null;
  return typeof codexFailure.terminalReason === 'string' && codexFailure.terminalReason.trim()
    ? codexFailure.terminalReason.trim()
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function markRunningTodosNeedsHuman(input: {
  runId: string;
  taskId: string;
  todos: Array<{
    id: string;
    seq: number;
    title: string;
    description?: string | null;
    taskType: string;
    status: string;
    procedureId?: string | null;
    procedureSnapshot?: unknown;
  }>;
  runtimeResult: AgentRuntimeResult;
  outcomeStatus: string;
}) {
  const runningTodos = input.todos.filter((todo) => todo.status === 'running');
  if (runningTodos.length === 0) return;
  const completedAt = new Date();
  const statusReason = input.runtimeResult.finalReport || input.runtimeResult.summary;
  await Promise.all(
    runningTodos.map((todo) =>
      repo.updateTaskRunTodo(
        todo.id,
        {
          status: 'needs_human',
          statusReason: statusReason || 'Runtime stopped and requires human review.',
          completionGateResult: evaluateTodoCompletionGate({
            todo,
            runtimeResult: input.runtimeResult,
            outcomeStatus: input.outcomeStatus,
          }),
          completedAt,
        },
        { notifyTaskId: input.taskId, notifyRunId: input.runId }
      )
    )
  );
}

async function closePendingTodosForNeedsHumanRun(input: {
  runId: string;
  taskId: string;
  todos: Array<{
    id: string;
    seq: number;
    title: string;
    taskType: string;
    status: string;
    procedureId?: string | null;
    startedAt?: unknown;
  }>;
  evidence: string;
}) {
  const pendingTodos = input.todos.filter((todo) => todo.status === 'pending');
  if (pendingTodos.length === 0) return;

  const completedAt = new Date();
  await Promise.all(
    pendingTodos.map(async (todo) => {
      const reason = `Run requires human review before this Todo could start: ${input.evidence}`;
      const completionGateResult = {
        version: 1,
        todoId: todo.id,
        todoSeq: todo.seq,
        procedureId: todo.procedureId ?? null,
        status: 'needs_human',
        passed: false,
        reason,
        checks: [
          {
            id: 'run_needs_human',
            passed: false,
            evidence: input.evidence,
          },
        ],
        evidence: {
          terminalState: 'needs_human',
          riskLevel: 'medium',
          summaryDigest: digestText(reason),
        },
      };
      await repo.updateTaskRunTodo(
        todo.id,
        {
          status: 'needs_human',
          statusReason: reason,
          completionGateResult,
          completedAt,
          startedAt: todo.startedAt ? new Date(String(todo.startedAt)) : completedAt,
        },
        { notifyTaskId: input.taskId, notifyRunId: input.runId }
      );
      await repo.createRunEvent({
        version: 1,
        runId: input.runId,
        taskId: input.taskId,
        timestamp: completedAt.toISOString(),
        type: 'turn.finished',
        severity: 'warning',
        actor: 'system',
        message: `Todo #${todo.seq} needs attention because the run stopped: ${todo.title}`,
        data: {
          todoId: todo.id,
          todoSeq: todo.seq,
          todoTitle: todo.title,
          taskType: todo.taskType,
          procedureId: todo.procedureId ?? null,
          completionGateResult,
        },
      });
    })
  );
}

async function closeOpenTodosForCancelledRun(input: {
  runId: string;
  taskId: string;
  todos: Array<{
    id: string;
    seq: number;
    title: string;
    taskType: string;
    status: string;
    procedureId?: string | null;
    startedAt?: unknown;
  }>;
  evidence?: string;
}) {
  const openTodos = listOpenTodos(input.todos);
  if (openTodos.length === 0) return;

  const completedAt = new Date();
  await Promise.all(
    openTodos.map(async (todo) => {
      const status = todo.status === 'running' ? 'failed' : 'skipped';
      const reason =
        status === 'failed'
          ? 'Run was cancelled while this Todo was active.'
          : 'Skipped because the run was cancelled before this Todo started.';
      const completionGateResult = {
        version: 1,
        todoId: todo.id,
        todoSeq: todo.seq,
        procedureId: todo.procedureId ?? null,
        status,
        passed: false,
        reason,
        checks: [
          {
            id: 'run_cancelled',
            passed: false,
            evidence: input.evidence || 'cancelled',
          },
        ],
        evidence: {
          terminalState: 'cancelled',
          stoppedBy: 'cancelled',
          riskLevel: 'medium',
          summaryDigest: digestText(reason),
        },
      };
      await repo.updateTaskRunTodo(
        todo.id,
        {
          status,
          statusReason: reason,
          completionGateResult,
          completedAt,
          startedAt: todo.startedAt ? new Date(String(todo.startedAt)) : completedAt,
        },
        { notifyTaskId: input.taskId, notifyRunId: input.runId }
      );
      await repo.createRunEvent({
        version: 1,
        runId: input.runId,
        taskId: input.taskId,
        timestamp: new Date().toISOString(),
        type: 'turn.finished',
        severity: status === 'failed' ? 'warning' : 'info',
        actor: 'system',
        message: `Todo #${todo.seq} ${status} because the run was cancelled: ${todo.title}`,
        data: {
          todoId: todo.id,
          todoSeq: todo.seq,
          todoTitle: todo.title,
          taskType: todo.taskType,
          procedureId: todo.procedureId ?? null,
          completionGateResult,
        },
      });
    })
  );
}

async function closeOpenTodosForFailedRun(input: {
  runId: string;
  taskId: string;
  todos: Array<{
    id: string;
    seq: number;
    title: string;
    taskType: string;
    status: string;
    procedureId?: string | null;
    startedAt?: unknown;
  }>;
  evidence: string;
  terminalReason?: string | null;
  stoppedBy?: string | null;
}) {
  const openTodos = listOpenTodos(input.todos);
  if (openTodos.length === 0) return;

  const completedAt = new Date();
  await Promise.all(
    openTodos.map(async (todo) => {
      const status =
        todo.status === 'running' || isContextStillMcpGateTodo(todo) ? 'failed' : 'skipped';
      const reason =
        status === 'failed'
          ? todo.status === 'running'
            ? `Runtime failed while this Todo was active: ${input.evidence}`
            : `Runtime failed before this required contextStill MCP gate could run: ${input.evidence}`
          : `Skipped because the runtime failed before this Todo started: ${input.evidence}`;
      const statusReason = input.terminalReason || reason;
      const completionGateResult = {
        version: 1,
        todoId: todo.id,
        todoSeq: todo.seq,
        procedureId: todo.procedureId ?? null,
        status,
        passed: false,
        reason,
        checks: [
          {
            id: 'run_failed',
            passed: false,
            evidence: input.evidence,
          },
        ],
        evidence: {
          terminalState: 'failed',
          stoppedBy: input.stoppedBy || 'llm_error',
          terminalReason: input.terminalReason ?? null,
          riskLevel: 'high',
          summaryDigest: digestText(reason),
        },
      };
      await repo.updateTaskRunTodo(
        todo.id,
        {
          status,
          statusReason,
          completionGateResult,
          completedAt,
          startedAt: todo.startedAt ? new Date(String(todo.startedAt)) : completedAt,
        },
        { notifyTaskId: input.taskId, notifyRunId: input.runId }
      );
      await repo.createRunEvent({
        version: 1,
        runId: input.runId,
        taskId: input.taskId,
        timestamp: completedAt.toISOString(),
        type: 'turn.finished',
        severity: status === 'failed' ? 'error' : 'warning',
        actor: 'system',
        message: `Todo #${todo.seq} ${status} because the runtime failed: ${todo.title}`,
        data: {
          todoId: todo.id,
          todoSeq: todo.seq,
          todoTitle: todo.title,
          taskType: todo.taskType,
          procedureId: todo.procedureId ?? null,
          completionGateResult,
        },
      });
    })
  );
}

function isContextStillMcpGateTodo(todo: { procedureId?: string | null }) {
  return todo.procedureId?.startsWith('contextstill.') === true;
}

function isPlanningOnlyRun<TTodo extends { taskType: string }>(todos: TTodo[]) {
  return todos.length === 0;
}

function toAgentRuntimeTodoContext(
  todo: Awaited<ReturnType<typeof repo.listTaskRunTodosForRun>>[number]
) {
  return {
    id: todo.id,
    seq: todo.seq,
    title: todo.title,
    description: todo.description,
    taskType: todo.taskType,
    status: todo.status,
    procedureId: todo.procedureId,
  };
}

const IMPLEMENTATION_PHASE_PREAMBLE = [
  '実装フェーズに移行しました。',
  'plan mode はこの時点で終了です。',
  'ここからは計画相談ではなく、実装・検証・必要な修正・closeout まで最後までやり切ってください。',
  'Todo を作成・更新する場合も、この実装フェーズ前提で進めてください。',
].join('\n');

function injectImplementationPhaseContext(latestUserMessage: string) {
  return `${IMPLEMENTATION_PHASE_PREAMBLE}\n\n${latestUserMessage}`.trim();
}

function executionPhasePreambleForMode(mode: NativeApiExecutionMode, latestUserMessage: string) {
  return mode === 'implementation'
    ? injectImplementationPhaseContext(latestUserMessage)
    : latestUserMessage.trim();
}

function readMessageLlmRouteOverride(
  message: Awaited<ReturnType<typeof repo.listTaskMessages>>[number] | undefined
): StructuredLlmModelTarget | null {
  const metadata =
    message?.metadataJson &&
    typeof message.metadataJson === 'object' &&
    !Array.isArray(message.metadataJson)
      ? (message.metadataJson as Record<string, unknown>)
      : {};
  return normalizeStructuredLlmModelTarget(metadata.llmSelection);
}

function resolveRuntimeLaneForRoleRoute(
  fallback: RuntimeLaneResolution,
  route: ResolvedStructuredLlmRoute | null,
  executionMode: NativeApiExecutionMode
): RuntimeLaneResolution {
  if (!route) return fallback;
  const lane = route.providerId === 'codex' ? 'codex-sdk' : 'native-api-runner';
  const roleLabel = route.role === 'implementation' ? 'Implementation' : `${route.role}`;
  return {
    lane,
    workerKind: lane === 'codex-sdk' ? 'codex-agent' : 'native-local',
    source: 'role_route',
    diagnostics: [
      ...fallback.diagnostics,
      {
        level: 'info',
        message:
          route.role === 'implementation'
            ? `Implementation role route selected ${lane} for ${route.providerEndpointId}/${route.model} via ${route.source}.`
            : `${roleLabel} role route selected ${lane} for ${route.providerEndpointId}/${route.model} via ${route.source}.`,
      },
      ...(route.providerId !== 'codex' && fallback.lane === 'codex-sdk'
        ? [
            {
              level: 'warning' as const,
              message:
                executionMode === 'implementation'
                  ? 'IMPLEMENTATION_RUNTIME_LANE requested codex-sdk, but the implementation role route is an API provider. Native/API implementation uses native-api-runner for this run.'
                  : 'IMPLEMENTATION_RUNTIME_LANE requested codex-sdk, but the routed API provider requires native-api-runner for this run.',
            },
          ]
        : []),
      ...(route.providerId === 'codex' && fallback.lane !== 'codex-sdk'
        ? [
            {
              level: 'warning' as const,
              message:
                'Implementation role route points at a Codex provider endpoint. Use a non-Codex implementation route to stay on native/API lane.',
            },
          ]
        : []),
    ],
  };
}

function summarizeResolvedRoute(route: ResolvedStructuredLlmRoute) {
  return {
    role: route.role,
    providerEndpointId: route.providerEndpointId,
    providerId: route.providerId,
    providerAdapter: providerAdapterKey(route.providerId),
    endpointName: route.endpoint.name,
    endpointKind: route.endpoint.kind,
    model: route.model,
    thinkingDepth: route.thinkingDepth || null,
    source: route.source,
    routeKey: structuredLlmRouteKey(route),
    diagnostics: route.diagnostics,
  };
}

const STRUCTURED_LLM_ROLES: StructuredLlmRole[] = [
  'plan',
  'evaluation',
  'implementation',
  'test',
  'review',
  'quality_gate',
  'completion',
];

function buildEffectiveLlmRoutingSnapshot(input: {
  activeRole: StructuredLlmRole;
  executionMode: NativeApiExecutionMode;
  settings: StructuredLlmProviderSettings;
  activeRoute: ResolvedStructuredLlmRoute | null;
  override: StructuredLlmModelTarget | null;
}) {
  const roles = Object.fromEntries(
    STRUCTURED_LLM_ROLES.map((role) => {
      const candidates = resolveStructuredLlmRoleRouteCandidates({
        role,
        settings: input.settings,
        override: role === input.activeRole ? input.override : null,
      }).map(summarizeResolvedRoute);
      return [
        role,
        {
          primary: candidates.find((candidate) => candidate.source === 'primary') ?? null,
          fallbacks: candidates.filter((candidate) => candidate.source === 'fallback'),
          override: candidates.find((candidate) => candidate.source === 'override') ?? null,
          candidates,
        },
      ];
    })
  );
  return {
    activeRole: input.activeRole,
    executionMode: input.executionMode,
    settingsRevision: input.settings.settingsRevision ?? null,
    endpointIdSchemaVersion: input.settings.endpointIdSchemaVersion ?? null,
    routePolicyDigest: 'native-api:no-codex:explicit-only',
    active: input.activeRoute ? summarizeResolvedRoute(input.activeRoute) : null,
    implementation:
      input.activeRoute?.role === 'implementation'
        ? summarizeResolvedRoute(input.activeRoute)
        : null,
    plan: input.activeRoute?.role === 'plan' ? summarizeResolvedRoute(input.activeRoute) : null,
    review: input.activeRoute?.role === 'review' ? summarizeResolvedRoute(input.activeRoute) : null,
    roles,
    override: input.override,
  };
}

async function safelyRefreshConversationContext(input: RefreshConversationContextInput) {
  if (!isConversationContextBuildOnIdleEnabled()) return;
  try {
    await refreshConversationContextSnapshot(input);
  } catch (error) {
    logger.warn(
      {
        error: toErrorMessage(error),
        taskId: input.taskId,
        runId: input.runId,
      },
      'conversation context refresh failed'
    );
  }
}

async function maybeLoadConversationStateCard(taskId: string, latestUserMessageId?: string | null) {
  if (!isConversationContextStateCardEnabled()) return null;
  try {
    const snapshot = await getLatestConversationContextForTask(taskId);
    if (snapshot?.latestUserMessageId && snapshot.latestUserMessageId === latestUserMessageId) {
      return null;
    }
    return snapshot;
  } catch (error) {
    logger.warn(
      {
        error: toErrorMessage(error),
        taskId,
      },
      'conversation context load failed'
    );
    return null;
  }
}

function resolveExecutionModeFromMessages(
  messages: Awaited<ReturnType<typeof repo.listTaskMessages>>
): NativeApiExecutionMode {
  for (const message of [...messages].reverse()) {
    const metadata = toRecord(message.metadataJson);
    if (isImplementationHandoffMessage(message, metadata)) {
      return 'implementation';
    }
    const selection = toRecord(metadata?.intakeJobSelection) ?? toRecord(metadata?.jobSelection);
    const jobType = typeof selection?.jobType === 'string' ? selection.jobType : null;
    if (jobType) {
      if (jobType === 'planning' || jobType === 'blueprint' || jobType === 'ui_ux') {
        return 'planning';
      }
      if (jobType === 'review') return 'review';
      if (jobType === 'runtime_debug') return 'runtime_debug';
      if (jobType === 'general_answer') return 'general_answer';
      return 'implementation';
    }
    if (message.role === 'user') return 'implementation';
  }
  return 'implementation';
}

function isImplementationHandoffMessage(
  message: Awaited<ReturnType<typeof repo.listTaskMessages>>[number],
  metadata: Record<string, unknown> | null
) {
  if (message.messageType !== 'markdown_document') return false;
  const intent = String(metadata?.intent || '').toLowerCase();
  return intent === 'implementation_plan' || intent === 'draft_spec';
}

function findLatestImplementationHandoffMessage(
  messages: Awaited<ReturnType<typeof repo.listTaskMessages>>
) {
  return [...messages].reverse().find((message) => {
    const metadata = toRecord(message.metadataJson);
    return isImplementationHandoffMessage(message, metadata);
  });
}

function buildCompiledPromptText(input: {
  task: NonNullable<Awaited<ReturnType<typeof repo.getTask>>>;
  lastUserMessage?: Awaited<ReturnType<typeof repo.listTaskMessages>>[number];
  implementationHandoffMessage?: Awaited<ReturnType<typeof repo.listTaskMessages>>[number];
}) {
  const userRequest =
    input.lastUserMessage?.content || input.task.description || input.task.objective || '';
  const handoff = input.implementationHandoffMessage?.content?.trim();
  if (!handoff) return userRequest;
  if (!userRequest.trim()) return handoff;
  return [
    '<USER_REQUEST>',
    userRequest.trim(),
    '</USER_REQUEST>',
    '',
    '<IMPLEMENTATION_HANDOFF>',
    handoff,
    '</IMPLEMENTATION_HANDOFF>',
  ].join('\n');
}

function buildLatestRuntimeUserMessage(input: {
  fallback: string;
  lastUserMessage?: Awaited<ReturnType<typeof repo.listTaskMessages>>[number];
  implementationHandoffMessage?: Awaited<ReturnType<typeof repo.listTaskMessages>>[number];
  executionMode: NativeApiExecutionMode;
}) {
  const latestUserText = input.lastUserMessage?.content?.trim() || input.fallback.trim();
  const handoff = input.implementationHandoffMessage?.content?.trim();
  if (input.executionMode !== 'implementation' || !handoff) {
    return executionPhasePreambleForMode(input.executionMode, latestUserText);
  }
  const hasDistinctUserRequest =
    Boolean(input.lastUserMessage?.content?.trim()) || latestUserText !== handoff;
  const userRequestSection = hasDistinctUserRequest
    ? ['<USER_REQUEST>', latestUserText, '</USER_REQUEST>', '']
    : [];
  return executionPhasePreambleForMode(
    input.executionMode,
    [
      ...userRequestSection,
      '<IMPLEMENTATION_HANDOFF>',
      '直近の Implementation Plan / Draft Spec を主な作業入力として扱ってください。',
      '計画に不足や矛盾がある場合は、必要な確認・調査 tool を使ってから実装してください。',
      '',
      handoff,
      '</IMPLEMENTATION_HANDOFF>',
    ].join('\n')
  );
}

async function loadCodexRuntimeResumeState(input: {
  taskId: string;
  repositoryId: string;
  executionMode: NativeApiExecutionMode;
}) {
  const store = new RuntimeSessionStateStore();
  const state = await store.getLatestRuntimeSessionStateForTask({
    taskId: input.taskId,
    repositoryId: input.repositoryId,
    runtimeLane: 'codex-sdk',
    provider: 'codex',
    executionMode: input.executionMode,
  });
  if (!state?.providerSessionId) {
    return {
      kind: 'codex_thread',
      status: 'unavailable',
      executionMode: input.executionMode,
    };
  }
  return {
    kind: 'codex_thread',
    status: 'available',
    stateId: state.id,
    sourceRunId: state.runId,
    providerThreadId: state.providerSessionId,
    executionMode: input.executionMode,
    model: state.model,
  };
}

export type StartTaskRunOptions = {
  executionMode?: NativeApiExecutionMode;
  executionModeSource?:
    | 'message_history'
    | 'workbench_intake'
    | 'workbench_run'
    | 'workbench_run_task'
    | 'implementation_queue'
    | 'session_queue'
    | 'explicit';
};

export async function startTaskRun(taskId: string, options: StartTaskRunOptions = {}) {
  const task = await repo.getTask(taskId);
  if (!task) {
    throw new NotFoundError('Task not found');
  }
  const activeRuns = await repo.listActiveTaskRunsForTask(taskId);
  if (activeRuns.length > 0) {
    throw new AppError(409, 'RUN_ALREADY_ACTIVE', 'Another run is already active for this task');
  }

  // 1. Mark the task as running while the runtime prompt is prepared.
  await repo.updateTaskStatus(taskId, 'running');

  // 2. Fetch repo information and create the run before compiling context.
  const repoInfo = await repo.getRepository(task.repositoryId);
  if (!repoInfo?.localPath) {
    throw new AppError(422, 'REPO_PATH_INVALID', 'Repository path is not configured');
  }
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(repoInfo.localPath);
  } catch {
    throw new AppError(422, 'REPO_PATH_INVALID', 'Repository path does not exist');
  }
  if (!stat.isDirectory()) {
    throw new AppError(422, 'REPO_PATH_INVALID', 'Repository path is not a directory');
  }
  const messages = await repo.listTaskMessages(taskId);
  const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user');
  const llmRouteOverride = readMessageLlmRouteOverride(lastUserMessage);
  const executionMode = options.executionMode ?? resolveExecutionModeFromMessages(messages);
  const executionModeSource = options.executionMode
    ? (options.executionModeSource ?? 'explicit')
    : 'message_history';
  const implementationHandoffMessage =
    executionMode === 'implementation'
      ? findLatestImplementationHandoffMessage(messages)
      : undefined;
  const compiledPromptText = buildCompiledPromptText({
    task,
    lastUserMessage,
    implementationHandoffMessage,
  });
  if (!compiledPromptText.trim()) {
    throw new AppError(400, 'EMPTY_PROMPT', 'No user message found to start a run');
  }
  const runtimeRole = nativeApiRoleForExecutionMode(executionMode);
  const blueprintReadiness =
    executionMode === 'general_answer' ? null : await resolveBlueprintPlanningReadiness(taskId);
  const blueprintPlanningSnapshot =
    executionMode === 'general_answer' ? {} : { blueprintPlanning: blueprintReadiness };
  const runtimeRoleLabel =
    executionMode === 'general_answer'
      ? 'general_answer'
      : runtimeRole === 'implementation'
        ? 'Implementation'
        : runtimeRole;
  const settings = getCurrentSettings();
  const planModeSettingsSnapshot = buildPlanModeSettingsSnapshot(readGeneralSettings());
  const baseRuntimeLaneResolution = resolveRuntimeLane({
    settingsRuntimeLane: settings.IMPLEMENTATION_RUNTIME_LANE,
    activeLlmProvider: settings.ACTIVE_LLM_PROVIDER,
    codexEnabled: settings.CODEX_ENABLED,
    ...readRuntimeLaneConfigFromEnv(),
  });
  const structuredLlmSettings = readStructuredLlmProviderSettings();
  const runtimeLlmRoute = resolveStructuredLlmRoleRoute({
    role: runtimeRole,
    settings: structuredLlmSettings,
    override: llmRouteOverride,
  });
  const runtimeLaneResolution = resolveRuntimeLaneForRoleRoute(
    baseRuntimeLaneResolution,
    runtimeLlmRoute,
    executionMode
  );
  const runtimeLaneDefinition = resolveRuntimeLaneDefinition(runtimeLaneResolution.lane);
  const effectiveLlmRouting = buildEffectiveLlmRoutingSnapshot({
    activeRole: runtimeRole,
    executionMode,
    settings: structuredLlmSettings,
    activeRoute: runtimeLlmRoute,
    override: llmRouteOverride,
  });
  const run = await repo.createTaskRun({
    taskId,
    repositoryId: task.repositoryId,
    status: 'running',
    workerKind: runtimeLaneResolution.workerKind,
    timeoutSeconds: task.timeoutSeconds,
    contextSnapshot: {
      compiledPrompt: compiledPromptText,
      executionMode,
      executionModeSource,
      planModeSettingsSnapshot,
      ...blueprintPlanningSnapshot,
      runtimeLane: runtimeLaneResolution.lane,
      runtimeLaneResolution: {
        workerKind: runtimeLaneResolution.workerKind,
        source: runtimeLaneResolution.source,
        diagnostics: runtimeLaneResolution.diagnostics,
      },
      effectiveLlmRouting,
    },
    startedAt: new Date(),
  });
  const runtimeLaneSetupInput = {
    compiledPromptText,
    executionMode,
    runtimeLaneResolution,
    implementationLlmRoute: runtimeLlmRoute,
    llmRouteOverride,
    planModeSettingsSnapshot,
  };
  const runtimeOptions = runtimeLaneDefinition.buildRuntimeOptions(runtimeLaneSetupInput);
  const initialTodos = runtimeLaneDefinition.buildInitialTodos(runtimeLaneSetupInput);
  const todoWorkflowSettings =
    executionMode === 'planning' || executionMode === 'general_answer'
      ? null
      : await getTodoWorkflowSettings();
  await repo.replaceTaskRunTodosForRun(
    run.id,
    executionMode === 'planning' || executionMode === 'general_answer'
      ? []
      : buildStandardImplementationTodoList({
          todos: initialTodos,
          startFirst: true,
          includeKnowledgeCapture: todoWorkflowSettings?.requireRegisterCandidatePrompt ?? true,
        })
  );

  await repo.createRunEvent({
    version: 1,
    runId: run.id,
    taskId,
    timestamp: new Date().toISOString(),
    type: 'run.created',
    severity: 'info',
    actor: 'system',
    message: 'Task run created. Runtime prompt is being prepared.',
    data: {
      contextSource: 'task_prompt',
      executionMode,
      executionModeSource,
      runtimeRole,
      planModeSettingsSnapshot,
      ...blueprintPlanningSnapshot,
      runtimeLane: runtimeLaneResolution.lane,
      workerKind: runtimeLaneResolution.workerKind,
      runtimeLaneResolution,
      effectiveLlmRouting,
    },
  });
  await repo.createRunEvent({
    version: 1,
    runId: run.id,
    taskId,
    timestamp: new Date().toISOString(),
    type: 'system.info',
    severity: 'info',
    actor: 'system',
    message: runtimeLlmRoute
      ? `${runtimeRoleLabel} LLM route resolved: ${runtimeLlmRoute.model} (${runtimeLlmRoute.providerEndpointId}); runtime lane=${runtimeLaneResolution.lane} worker=${runtimeLaneResolution.workerKind}.`
      : `${runtimeRoleLabel} LLM route was not configured; runtime lane=${runtimeLaneResolution.lane} worker=${runtimeLaneResolution.workerKind}.`,
    data: {
      effectiveLlmRouting,
      executionMode,
      runtimeRole,
      runtimeLane: runtimeLaneResolution.lane,
      workerKind: runtimeLaneResolution.workerKind,
      runtimeLaneResolution,
    },
  });
  const contextSnapshot: RuntimePromptSnapshot = {
    compiledPrompt: compiledPromptText,
    source: 'task_prompt',
    degraded: false,
    executionMode,
    executionPhase: executionMode,
    executionModeSource,
    planModeClosed: executionMode !== 'planning',
    planModeSettingsSnapshot,
    ...blueprintPlanningSnapshot,
    runtimeLane: runtimeLaneResolution.lane,
    runtimeLaneResolution: {
      workerKind: runtimeLaneResolution.workerKind,
      source: runtimeLaneResolution.source,
      diagnostics: runtimeLaneResolution.diagnostics,
    },
    effectiveLlmRouting,
    request: {
      repositoryPath: repoInfo.localPath,
      taskTitle: task.title,
      taskDescriptionDigest: digestText(
        lastUserMessage?.content || task.description || task.objective || ''
      ),
    },
    result: {
      digest: digestText(compiledPromptText),
      charCount: compiledPromptText.length,
    },
  };

  const rawLatestUserMessage = buildLatestRuntimeUserMessage({
    fallback: lastUserMessage?.content || task.description || task.objective || compiledPromptText,
    lastUserMessage,
    implementationHandoffMessage,
    executionMode,
  });
  const conversationContext = await maybeLoadConversationStateCard(taskId, lastUserMessage?.id);
  const projectedStateCard = projectConversationStateCardForRuntime({
    snapshot: conversationContext,
    role: stateCardRoleForExecutionMode(executionMode),
    workKind: executionMode === 'general_answer' ? null : runtimeRole,
  });
  const runtimePromptParts = buildPromptWithStateCardParts({
    latestUserMessage: rawLatestUserMessage,
    stateCardText: projectedStateCard.stateCardText,
  });
  const runtimeLatestUserMessage = runtimePromptParts.promptText;
  let runtimeContextSnapshot: RuntimePromptSnapshot = {
    ...contextSnapshot,
    executionPhase: executionMode,
    planModeClosed: executionMode !== 'planning',
    ...(executionMode === 'implementation'
      ? { implementationPhasePreamble: IMPLEMENTATION_PHASE_PREAMBLE }
      : {}),
    conversationContext: conversationContext
      ? {
          snapshotId: conversationContext.id,
          version: conversationContext.version,
          tokenEstimate: conversationContext.tokenEstimate,
          stateCardIncluded: Boolean(projectedStateCard.stateCardText),
          ...(projectedStateCard.stateCardText
            ? { stateCardText: projectedStateCard.stateCardText }
            : {}),
          snapshotJson: conversationContext.snapshotJson,
          projection: projectedStateCard.projection,
          usage: {
            latestUserMessageTokens: runtimePromptParts.estimates.latestUserMessageTokens,
            stateCardTokens: runtimePromptParts.estimates.stateCardTokens,
            runtimeUserPromptTokens: runtimePromptParts.estimates.promptTokens,
          },
        }
      : {
          stateCardIncluded: false,
          projection: projectedStateCard.projection,
          usage: {
            latestUserMessageTokens: runtimePromptParts.estimates.latestUserMessageTokens,
            stateCardTokens: 0,
            runtimeUserPromptTokens: runtimePromptParts.estimates.promptTokens,
          },
        },
  };
  if (runtimeLaneResolution.lane === 'native-api-runner') {
    try {
      const roleContextTodos = await repo.listTaskRunTodosForRun(run.id);
      const roleContextBase = buildNativeApiRoleContextSnapshot({
        context: {
          runId: run.id,
          taskId,
          repositoryId: task.repositoryId,
          repoRoot: repoInfo.localPath,
          compiledPrompt: compiledPromptText,
          latestUserMessage: runtimeLatestUserMessage,
          timeoutSeconds: task.timeoutSeconds ?? 3600,
          safetyPolicy: repoInfo.safetyPolicy || undefined,
          contextSnapshot: runtimeContextSnapshot,
          runtimeOptions,
          todoPlan: roleContextTodos.map(toAgentRuntimeTodoContext),
          currentTodo: roleContextTodos
            .filter((todo) => todo.status === 'running')
            .sort((a, b) => a.seq - b.seq)
            .map(toAgentRuntimeTodoContext)[0],
        },
      });
      const handoffEvent = await repo.createRunEvent({
        version: 1,
        runId: run.id,
        taskId,
        timestamp: roleContextBase.handoff.createdAt,
        type: 'context.handoff_created',
        severity: 'info',
        actor: 'runtime',
        message: 'Role handoff artifact created for run-start boundary.',
        data: {
          artifact: roleContextBase.handoff,
          source: 'deterministic',
        },
      });
      const workingContextEvent = await repo.createRunEvent({
        version: 1,
        runId: run.id,
        taskId,
        timestamp: roleContextBase.workingContext.createdAt,
        type: 'context.working_context_created',
        severity: 'info',
        actor: 'runtime',
        message: 'Role working context created for provider history.',
        data: {
          artifact: roleContextBase.workingContext,
          source: 'deterministic',
        },
      });
      runtimeContextSnapshot = {
        ...runtimeContextSnapshot,
        roleContext: {
          ...roleContextBase.snapshot,
          handoff: {
            ...roleContextBase.snapshot.handoff,
            eventSeq: handoffEvent?.seq ?? null,
            eventId: handoffEvent?.id ?? null,
          },
          workingContext: {
            ...roleContextBase.snapshot.workingContext,
            eventSeq: workingContextEvent?.seq ?? null,
            eventId: workingContextEvent?.id ?? null,
          },
        },
      };
    } catch (error) {
      const errorMessage = toErrorMessage(error);
      const failureType = /handoff/i.test(errorMessage)
        ? 'context.handoff_failed'
        : 'context.working_context_failed';
      await repo.createRunEvent({
        version: 1,
        runId: run.id,
        taskId,
        timestamp: new Date().toISOString(),
        type: failureType,
        severity: 'error',
        actor: 'runtime',
        message: `Role context generation failed before provider call: ${errorMessage}`,
        data: {
          source: 'deterministic',
          error: errorMessage,
        },
      });
      await repo.updateTaskCompiledPrompt(taskId, compiledPromptText);
      const failedRun = await repo.updateTaskRun(run.id, {
        status: 'needs_human',
        endedAt: new Date(),
        finishedAt: new Date(),
        contextSnapshot: runtimeContextSnapshot,
        finalReport: `Role context generation failed before provider call: ${errorMessage}`,
        finalJudgment: null,
        summary: 'Role context generation failed before provider call.',
      });
      await repo.updateTaskStatus(taskId, 'needs_human');
      return failedRun ?? run;
    }
  }

  if (runtimeLaneResolution.lane === 'codex-sdk') {
    const runtimeResume = await loadCodexRuntimeResumeState({
      taskId,
      repositoryId: task.repositoryId,
      executionMode,
    });
    runtimeContextSnapshot = {
      ...runtimeContextSnapshot,
      runtimeResume,
    };
    runtimeOptions.runtimeResume = runtimeResume;
    await repo.createRunEvent({
      version: 1,
      runId: run.id,
      taskId,
      timestamp: new Date().toISOString(),
      type: 'system.info',
      severity: runtimeResume.status === 'available' ? 'info' : 'warning',
      actor: 'system',
      message:
        runtimeResume.status === 'available'
          ? 'Codex runtime resume state loaded.'
          : 'Codex runtime resume state unavailable; runtime will start fresh.',
      data: {
        action: 'runtime.resume_state_loaded',
        runtimeResume,
      },
    });
  }

  await repo.updateTaskCompiledPrompt(taskId, compiledPromptText);
  const compiledRun = await repo.updateTaskRun(run.id, {
    status: 'running',
    contextSnapshot: runtimeContextSnapshot,
  });
  await repo.createRunEvent({
    version: 1,
    runId: run.id,
    taskId,
    timestamp: new Date().toISOString(),
    type: 'run.prompt_prepared',
    severity: 'info',
    actor: 'system',
    message: 'Runtime prompt prepared.',
    data: {
      source: contextSnapshot.source,
      degraded: false,
      digest: contextSnapshot.result.digest,
      charCount: contextSnapshot.result.charCount,
      runtimeLane: runtimeLaneResolution.lane,
      workerKind: runtimeLaneResolution.workerKind,
      runtimeLaneResolution,
      effectiveLlmRouting,
      executionMode,
      executionModeSource,
      runtimeRole,
    },
  });

  // Track logs in memory and create database event entries
  const runtime = runtimeLaneDefinition.createAdapter();
  const sink = createLedgerSink(run.id);

  // Asynchronously execute runner so that startTaskRun returns immediately
  (async () => {
    try {
      await repo.updateTaskStatus(taskId, 'running');
      const runtimeTodosBeforeStart = await repo.listTaskRunTodosForRun(run.id);
      let runtimeResult = await runtime.start(
        {
          runId: run.id,
          taskId,
          repositoryId: task.repositoryId,
          repoRoot: repoInfo.localPath,
          compiledPrompt: compiledPromptText,
          latestUserMessage: runtimeLatestUserMessage,
          timeoutSeconds: task.timeoutSeconds ?? 3600,
          safetyPolicy: repoInfo.safetyPolicy || undefined,
          contextSnapshot: runtimeContextSnapshot,
          runtimeOptions,
          todoPlan: runtimeTodosBeforeStart.map(toAgentRuntimeTodoContext),
          currentTodo: runtimeTodosBeforeStart
            .filter((todo) => todo.status === 'running')
            .sort((a, b) => a.seq - b.seq)
            .map(toAgentRuntimeTodoContext)[0],
        },
        sink
      );
      const latestRunBeforeFinalize = await repo.getTaskRun(run.id);
      const stopWasRequested =
        latestRunBeforeFinalize?.status === 'cancelled' ||
        runtimeResult.terminalState === 'cancelled';
      const runtimeContractWarnings = normalizeRuntimeContractWarnings(
        runtimeResult.contractWarnings
      );
      const contextSnapshotBeforeFinalize =
        latestRunBeforeFinalize?.contextSnapshot ?? runtimeContextSnapshot;

      await repo.createRunEvent({
        version: 1,
        runId: run.id,
        taskId,
        timestamp: new Date().toISOString(),
        type: 'run.runtime_finished',
        severity: 'checkpoint',
        actor: 'runtime',
        message: `Runtime execution finished with terminal status: ${runtimeResult.terminalState}.`,
        data: {
          terminalState: runtimeResult.terminalState,
          stoppedBy: runtimeResult.stoppedBy,
          riskLevel: runtimeResult.riskLevel,
          contractWarnings: runtimeContractWarnings,
        },
      });

      if (stopWasRequested) {
        const outcome = outcomeFromRuntimeResult(runtimeResult);
        const finalReport = runtimeResult.finalReport || outcome.summary;
        const todosBeforeCancelCloseout = await repo.listTaskRunTodosForRun(run.id);
        await closeOpenTodosForCancelledRun({
          runId: run.id,
          taskId,
          todos: todosBeforeCancelCloseout,
          evidence: runtimeResult.stoppedBy || runtimeResult.terminalState,
        });
        assertRunStatusTransition(latestRunBeforeFinalize?.status || 'running', 'cancelled');
        await repo.updateTaskRun(run.id, {
          status: 'cancelled',
          endedAt: new Date(),
          finishedAt: new Date(),
          logContent: runtimeResult.logContent,
          diffPatch: runtimeResult.diffPatch,
          testResults: runtimeResult.testResults,
          contextSnapshot: mergeRuntimeContractSnapshot(
            contextSnapshotBeforeFinalize,
            runtimeContractWarnings,
            { lane: runtimeLaneResolution.lane }
          ),
          finalReport,
          finalJudgment: null,
          summary: runtimeResult.summary || outcome.summary,
        });
        await repo.updateTaskStatus(taskId, 'ready');
        await completeImplementationQueueEntryForRun(run.id, 'cancelled');
        await repo.createTaskMessage({
          taskId,
          runId: run.id,
          role: 'assistant',
          content: finalReport,
          messageType: 'text',
          payloadJson: {
            finalReport,
            summary: runtimeResult.summary || outcome.summary,
            status: 'cancelled',
          },
        });
        await safelyRefreshConversationContext({
          taskId,
          runId: run.id,
          reason: 'run_finished',
        });
        return;
      }

      const preliminaryOutcome = outcomeFromRuntimeResult(runtimeResult);
      const todosBeforeCoverageFallback = await repo.listTaskRunTodosForRun(run.id);
      const coverageFallbackBlockedByOpenTodos =
        preliminaryOutcome.status === 'completed' &&
        listOpenTodos(todosBeforeCoverageFallback).length > 0 &&
        !isPlanningOnlyRun(todosBeforeCoverageFallback);
      if (!coverageFallbackBlockedByOpenTodos) {
        runtimeResult = await applyCoverageAutonomyFallback({
          runtimeResult,
          repoRoot: repoInfo.localPath,
          safetyPolicy: repoInfo.safetyPolicy || undefined,
          sink,
        });
      }

      const statusBeforeFinalize = latestRunBeforeFinalize?.status || 'running';
      const transitionTable: Record<string, readonly string[]> = runStatusTransitionTable;
      const canEnterFinalizing =
        statusBeforeFinalize === 'finalizing' ||
        transitionTable[statusBeforeFinalize]?.includes('finalizing') === true;
      const enteredFinalizing = canEnterFinalizing;

      if (statusBeforeFinalize !== 'finalizing' && canEnterFinalizing) {
        assertRunStatusTransition(statusBeforeFinalize, 'finalizing');
        await repo.updateTaskRun(run.id, {
          status: 'finalizing',
          logContent: runtimeResult.logContent,
          diffPatch: runtimeResult.diffPatch,
          testResults: runtimeResult.testResults,
          finalReport: runtimeResult.finalReport,
          summary: runtimeResult.summary,
        });
        await repo.updateTaskStatus(taskId, 'finalizing');
      } else {
        await repo.updateTaskRun(run.id, {
          logContent: runtimeResult.logContent,
          diffPatch: runtimeResult.diffPatch,
          testResults: runtimeResult.testResults,
          finalReport: runtimeResult.finalReport,
          summary: runtimeResult.summary,
        });
      }
      await repo.createRunEvent({
        version: 1,
        runId: run.id,
        taskId,
        timestamp: new Date().toISOString(),
        type: 'run.finalizing_started',
        severity: 'info',
        actor: 'system',
        message: 'Runtime result captured.',
        data: {
          terminalState: runtimeResult.terminalState,
          previousStatus: statusBeforeFinalize,
          finalizingTransitionApplied: enteredFinalizing,
        },
      });

      const outcome = outcomeFromRuntimeResult(runtimeResult);
      let finalTodos = coverageFallbackBlockedByOpenTodos
        ? todosBeforeCoverageFallback
        : await repo.listTaskRunTodosForRun(run.id);
      if (outcome.status === 'needs_human') {
        await markRunningTodosNeedsHuman({
          runId: run.id,
          taskId,
          todos: finalTodos,
          runtimeResult,
          outcomeStatus: outcome.status,
        });
        finalTodos = await repo.listTaskRunTodosForRun(run.id);
        await closePendingTodosForNeedsHumanRun({
          runId: run.id,
          taskId,
          todos: finalTodos,
          evidence: runtimeResult.finalReport || runtimeResult.summary || outcome.summary,
        });
        finalTodos = await repo.listTaskRunTodosForRun(run.id);
      }
      if (outcome.status === 'failed') {
        const terminalReason = readRuntimeFailureTerminalReason(runtimeResult) ?? outcome.reason;
        await closeOpenTodosForFailedRun({
          runId: run.id,
          taskId,
          todos: finalTodos,
          evidence: runtimeResult.finalReport || runtimeResult.summary || outcome.summary,
          terminalReason,
          stoppedBy: runtimeResult.stoppedBy,
        });
        finalTodos = await repo.listTaskRunTodosForRun(run.id);
      }
      const openTodos = listOpenTodos(finalTodos);
      const todoFinalizationBlocked =
        outcome.status === 'completed' && openTodos.length > 0 && !isPlanningOnlyRun(finalTodos);
      const openTodoWarning = todoFinalizationBlocked
        ? buildOpenTodoRuntimeContractWarning(openTodos)
        : null;
      const finalContractWarnings = openTodoWarning
        ? [...runtimeContractWarnings, openTodoWarning]
        : runtimeContractWarnings;
      const guardedStatus = todoFinalizationBlocked ? 'needs_human' : outcome.status;
      const finalReport = todoFinalizationBlocked
        ? [
            runtimeResult.finalReport || outcome.summary,
            '',
            `Todo closeout incomplete: ${openTodos.map((todo) => `#${todo.seq} ${todo.title} (${todo.status})`).join(', ')}`,
            'Codex contract warning: codex_open_todos_before_completion.',
          ]
            .filter(Boolean)
            .join('\n')
        : runtimeResult.finalReport || outcome.summary;
      const statusBeforeOutcome = enteredFinalizing ? 'finalizing' : statusBeforeFinalize;
      assertRunStatusTransition(statusBeforeOutcome, guardedStatus);
      await repo.updateTaskRun(run.id, {
        status: guardedStatus,
        endedAt: new Date(),
        finishedAt: new Date(),
        contextSnapshot: mergeRuntimeContractSnapshot(
          contextSnapshotBeforeFinalize,
          finalContractWarnings,
          { lane: runtimeLaneResolution.lane }
        ),
        finalReport,
        finalJudgment: null,
        summary: todoFinalizationBlocked
          ? 'Runtime finished without explicitly closing all open Todos.'
          : runtimeResult.summary || outcome.summary,
      });
      if (todoFinalizationBlocked) {
        await repo.createRunEvent({
          version: 1,
          runId: run.id,
          taskId,
          timestamp: new Date().toISOString(),
          type: 'run.outcome_decided',
          severity: 'warning',
          actor: 'system',
          message:
            'Runtime finished before explicit Todo closeout; run cannot be marked completed.',
          data: {
            warningCode: 'codex_open_todos_before_completion',
            contractWarning: openTodoWarning,
            terminalState: outcome.status,
            nextStatus: guardedStatus,
            openTodos: openTodos.map((todo) => ({
              id: todo.id,
              seq: todo.seq,
              title: todo.title,
              status: todo.status,
            })),
          },
        });
      }
      await repo.updateTaskStatus(taskId, guardedStatus);
      await completeImplementationQueueEntryForRun(run.id, guardedStatus);
      if (shouldContinueSessionQueue(guardedStatus)) {
        void runSessionQueueForRepository(task.repositoryId);
      }

      await createPlanningArtifactMessageIfNeeded({
        taskId,
        runId: run.id,
        finalReport,
      });
      await repo.createTaskMessage({
        taskId,
        runId: run.id,
        role: 'assistant',
        content: finalReport,
        messageType: 'text',
        payloadJson: {
          finalReport,
          summary: runtimeResult.summary || outcome.summary,
          status: guardedStatus,
        },
      });
      await safelyRefreshConversationContext({
        taskId,
        runId: run.id,
        reason: 'run_finished',
      });
    } catch (err: unknown) {
      const errorMessage = toErrorMessage(err);
      logger.error({ error: errorMessage, runId: run.id }, 'NativeLocalRunner execution failed');
      const finalReport = `実行に失敗しました: ${errorMessage}`;
      const todosBeforeFailedCloseout = await repo.listTaskRunTodosForRun(run.id);
      await closeOpenTodosForFailedRun({
        runId: run.id,
        taskId,
        todos: todosBeforeFailedCloseout,
        evidence: errorMessage,
      });
      await repo.updateTaskStatus(taskId, 'failed');
      assertRunStatusTransition('running', 'failed');
      await repo.updateTaskRun(run.id, {
        status: 'failed',
        endedAt: new Date(),
        finishedAt: new Date(),
        logContent: `[System Error] ${errorMessage}`,
        finalReport,
        finalJudgment: null,
        summary: `Execution crashed: ${errorMessage}`,
      });
      await completeImplementationQueueEntryForRun(run.id, 'failed');
      if (shouldContinueSessionQueue('failed')) {
        void runSessionQueueForRepository(task.repositoryId);
      }

      await repo.createTaskMessage({
        taskId,
        runId: run.id,
        role: 'assistant',
        content: finalReport,
        messageType: 'text',
        payloadJson: {
          finalReport,
          summary: `Execution crashed: ${errorMessage}`,
          status: 'failed',
        },
      });
      await safelyRefreshConversationContext({
        taskId,
        runId: run.id,
        reason: 'run_finished',
      });
    }
  })();

  return compiledRun ?? run;
}

export async function stopTaskRun(runId: string) {
  const run = await repo.getTaskRun(runId);
  if (!run) {
    throw new NotFoundError('Run not found');
  }
  if (!['running', 'context_compiling', 'compiling_context', 'finalizing'].includes(run.status)) {
    return run;
  }

  const runtime = resolveAgentRuntime(normalizeAgentRuntimeKind(run.workerKind));
  await runtime.stop(runId);
  await repo.createRunEvent({
    version: 1,
    runId,
    taskId: run.taskId,
    timestamp: new Date().toISOString(),
    type: 'run.stop_requested',
    severity: 'warning',
    actor: 'human',
    message: 'User requested run stop from the composer.',
    data: {
      workerKind: run.workerKind,
      previousStatus: run.status,
    },
  });
  const todosBeforeCancelCloseout = await repo.listTaskRunTodosForRun(runId);
  await closeOpenTodosForCancelledRun({
    runId,
    taskId: run.taskId,
    todos: todosBeforeCancelCloseout,
    evidence: 'user_stop_requested',
  });
  assertRunStatusTransition(run.status, 'cancelled');
  const stoppedRun = await repo.updateTaskRun(runId, {
    status: 'cancelled',
    endedAt: new Date(),
    finishedAt: new Date(),
    summary: run.summary || 'Run stop requested by user.',
    finalReport: run.finalReport || 'Run stop requested by user.',
  });
  await repo.updateTaskStatus(run.taskId, 'ready');
  await completeImplementationQueueEntryForRun(runId, 'cancelled');
  return stoppedRun ?? run;
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getSessionQueueMaxConcurrency() {
  return getSessionQueueMaxConcurrencyFromEnv();
}

function normalizeAgentRuntimeKind(value: unknown): AgentRuntimeKind {
  if (
    value === 'native-local' ||
    value === 'codex-agent' ||
    value === 'external-process' ||
    value === 'future-adapter'
  ) {
    return value;
  }
  return 'native-local';
}

export function shouldContinueSessionQueue(status: string) {
  return ['completed', 'cancelled', 'failed'].includes(status);
}

let implementationQueueDrainPromise: Promise<void> | null = null;

export async function runImplementationQueue() {
  if (implementationQueueDrainPromise) {
    await implementationQueueDrainPromise;
    return [];
  }
  const started: Awaited<ReturnType<typeof startTaskRun>>[] = [];
  implementationQueueDrainPromise = drainImplementationQueue(started).finally(() => {
    implementationQueueDrainPromise = null;
  });
  await implementationQueueDrainPromise;
  return started;
}

async function drainImplementationQueue(started: Awaited<ReturnType<typeof startTaskRun>>[]) {
  while (true) {
    const settings = await repo.getImplementationQueueSettings();
    const claimed = await repo.claimNextImplementationQueueEntry(settings.processorCount);
    if (!claimed) break;
    try {
      const run = await startTaskRun(claimed.taskId, {
        executionMode: 'implementation',
        executionModeSource: 'implementation_queue',
      });
      started.push(run);
      await repo.updateImplementationQueueEntry(claimed.id, {
        status: 'processing',
        activeRunId: run.id,
        lastHeartbeatAt: new Date(),
      });
      await repo.createTaskMessage({
        taskId: claimed.taskId,
        runId: run.id,
        role: 'system',
        content: `Implementation Queue processor ${claimed.processorSlot ?? 1} started this run.`,
        messageType: 'text',
        payloadJson: {
          source: 'implementation_queue',
          status: 'processing',
          queueEntryId: claimed.id,
          processorSlot: claimed.processorSlot,
        },
      });
    } catch (err) {
      await repo.updateImplementationQueueEntry(claimed.id, {
        status: 'failed',
        processorSlot: null,
        statusReason: err instanceof Error ? err.message : String(err),
      });
      await repo.createTaskMessage({
        taskId: claimed.taskId,
        role: 'system',
        content: `Implementation Queue failed to start this task: ${
          err instanceof Error ? err.message : String(err)
        }`,
        messageType: 'text',
        payloadJson: {
          source: 'implementation_queue',
          status: 'failed_to_start',
          queueEntryId: claimed.id,
        },
      });
      break;
    }
  }
}

export async function completeImplementationQueueEntryForRun(runId: string, status: string) {
  try {
    const entry = await repo.getImplementationQueueEntryForRun(runId);
    if (!entry) return;
    const nextStatus =
      status === 'completed'
        ? 'execution_completed'
        : status === 'cancelled'
          ? 'cancelled'
          : status === 'needs_human'
            ? 'needs_human'
            : 'failed';
    await repo.updateImplementationQueueEntry(entry.id, {
      status: nextStatus,
      processorSlot: null,
      lastHeartbeatAt: new Date(),
      statusReason: nextStatus === 'failed' ? `Run finished with status=${status}` : null,
    });
    if (['execution_completed', 'cancelled', 'failed'].includes(nextStatus)) {
      void runImplementationQueue();
    }
  } catch {
    // Queue bookkeeping must not change the run outcome.
  }
}

export async function archiveImplementationQueueEntryForRun(runId: string) {
  try {
    const entry = await repo.getImplementationQueueEntryForRun(runId);
    if (!entry || !['execution_completed', 'failed', 'cancelled'].includes(entry.status)) return;
    await repo.updateImplementationQueueEntry(entry.id, {
      status: 'execution_archived',
      processorSlot: null,
      archivedAt: new Date(),
    });
  } catch {
    // Queue archive bookkeeping must not change the review outcome.
  }
}

const pendingSessionQueueRepositoryIds = new Set<string>();
let sessionQueueDrainPromise: Promise<void> | null = null;

export async function runSessionQueueForRepository(repositoryId: string) {
  const started: Awaited<ReturnType<typeof startTaskRun>>[] = [];
  pendingSessionQueueRepositoryIds.add(repositoryId);
  if (sessionQueueDrainPromise) {
    await sessionQueueDrainPromise;
    return started;
  }

  sessionQueueDrainPromise = drainPendingSessionQueues(started).finally(() => {
    sessionQueueDrainPromise = null;
  });
  await sessionQueueDrainPromise;
  return started;
}

async function drainPendingSessionQueues(started: Awaited<ReturnType<typeof startTaskRun>>[]) {
  while (pendingSessionQueueRepositoryIds.size > 0) {
    const repositoryIds = [...pendingSessionQueueRepositoryIds];
    pendingSessionQueueRepositoryIds.clear();
    for (const repositoryId of repositoryIds) {
      started.push(...(await drainSessionQueueForRepository(repositoryId)));
    }
  }
}

async function drainSessionQueueForRepository(repositoryId: string) {
  const repository = await repo.getRepository(repositoryId);
  if (!repository?.queueEnabled) return [];

  const started: Awaited<ReturnType<typeof startTaskRun>>[] = [];
  while (true) {
    const globalActive = await repo.countActiveTaskRuns();
    const globalLimit = getSessionQueueMaxConcurrency();
    if (globalActive >= globalLimit) break;

    const projectActive = await repo.countActiveTaskRuns(repositoryId);
    const projectLimit = Math.max(1, Math.floor(repository.maxConcurrentSessions || 1));
    if (projectActive >= projectLimit) break;

    const nextTask = await repo.claimNextQueuedTask(repositoryId);
    if (!nextTask) break;

    try {
      const run = await startTaskRun(nextTask.id, {
        executionMode: 'implementation',
        executionModeSource: 'session_queue',
      });
      started.push(run);
    } catch (err) {
      await repo.updateTaskStatus(nextTask.id, 'failed');
      await repo.createTaskMessage({
        taskId: nextTask.id,
        role: 'system',
        content: `Session queue failed to start this task: ${err instanceof Error ? err.message : String(err)}`,
        messageType: 'text',
        payloadJson: { source: 'session_queue', status: 'failed_to_start' },
      });
      break;
    }
  }
  return started;
}
