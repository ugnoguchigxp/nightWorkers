import path from 'node:path';
import { getNightWorkersCodexToolNames } from '../../mcp/nightworkers-tool-manifest';
import * as repo from '../../modules/nightworkers/nightworkers.repository';
import { recordLlmUsage } from '../llm-usage';
import { gitDiffTool } from '../worker-tools/git';
import { type CodexThreadFactory, createCodexRuntimeThread } from './codex-sdk/codex-sdk-client';
import {
  createCodexEventMapperState,
  mapCodexThreadEvent,
  normalizeCodexCommand,
} from './codex-sdk/codex-sdk-event-adapter';
import {
  buildProjectImportCancelledReport,
  buildProjectImportFailureReport,
  getProjectImportOutcome,
} from './codex-sdk/codex-sdk-import-policy';
import {
  addContractWarning,
  buildCodexRuntimeContractSnapshot,
  type CodexReadEvidence,
  type CodexRuntimeAuditState,
  createCodexRuntimeAuditState,
  normalizeContractWarning,
  type RuntimeTodoEvidence,
  type RuntimeTodoEvidenceReadResult,
} from './codex-sdk/codex-sdk-mcp-audit';
import { buildCodexRuntimePrompt } from './codex-sdk/codex-sdk-runtime-prompt';
import {
  type RuntimeUsageRecorder,
  recordCodexRuntimeUsageIfPresent,
} from './codex-sdk/codex-sdk-usage';
import { RuntimeSessionStateStore } from './runtime-session-state';
import type {
  AgentRunContext,
  AgentRuntime,
  AgentRuntimeEvent,
  AgentRuntimeResult,
  AgentRuntimeSink,
  CodexContractWarning,
} from './types';
import { normalizeVerificationCommand, verificationCommandsMatch } from './verification-command';

export type { CodexThreadFactory } from './codex-sdk/codex-sdk-client';
export { buildCodexRuntimePrompt } from './codex-sdk/codex-sdk-runtime-prompt';

const DEFAULT_RESULT: AgentRuntimeResult = {
  terminalState: 'failed',
  summary: 'Codex Agent Runtime failed.',
  finalReport: '',
  stoppedBy: 'llm_error',
  riskLevel: 'high',
};

type CodexTerminalReason =
  | 'provider_capacity'
  | 'codex_exec_nonzero'
  | 'unrecovered_tool_failure'
  | 'unknown_runtime_error';

type CodexRuntimeFailureEvidence = {
  reason: CodexTerminalReason;
  message: string;
  source: 'runtime_error' | 'turn_failed' | 'stream_error' | 'exec_exit';
  rawMessage?: string;
};

type CodexExecExitError = {
  detail: string | null;
  message: string;
  stderr: string;
};

type CodexObservedFileChange = {
  filePath: string;
  providerItemId: string | null;
  observedAtMs: number;
};

type CodexToolFailureDiagnostic = {
  kind: 'apply_patch_verification_failed';
  filePath: string | null;
  recovered: boolean;
  reason: CodexTerminalReason;
  message: string;
};

type CodexFailureReport = {
  reason: CodexTerminalReason;
  summary: string;
  diagnostics: string[];
  execExitError: CodexExecExitError | null;
  recoveredToolFailures: CodexToolFailureDiagnostic[];
  unrecoveredToolFailures: CodexToolFailureDiagnostic[];
};

export class CodexAgentRuntime implements AgentRuntime {
  readonly kind = 'codex-agent' as const;
  private cancelledRunIds = new Set<string>();
  private readonly threadFactory?: CodexThreadFactory;
  private readonly runtimeSessionStore: RuntimeSessionStateStore;
  private readonly persistRuntimeSessionState: boolean;
  private readonly collectWorkspaceDiff: boolean;
  private readonly persistRuntimeUsage: boolean;
  private readonly usageRecorder: RuntimeUsageRecorder;

  constructor(
    input: {
      threadFactory?: CodexThreadFactory;
      runtimeSessionStore?: RuntimeSessionStateStore;
      persistRuntimeSessionState?: boolean;
      collectWorkspaceDiff?: boolean;
      persistRuntimeUsage?: boolean;
      usageRecorder?: RuntimeUsageRecorder;
    } = {}
  ) {
    this.threadFactory = input.threadFactory;
    this.runtimeSessionStore = input.runtimeSessionStore ?? new RuntimeSessionStateStore();
    this.persistRuntimeSessionState = input.persistRuntimeSessionState ?? !input.threadFactory;
    this.collectWorkspaceDiff = input.collectWorkspaceDiff ?? !input.threadFactory;
    this.persistRuntimeUsage = input.persistRuntimeUsage ?? !input.threadFactory;
    this.usageRecorder = input.usageRecorder ?? recordLlmUsage;
  }

  async start(
    context: AgentRunContext,
    sink: AgentRuntimeSink,
    signal?: AbortSignal
  ): Promise<AgentRuntimeResult> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const logs: string[] = [];
    let finalText = '';
    let terminalState: AgentRuntimeResult['terminalState'] = 'completed';
    let stoppedBy: AgentRuntimeResult['stoppedBy'] = 'decision';
    const mapperState = createCodexEventMapperState();
    const auditState = createCodexRuntimeAuditState({
      executionMode: readCodexRuntimeExecutionMode(context),
    });
    let lastRuntimeError: CodexRuntimeFailureEvidence | null = null;
    const completedFileChanges: CodexObservedFileChange[] = [];

    try {
      if (signal?.aborted || this.cancelledRunIds.has(context.runId)) {
        controller.abort();
        return this.toCancelled('');
      }

      const thread = await this.createThread(context, sink);
      const { events } = await thread.runStreamed(buildCodexRuntimePrompt(context), {
        signal: controller.signal,
      });

      for await (const event of events) {
        if (this.cancelledRunIds.has(context.runId)) {
          controller.abort();
          return this.toCancelled(logs.join('\n'));
        }
        const mappedEvents = mapCodexThreadEvent(event, mapperState);
        for (const mapped of mappedEvents) {
          const auditedEvents = await this.auditMappedEvent(context, auditState, mapped);
          for (const audited of auditedEvents) {
            logs.push(audited.message);
            await sink.emit(audited);
            if (this.persistRuntimeSessionState) {
              await persistCodexProviderThreadIfPresent(this.runtimeSessionStore, context, audited);
            }
          }
          const importOutcome = getProjectImportOutcome(mapped);
          if (importOutcome?.kind === 'cancelled') {
            addContractWarning(auditState, {
              code: 'codex_import_project_cancelled',
              severity: 'error',
              message:
                'nightworkers.import_project was cancelled. Fallback implementation is forbidden.',
              providerItemId: importOutcome.providerItemId,
              toolName: importOutcome.toolName,
            });
            return this.finishRun(context, sink, logs, {
              terminalState: 'cancelled',
              finalReport: buildProjectImportCancelledReport(importOutcome),
              stoppedBy: 'cancelled',
              riskLevel: 'medium',
              collectDiff: false,
              auditState,
            });
          }
          if (importOutcome?.kind === 'failed') {
            addContractWarning(auditState, {
              code: 'codex_import_project_failed',
              severity: 'error',
              message: 'nightworkers.import_project failed. Fallback implementation is forbidden.',
              providerItemId: importOutcome.providerItemId,
              toolName: importOutcome.toolName,
            });
            if (importOutcome.retryableTransportCancel) {
              const diagnosticMessage =
                '[System] nightworkers.import_project was cancelled before the MCP server returned a tool result. Automatic retry is disabled.';
              logs.push(diagnosticMessage);
              await sink.emit({
                type: 'runtime_error',
                message: diagnosticMessage,
                payload: {
                  provider: 'codex',
                  toolName: importOutcome.toolName,
                  error: importOutcome.error,
                  reason: 'project_import_transport_cancelled',
                  providerItemId: importOutcome.providerItemId,
                },
              });
            }
            finalText = buildProjectImportFailureReport(importOutcome);
            return this.finishRun(context, sink, logs, {
              terminalState: 'needs_human',
              finalReport: finalText,
              stoppedBy: 'tool_failure',
              riskLevel: 'high',
              collectDiff: false,
              auditState,
            });
          }
          if (mapped.type === 'model_response_finished') {
            const payload = mapped.payload as { text?: unknown } | undefined;
            if (typeof payload?.text === 'string') finalText = payload.text;
            await recordCodexRuntimeUsageIfPresent({
              context,
              payload: mapped.payload,
              persistRuntimeUsage: this.persistRuntimeUsage,
              usageRecorder: this.usageRecorder,
            });
          }
          if (mapped.type === 'runtime_error') {
            terminalState = 'failed';
            stoppedBy = 'llm_error';
            lastRuntimeError = readRuntimeFailureEvidence(mapped);
            finalText = buildCodexFailureReport({
              terminalError: lastRuntimeError,
              execExitError: null,
              completedFileChanges,
            }).summary;
          }
          if (mapped.type === 'diff_collected') {
            completedFileChanges.push(...readCompletedFileChanges(mapped));
          }
        }
      }

      await this.emitMissingImportVerificationWarningIfNeeded(sink, logs, auditState);
      const terminalPolicy = await this.resolveCodexTerminalPolicy(sink, logs, auditState, {
        terminalState,
        finalReport: finalText,
        stoppedBy,
        riskLevel: terminalState === 'completed' ? 'medium' : 'high',
      });
      return this.finishRun(context, sink, logs, {
        terminalState: terminalPolicy.terminalState,
        finalReport: terminalPolicy.finalReport,
        stoppedBy: terminalPolicy.stoppedBy,
        riskLevel: terminalPolicy.riskLevel,
        auditState,
      });
    } catch (err) {
      if (controller.signal.aborted || this.cancelledRunIds.has(context.runId)) {
        return this.toCancelled(logs.join('\n'));
      }
      const message = err instanceof Error ? err.message : String(err);
      const execExitError = parseCodexExecExitError(message);
      const failureReport = buildCodexFailureReport({
        terminalError: lastRuntimeError,
        execExitError,
        unknownErrorMessage: execExitError ? null : message,
        completedFileChanges,
      });
      for (const diagnostic of failureReport.recoveredToolFailures) {
        await sink.emit({
          type: 'runtime_warning',
          message: `[Codex Diagnostic] ${diagnostic.message}`,
          payload: {
            code: 'recovered_tool_failure',
            severity: 'warning',
            message: diagnostic.message,
            toolName: 'apply_patch',
            changedFiles: diagnostic.filePath ? [diagnostic.filePath] : [],
          },
        });
      }
      await sink.emit({
        type: 'runtime_error',
        message: `[System Error] ${failureReport.summary}`,
        payload: {
          provider: 'codex',
          error: failureReport.summary,
          rawError: message,
          terminalReason: failureReport.reason,
          diagnosticKind: execExitError ? 'codex_exec_nonzero' : 'runtime_error',
          recoveredToolFailures: failureReport.recoveredToolFailures,
          unrecoveredToolFailures: failureReport.unrecoveredToolFailures,
        },
      });
      return {
        ...DEFAULT_RESULT,
        summary: failureReport.summary,
        finalReport: failureReport.summary,
        logContent: [...logs, ...failureReport.diagnostics].join('\n'),
        contractWarnings: auditState.contractWarnings,
        testResults: {
          codexFailure: {
            terminalReason: failureReport.reason,
            execExitDetail: failureReport.execExitError?.detail ?? null,
            recoveredToolFailures: failureReport.recoveredToolFailures,
            unrecoveredToolFailures: failureReport.unrecoveredToolFailures,
          },
        },
      };
    } finally {
      signal?.removeEventListener('abort', abort);
    }
  }

  async stop(runId: string): Promise<void> {
    this.cancelledRunIds.add(runId);
  }

  private async auditMappedEvent(
    context: AgentRunContext,
    auditState: CodexRuntimeAuditState,
    event: AgentRuntimeEvent
  ): Promise<AgentRuntimeEvent[]> {
    auditState.eventSequence += 1;
    const sequence = auditState.eventSequence;
    let auditedEvent = event;
    const payload = readEventPayload(event);
    if (event.type === 'runtime_started') {
      auditedEvent = {
        ...event,
        payload: {
          ...payload,
          runtimeContract: buildCodexRuntimeContractSnapshot(auditState),
        },
      };
    }

    const warnings: CodexContractWarning[] = [];
    const toolName = typeof payload.toolName === 'string' ? payload.toolName : null;
    const executionMode = readCodexRuntimeExecutionMode(context);
    const expectedCodexTools = new Set(getNightWorkersCodexToolNames({ executionMode }));
    if (toolName?.startsWith('nightworkers.')) {
      auditState.observedNightWorkersTools.add(toolName);
      if (
        executionMode === 'planning' &&
        (toolName === 'nightworkers.todo_list' || toolName === 'nightworkers.import_project')
      ) {
        warnings.push({
          code: 'codex_plan_mode_mutating_tool',
          severity: 'error',
          message: `Mutating NightWorkers MCP tool observed during planning mode: ${toolName}.`,
          providerItemId: readString(payload.providerItemId),
          toolName,
        });
      }
      if (toolName === 'nightworkers.todo_list') {
        auditState.sawAnyNightworkersTodo = true;
        if (event.type === 'tool_call_finished') {
          const operation = readToolOperation(payload);
          if (operation === 'list') {
            auditState.sawNightworkersTodoList = true;
          }
          if (isTodoProgressMutationOperation(operation) && !isFailedToolPayload(payload)) {
            auditState.sawNightworkersTodoMutation = true;
            auditState.firstNightworkersTodoMutationSequence ??= sequence;
            auditState.lastNightworkersTodoMutationSequence = sequence;
            auditState.lastNightworkersTodoMutationOperation = operation;
            const transition = readTodoTransitionResult(payload);
            auditState.lastTodoTransitionResult = transition;
            if (isValidTodoProgressOperation(operation, payload)) {
              auditState.lastProgressValidSequence = sequence;
            }
            if (operation === 'replace') {
              auditState.sawNightworkersTodoReplace = true;
              auditState.structuralTodoReplanRequired = false;
            }
          } else if (operation === 'replace' && isFailedToolPayload(payload)) {
            auditState.structuralTodoReplanRequired = true;
            auditState.structuralTodoReplanEvidence.push('failed_replace');
            auditState.lastTodoTransitionResult = 'failed_replace';
          }
          if (event.type === 'tool_call_finished' && toolName === 'nightworkers.todo_list') {
            const todoPayload = readTodoActionPayload(payload);
            if (todoPayload?.currentTodo) {
              auditState.lastCurrentTodo = {
                id: todoPayload.currentTodo.id,
                seq: todoPayload.currentTodo.seq,
                title: todoPayload.currentTodo.title,
                procedureId: todoPayload.currentTodo.procedureId ?? null,
              };
            }
          }
        }
      }
      if (event.type === 'tool_call_finished' && !expectedCodexTools.has(toolName)) {
        warnings.push({
          code: 'codex_unexpected_nightworkers_mcp_tool',
          severity: 'warning',
          message: `Unexpected NightWorkers MCP tool observed: ${toolName}.`,
          providerItemId: readString(payload.providerItemId),
          toolName,
        });
      }
      if (event.type === 'tool_call_finished' && isFailedToolPayload(payload)) {
        auditState.mcpDegraded = true;
        warnings.push({
          code: 'codex_mcp_degraded',
          severity: 'warning',
          message: `NightWorkers MCP tool did not complete successfully: ${toolName}.`,
          providerItemId: readString(payload.providerItemId),
          toolName,
        });
      }
    } else if (event.type === 'tool_call_finished' && isMcpToolPayload(payload)) {
      warnings.push({
        code: 'codex_global_mcp_tool_observed',
        severity: 'warning',
        message: `Non-NightWorkers MCP tool observed: ${toolName || 'unknown'}.`,
        providerItemId: readString(payload.providerItemId),
        toolName,
      });
    }

    if (event.type === 'tool_call_finished' && toolName === 'command_execution') {
      const command = readString(payload.command);
      const commandClass = readString(payload.commandClass);
      const exitCode = readExitCode(payload);
      recordCommandReadEvidence({
        auditState,
        repoRoot: context.repoRoot,
        sequence,
        command,
        commandClass,
        exitCode,
        status: readString(payload.status),
        providerItemId: readString(payload.providerItemId),
      });
      if (commandClass === 'verification' || commandClass === 'broad_verification') {
        auditState.verificationEvidence.push({
          sequence,
          command,
          normalizedCommand: normalizeVerificationCommand(command),
          commandClass,
          exitCode,
        });
      }
      if (
        commandClass === 'broad_verification' &&
        auditState.lastFileChangeSequence !== null &&
        (auditState.lastProgressValidSequence === null ||
          auditState.lastProgressValidSequence < auditState.lastFileChangeSequence)
      ) {
        warnings.push({
          code: 'codex_todo_progress_stale_before_verify',
          severity: 'warning',
          message:
            'Codex broad verification started without a TodoList progress mutation after the latest file change.',
          providerItemId: readString(payload.providerItemId),
          toolName,
          command,
          changedFiles: auditState.lastChangedFiles,
        });
      }
      warnings.push({
        code: 'codex_native_command_execution',
        severity: 'warning',
        message: `Codex native command_execution observed (${commandClass || 'other'}).`,
        providerItemId: readString(payload.providerItemId),
        toolName,
        command,
      });
      if (commandClass === 'git_clone_or_import') {
        auditState.sawHighRiskNativeImportCommand = true;
        auditState.highRiskNativeImportCommand = command;
        auditState.highRiskNativeImportProviderItemId = readString(payload.providerItemId);
        warnings.push({
          code: 'codex_high_risk_native_import_command',
          severity: 'error',
          message:
            'Codex native command looks like a high-risk project import alternative; use nightworkers.import_project for project imports.',
          providerItemId: readString(payload.providerItemId),
          toolName,
          command,
        });
        warnings.push({
          code: 'codex_import_project_alternative_command',
          severity: 'warning',
          message:
            'Codex native command looks like a project import alternative; use nightworkers.import_project for project imports.',
          providerItemId: readString(payload.providerItemId),
          toolName,
          command,
        });
      }
    }

    if (event.type === 'tool_call_finished' && toolName === 'nightworkers.import_project') {
      const importPayload = readImportProjectSuccessPayload(payload);
      if (importPayload) {
        auditState.sawNightworkersImportProjectSuccess = true;
        auditState.importProjectSuccessSequence = sequence;
        auditState.importProjectProviderItemId = readString(payload.providerItemId);
        auditState.recommendedVerificationCommands = importPayload.recommendedVerificationCommands;
      } else if (isFailedToolPayload(payload)) {
        auditState.sawNightworkersImportProjectFailure = true;
      }
    }

    if (event.type === 'diff_collected' && isCodexFileChangeEvent(payload)) {
      auditState.lastFileChangeSequence = sequence;
      auditState.lastFileChangeProviderItemId = readString(payload.providerItemId);
      auditState.lastChangedFiles = readChangedFiles(payload);
      if (executionMode === 'planning') {
        warnings.push({
          code: 'codex_plan_mode_file_change',
          severity: 'error',
          message: 'Codex file_change occurred during planning mode.',
          providerItemId: readString(payload.providerItemId),
          changedFiles: readChangedFiles(payload),
        });
      }
      if (!hasValidTodoProgressBeforeFileChange(auditState, sequence)) {
        if (auditState.sawNightworkersTodoList && !auditState.sawNightworkersTodoMutation) {
          warnings.push({
            code: 'codex_todo_progress_list_only',
            severity: 'warning',
            message:
              'Codex called nightworkers.todo_list operation=list, but no TodoList progress mutation occurred before file changes.',
            providerItemId: readString(payload.providerItemId),
            toolName: 'nightworkers.todo_list',
            changedFiles: readChangedFiles(payload),
          });
        } else {
          warnings.push({
            code: 'codex_todo_progress_missing',
            severity: 'warning',
            message:
              'Codex file_change occurred before any valid nightworkers.todo_list progress mutation.',
            providerItemId: readString(payload.providerItemId),
            toolName: 'nightworkers.todo_list',
            changedFiles: readChangedFiles(payload),
          });
        }
      }
      const todoEvidence = await this.readCurrentTodoEvidence(context);
      const currentTodo = todoEvidence.todo;
      auditState.lastTodoEvidenceSource = todoEvidence.source;
      if (currentTodo) {
        auditState.lastCurrentTodo = currentTodo;
        auditedEvent = {
          ...auditedEvent,
          payload: {
            ...readEventPayload(auditedEvent),
            ...todoPayload(currentTodo),
          },
        } as AgentRuntimeEvent;
      } else {
        warnings.push({
          code: 'codex_file_change_without_current_todo',
          severity: 'warning',
          message: 'Codex file_change occurred while no current running Todo was found.',
          providerItemId: readString(payload.providerItemId),
          changedFiles: readChangedFiles(payload),
        });
      }
      if (todoEvidence.dbReadFailed) {
        warnings.push({
          code: 'codex_todo_evidence_db_read_failed',
          severity: 'warning',
          message:
            'Codex file_change Todo evidence DB read failed; runtime Todo context fallback was used when available.',
          providerItemId: readString(payload.providerItemId),
          todoId: currentTodo?.id ?? null,
          todoSeq: currentTodo?.seq ?? null,
          changedFiles: readChangedFiles(payload),
          todoEvidenceSource: todoEvidence.source,
        });
      }
      const missingReadFiles = readChangedFiles(payload).filter(
        (filePath) =>
          !hasPriorReadEvidence(auditState, context.repoRoot, filePath, sequence, payload)
      );
      if (missingReadFiles.length > 0) {
        warnings.push({
          code: 'codex_file_change_without_prior_read',
          severity: 'warning',
          message: 'Codex file_change occurred without prior read evidence for the changed file.',
          providerItemId: readString(payload.providerItemId),
          changedFiles: missingReadFiles,
        });
      }
      if (auditState.structuralTodoReplanRequired && !auditState.sawNightworkersTodoReplace) {
        warnings.push({
          code: 'codex_file_change_before_todo_replace',
          severity: 'warning',
          message:
            'Codex file_change occurred after structural TodoList replanning was required but before nightworkers.todo_list operation=replace.',
          providerItemId: readString(payload.providerItemId),
          todoId: currentTodo?.id ?? null,
          todoSeq: currentTodo?.seq ?? null,
          changedFiles: readChangedFiles(payload),
        });
      }
      if (auditState.mcpDegraded) {
        warnings.push({
          code: 'codex_file_change_while_mcp_degraded',
          severity: 'warning',
          message: 'Codex file_change occurred after NightWorkers MCP degradation was observed.',
          providerItemId: readString(payload.providerItemId),
          todoId: currentTodo?.id ?? null,
          todoSeq: currentTodo?.seq ?? null,
          changedFiles: readChangedFiles(payload),
        });
      }
    }

    const warningEvents = warnings
      .map((warning) => this.toContractWarningEvent(auditState, warning))
      .filter((warning): warning is AgentRuntimeEvent => warning !== null);
    return [...warningEvents, auditedEvent];
  }

  private async readCurrentTodoEvidence(
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

  private toContractWarningEvent(
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

  private async emitMissingImportVerificationWarningIfNeeded(
    sink: AgentRuntimeSink,
    logs: string[],
    auditState: CodexRuntimeAuditState
  ) {
    if (!auditState.sawNightworkersImportProjectSuccess) return;
    if (auditState.recommendedVerificationCommands.length === 0) return;
    const postImportSuccessfulVerificationEvidence = auditState.verificationEvidence.filter(
      (evidence) =>
        evidence.exitCode === 0 &&
        auditState.importProjectSuccessSequence !== null &&
        evidence.sequence > auditState.importProjectSuccessSequence
    );
    const recommendedCommands = auditState.recommendedVerificationCommands
      .map((command) => normalizeVerificationCommand(command))
      .filter((command): command is string => command !== null);
    const hasRecommendedMatch = postImportSuccessfulVerificationEvidence.some((evidence) =>
      recommendedCommands.some((recommended) =>
        verificationCommandsMatch(evidence.normalizedCommand, recommended)
      )
    );
    if (hasRecommendedMatch) return;
    if (postImportSuccessfulVerificationEvidence.length > 0) {
      const firstEvidence = postImportSuccessfulVerificationEvidence[0];
      const warning = this.toContractWarningEvent(auditState, {
        code: 'codex_import_project_recommended_verification_mismatch',
        severity: 'warning',
        message:
          'nightworkers.import_project recommended verification commands were present, but successful post-import verification did not match a recommended command.',
        providerItemId: auditState.importProjectProviderItemId,
        toolName: 'nightworkers.import_project',
        command: firstEvidence.command,
      });
      if (warning) {
        logs.push(warning.message);
        await sink.emit(warning);
      }
      return;
    }
    const warning = this.toContractWarningEvent(auditState, {
      code: 'codex_import_project_verification_missing',
      severity: 'warning',
      message:
        'nightworkers.import_project succeeded with recommended verification commands, but no successful verification command evidence was observed.',
      providerItemId: auditState.importProjectProviderItemId,
      toolName: 'nightworkers.import_project',
    });
    if (warning) {
      logs.push(warning.message);
      await sink.emit(warning);
    }
  }

  private async resolveCodexTerminalPolicy(
    sink: AgentRuntimeSink,
    logs: string[],
    auditState: CodexRuntimeAuditState,
    input: {
      terminalState: AgentRuntimeResult['terminalState'];
      finalReport: string;
      stoppedBy: AgentRuntimeResult['stoppedBy'];
      riskLevel: AgentRuntimeResult['riskLevel'];
    }
  ): Promise<typeof input> {
    if (input.terminalState !== 'completed') {
      return input;
    }
    const planModeViolation = auditState.contractWarnings.find(
      (warning) =>
        warning.code === 'codex_plan_mode_file_change' ||
        warning.code === 'codex_plan_mode_mutating_tool'
    );
    if (planModeViolation) {
      const finalReportSuffix =
        'Codex planning mode mutation was observed; stopping for human review.';
      const finalReport = input.finalReport
        ? `${input.finalReport}\n\n${finalReportSuffix}`
        : finalReportSuffix;
      return {
        terminalState: 'needs_human',
        finalReport,
        stoppedBy: 'tool_failure',
        riskLevel: 'high',
      };
    }
    if (
      !auditState.sawHighRiskNativeImportCommand ||
      auditState.sawNightworkersImportProjectSuccess
    ) {
      return input;
    }
    const warning = this.toContractWarningEvent(auditState, {
      code: 'codex_native_import_without_import_project',
      severity: 'error',
      message:
        'Codex native project import command completed without nightworkers.import_project success. Human review is required before treating the run as complete.',
      providerItemId: auditState.highRiskNativeImportProviderItemId,
      toolName: 'command_execution',
      command: auditState.highRiskNativeImportCommand,
    });
    if (warning) {
      logs.push(warning.message);
      await sink.emit(warning);
    }
    const finalReportSuffix =
      'Codex native project import command was observed without nightworkers.import_project success; stopping for human review.';
    const finalReport = input.finalReport
      ? `${input.finalReport}\n\n${finalReportSuffix}`
      : finalReportSuffix;
    return {
      terminalState: 'needs_human',
      finalReport,
      stoppedBy: 'tool_failure',
      riskLevel: 'high',
    };
  }

  private async createThread(context: AgentRunContext, sink: AgentRuntimeSink) {
    return createCodexRuntimeThread({
      context,
      threadFactory: this.threadFactory,
      onResumeEvent: async (event) => {
        if (event.status === 'reused') {
          await sink.emit({
            type: 'runtime_started',
            message: '[Codex] Runtime session resume state reused.',
            payload: {
              provider: 'codex',
              action: 'runtime.resume_state_reused',
              resumeState: 'reused',
              providerThreadId: event.providerThreadId,
              stateId: event.stateId ?? null,
            },
          });
          return;
        }
        if (event.status === 'fallback_started_fresh') {
          if (event.stateId) {
            await this.runtimeSessionStore.markRuntimeSessionStateResumeFailed({
              id: event.stateId,
              error: event.error,
            });
          }
          await sink.emit({
            type: 'runtime_warning',
            message: '[Codex] Runtime session resume failed; started a fresh thread.',
            payload: {
              code: 'codex_runtime_resume_failed',
              severity: 'warning',
              message: 'Codex runtime session resume failed; started a fresh thread.',
              providerItemId: event.providerThreadId,
            },
          });
          return;
        }
        await sink.emit({
          type: 'runtime_started',
          message: '[Codex] Runtime session resume state unavailable; starting fresh.',
          payload: {
            provider: 'codex',
            action: 'runtime.resume_state_missing',
            resumeState: 'unavailable',
          },
        });
      },
    });
  }

  private toCancelled(logContent: string): AgentRuntimeResult {
    return {
      terminalState: 'cancelled',
      summary: 'Codex Agent Runtime cancelled.',
      finalReport: 'Codex Agent Runtime cancelled.',
      stoppedBy: 'cancelled',
      riskLevel: 'medium',
      logContent,
    };
  }

  private async finishRun(
    context: AgentRunContext,
    sink: AgentRuntimeSink,
    logs: string[],
    input: {
      terminalState: AgentRuntimeResult['terminalState'];
      finalReport: string;
      stoppedBy: AgentRuntimeResult['stoppedBy'];
      riskLevel: AgentRuntimeResult['riskLevel'];
      collectDiff?: boolean;
      auditState: CodexRuntimeAuditState;
      testResults?: unknown;
    }
  ): Promise<AgentRuntimeResult> {
    const diffPatch =
      input.collectDiff === false
        ? ''
        : await this.collectDiff(context, sink, logs, input.auditState);
    const contractWarnings = [...input.auditState.contractWarnings];
    const result: AgentRuntimeResult = {
      terminalState: input.terminalState,
      summary:
        input.finalReport ||
        (input.terminalState === 'completed'
          ? 'Codex Agent Runtime completed.'
          : DEFAULT_RESULT.summary),
      finalReport: input.finalReport,
      stoppedBy: input.stoppedBy,
      riskLevel: input.riskLevel,
      logContent: logs.join('\n'),
      diffPatch,
      contractWarnings,
      testResults: input.testResults,
    };
    await sink.emit({
      type: 'runtime_finished',
      message: `[System] Codex Agent Runtime finished with terminalState=${result.terminalState}.`,
      payload: {
        provider: 'codex',
        terminalState: result.terminalState,
        stoppedBy: result.stoppedBy,
        finalReport: result.finalReport,
        summary: result.summary,
        contractWarnings,
        runtimeContract: buildCodexRuntimeContractSnapshot(input.auditState),
      },
    });
    return result;
  }

  private async collectDiff(
    context: AgentRunContext,
    sink: AgentRuntimeSink,
    logs: string[],
    auditState: CodexRuntimeAuditState
  ): Promise<string> {
    if (!this.collectWorkspaceDiff) return '';
    const result = await gitDiffTool({ repoRoot: context.repoRoot });
    if (!result.ok || !result.payload.hasChanges) return '';
    const changedFiles = changedFilesFromDiff(result.payload.diff);
    if (!auditState.sawNightworkersTodoMutation && !hasTodoProgressWarning(auditState)) {
      const warning = this.toContractWarningEvent(
        auditState,
        auditState.sawNightworkersTodoList
          ? {
              code: 'codex_todo_progress_list_only',
              severity: 'warning',
              message:
                'Codex completed with workspace changes after nightworkers.todo_list operation=list only; list is not progress.',
              toolName: 'nightworkers.todo_list',
              changedFiles,
            }
          : {
              code: 'codex_todo_progress_missing',
              severity: 'warning',
              message:
                'Codex completed with workspace changes before any nightworkers.todo_list progress mutation.',
              toolName: 'nightworkers.todo_list',
              changedFiles,
            }
      );
      if (warning) {
        logs.push(warning.message);
        await sink.emit(warning);
      }
    }
    const message = `[Codex] Workspace diff collected: ${changedFiles.length || 'unknown'} file(s).`;
    logs.push(message);
    await sink.emit({
      type: 'diff_collected',
      message,
      payload: {
        provider: 'codex',
        source: 'post_run_git_diff',
        changedFiles,
        ...todoPayload(auditState.lastCurrentTodo),
        diff: result.payload.diff,
        diffStat: result.payload.diffStat,
        hasChanges: result.payload.hasChanges,
      },
    });
    return result.payload.diff;
  }
}

async function persistCodexProviderThreadIfPresent(
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

function readRuntimeFailureEvidence(event: AgentRuntimeEvent): CodexRuntimeFailureEvidence {
  const payload = readEventPayload(event);
  const rawMessage = readString(payload.error) ?? event.message;
  const providerEventType = readString(payload.providerEventType);
  return {
    reason: classifyTerminalRuntimeError(rawMessage),
    message: sanitizeSingleLine(rawMessage),
    source:
      providerEventType === 'turn.failed'
        ? 'turn_failed'
        : providerEventType === 'error'
          ? 'stream_error'
          : 'runtime_error',
    rawMessage,
  };
}

function readCompletedFileChanges(event: AgentRuntimeEvent): CodexObservedFileChange[] {
  const payload = readEventPayload(event);
  if (payload.status !== 'completed') return [];
  const observedAtMs = Date.now();
  return readChangedFiles(payload).map((filePath) => ({
    filePath,
    providerItemId: readString(payload.providerItemId),
    observedAtMs,
  }));
}

function parseCodexExecExitError(message: string): CodexExecExitError | null {
  const match = /^Codex Exec exited with ([^:]+):\s*([\s\S]*)$/.exec(message);
  if (!match) return null;
  return {
    detail: match[1]?.trim() || null,
    message,
    stderr: match[2] || '',
  };
}

function classifyTerminalRuntimeError(message: string): CodexTerminalReason {
  const clean = stripAnsi(message);
  if (/Selected model is at capacity/i.test(clean)) return 'provider_capacity';
  if (/^Codex Exec exited with\b/.test(clean)) return 'codex_exec_nonzero';
  return 'unknown_runtime_error';
}

function buildCodexFailureReport(input: {
  terminalError: CodexRuntimeFailureEvidence | null;
  execExitError: CodexExecExitError | null;
  unknownErrorMessage?: string | null;
  completedFileChanges: CodexObservedFileChange[];
}): CodexFailureReport {
  const toolFailures = input.execExitError
    ? detectApplyPatchFailures(input.execExitError.stderr, input.completedFileChanges)
    : [];
  const unrecoveredToolFailures = toolFailures.filter((failure) => !failure.recovered);
  const recoveredToolFailures = toolFailures.filter((failure) => failure.recovered);
  const reason: CodexTerminalReason =
    input.terminalError?.reason ??
    (unrecoveredToolFailures.length > 0
      ? 'unrecovered_tool_failure'
      : input.execExitError
        ? 'codex_exec_nonzero'
        : 'unknown_runtime_error');
  const terminalMessage =
    input.terminalError?.message ??
    unrecoveredToolFailures[0]?.message ??
    (input.execExitError
      ? `Codex exec exited with ${input.execExitError.detail || 'non-zero status'}.`
      : input.unknownErrorMessage
        ? sanitizeSingleLine(input.unknownErrorMessage)
        : 'Unknown runtime error.');
  const diagnostics: string[] = [];
  for (const failure of recoveredToolFailures) diagnostics.push(failure.message);
  if (input.execExitError) {
    diagnostics.push(
      `Codex exec exited with ${input.execExitError.detail || 'non-zero status'}; stderr retained in diagnostics.`
    );
    if (input.execExitError.stderr.trim()) diagnostics.push(input.execExitError.stderr.trim());
  }
  return {
    reason,
    summary: `Codex Agent Runtime failed: ${reason}: ${terminalMessage}`,
    diagnostics,
    execExitError: input.execExitError,
    recoveredToolFailures,
    unrecoveredToolFailures,
  };
}

function detectApplyPatchFailures(
  stderr: string,
  completedFileChanges: CodexObservedFileChange[]
): CodexToolFailureDiagnostic[] {
  const clean = stripAnsi(stderr);
  if (!/apply_patch verification failed/i.test(clean)) return [];
  const filePath = extractApplyPatchFailurePath(clean);
  if (!filePath) return [];
  const failureOccurredAtMs = extractFirstIsoTimestampMs(clean);
  const recovered = completedFileChanges.some(
    (change) =>
      filePathsMatch(change.filePath, filePath) &&
      (failureOccurredAtMs === null || change.observedAtMs >= failureOccurredAtMs)
  );
  const shortPath = filePath;
  return [
    {
      kind: 'apply_patch_verification_failed',
      filePath,
      recovered,
      reason: recovered ? 'codex_exec_nonzero' : 'unrecovered_tool_failure',
      message: recovered
        ? `Recovered tool failure: apply_patch verification failed in ${shortPath}.`
        : `Unrecovered tool failure: apply_patch verification failed in ${shortPath}.`,
    },
  ];
}

function extractApplyPatchFailurePath(stderr: string): string | null {
  const match = /Failed to find expected lines in ([^\n:]+):/.exec(stderr);
  return match?.[1]?.trim() || null;
}

function extractFirstIsoTimestampMs(value: string): number | null {
  const match = /\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?Z\b/.exec(value);
  if (!match) return null;
  const fractional = match[2] ? match[2].slice(0, 4).padEnd(4, '0') : '';
  const timestamp = Date.parse(`${match[1]}${fractional}Z`);
  return Number.isFinite(timestamp) ? timestamp : null;
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

function stripAnsi(value: string) {
  return value.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'), '');
}

function sanitizeSingleLine(value: string) {
  return stripAnsi(value).replace(/\s+/g, ' ').trim();
}

function readEventPayload(event: AgentRuntimeEvent): Record<string, unknown> {
  return event.payload && typeof event.payload === 'object'
    ? (event.payload as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readExitCode(payload: Record<string, unknown>): number | null {
  if (typeof payload.exitCode === 'number') return payload.exitCode;
  if (typeof payload.exit_code === 'number') return payload.exit_code;
  return null;
}

function readChangedFiles(payload: Record<string, unknown>): string[] {
  return Array.isArray(payload.changedFiles)
    ? payload.changedFiles.filter((file): file is string => typeof file === 'string')
    : [];
}

function readCodexRuntimeExecutionMode(context: AgentRunContext) {
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

function readCodexRuntimeModel(context: AgentRunContext) {
  const codex = readRecord(context.runtimeOptions?.codex);
  return readString(codex?.model);
}

function readToolOperation(payload: Record<string, unknown>): string | null {
  const args = payload.arguments;
  if (!args || typeof args !== 'object' || Array.isArray(args)) return null;
  const operation = (args as Record<string, unknown>).operation;
  return typeof operation === 'string' ? operation : null;
}

function readTodoTransitionResult(payload: Record<string, unknown>): string | null {
  const todoPayload = readTodoActionPayload(payload);
  const operation = readToolOperation(payload);
  const nextCurrentSeq = readRecord(todoPayload?.transition)?.nextCurrentSeq;
  if (typeof nextCurrentSeq === 'number') return `${operation || 'todo'}:next:${nextCurrentSeq}`;
  if (todoPayload?.currentTodo)
    return `${operation || 'todo'}:current:${todoPayload.currentTodo.seq}`;
  return operation ? `${operation}:no_current` : null;
}

function isValidTodoProgressOperation(operation: string | null, payload: Record<string, unknown>) {
  if (operation === 'start' || operation === 'replace') return true;
  if (operation === 'done') {
    const todoPayload = readTodoActionPayload(payload);
    return Boolean(todoPayload?.currentTodo || todoPayload?.nextTodo);
  }
  return false;
}

function readTodoActionPayload(payload: Record<string, unknown>): {
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

function isTodoProgressMutationOperation(value: string | null) {
  return (
    value === 'replace' ||
    value === 'start' ||
    value === 'done' ||
    value === 'block' ||
    value === 'fail'
  );
}

function hasValidTodoProgressBeforeFileChange(
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

function recordCommandReadEvidence(input: {
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

function hasPriorReadEvidence(
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

function hasTodoProgressWarning(auditState: CodexRuntimeAuditState) {
  return auditState.contractWarnings.some(
    (warning) =>
      warning.code === 'codex_todo_progress_missing' ||
      warning.code === 'codex_todo_progress_list_only'
  );
}

function isFailedToolPayload(payload: Record<string, unknown>) {
  return (
    payload.status === 'failed' ||
    payload.status === 'error' ||
    payload.status === 'cancelled' ||
    typeof payload.error === 'string' ||
    readMcpResultError(payload.result) !== null
  );
}

function isMcpToolPayload(payload: Record<string, unknown>) {
  return typeof payload.mcpServer === 'string' && typeof payload.mcpTool === 'string';
}

function isCodexFileChangeEvent(payload: Record<string, unknown>) {
  return payload.provider === 'codex' && Array.isArray(payload.changedFiles);
}

function todoPayload(todo: RuntimeTodoEvidence | null) {
  if (!todo) return {};
  return {
    todoId: todo.id,
    todoSeq: todo.seq,
    todoTitle: todo.title,
    todoProcedureId: todo.procedureId ?? null,
  };
}

function readImportProjectSuccessPayload(payload: Record<string, unknown>): {
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

function changedFilesFromDiff(diff: string): string[] {
  const files = new Set<string>();
  for (const line of diff.split('\n')) {
    const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (match?.[2]) files.add(match[2]);
  }
  return [...files];
}
