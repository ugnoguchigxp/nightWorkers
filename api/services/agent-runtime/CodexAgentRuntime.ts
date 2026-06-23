import { getNightWorkersCodexToolNames } from '../../mcp/nightworkers-tool-manifest';
import * as repo from '../../modules/nightworkers/nightworkers.repository';
import { recordLlmUsage } from '../llm-usage';
import { gitDiffTool } from '../worker-tools/git';
import { type CodexThreadFactory, createCodexRuntimeThread } from './codex-sdk/codex-sdk-client';
import {
  createCodexEventMapperState,
  mapCodexThreadEvent,
} from './codex-sdk/codex-sdk-event-adapter';
import {
  buildProjectImportCancelledReport,
  buildProjectImportFailureReport,
  getProjectImportOutcome,
} from './codex-sdk/codex-sdk-import-policy';
import {
  addContractWarning,
  buildCodexRuntimeContractSnapshot,
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

export class CodexAgentRuntime implements AgentRuntime {
  readonly kind = 'codex-agent' as const;
  private cancelledRunIds = new Set<string>();
  private readonly threadFactory?: CodexThreadFactory;
  private readonly collectWorkspaceDiff: boolean;
  private readonly persistRuntimeUsage: boolean;
  private readonly usageRecorder: RuntimeUsageRecorder;

  constructor(
    input: {
      threadFactory?: CodexThreadFactory;
      collectWorkspaceDiff?: boolean;
      persistRuntimeUsage?: boolean;
      usageRecorder?: RuntimeUsageRecorder;
    } = {}
  ) {
    this.threadFactory = input.threadFactory;
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

    try {
      if (signal?.aborted || this.cancelledRunIds.has(context.runId)) {
        controller.abort();
        return this.toCancelled('');
      }

      const thread = await this.createThread(context);
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
      await sink.emit({
        type: 'runtime_error',
        message: `[System Error] Codex Agent Runtime failed: ${message}`,
        payload: { provider: 'codex', error: message },
      });
      return {
        ...DEFAULT_RESULT,
        summary: `Codex Agent Runtime failed: ${message}`,
        logContent: [...logs, message].join('\n'),
        contractWarnings: auditState.contractWarnings,
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
        if (event.type === 'tool_call_finished' && readToolOperation(payload) === 'replace') {
          auditState.sawNightworkersTodoReplace = true;
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
      if (commandClass === 'verification' || commandClass === 'broad_verification') {
        auditState.verificationEvidence.push({
          sequence,
          command,
          normalizedCommand: normalizeVerificationCommand(command),
          commandClass,
          exitCode,
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
      if (executionMode === 'planning') {
        warnings.push({
          code: 'codex_plan_mode_file_change',
          severity: 'error',
          message: 'Codex file_change occurred during planning mode.',
          providerItemId: readString(payload.providerItemId),
          changedFiles: readChangedFiles(payload),
        });
      }
      const todoEvidence = await this.readCurrentTodoEvidence(context);
      const currentTodo = todoEvidence.todo;
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
      if (!auditState.sawNightworkersTodoReplace) {
        warnings.push({
          code: 'codex_file_change_before_todo_replace',
          severity: 'warning',
          message: 'Codex file_change occurred before nightworkers.todo_list operation=replace.',
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

    const warningEvents = warnings.map((warning) =>
      this.toContractWarningEvent(auditState, warning)
    );
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
  ): AgentRuntimeEvent {
    const normalized = normalizeContractWarning({
      ...warning,
      sequence: warning.sequence ?? auditState.eventSequence,
      occurredAt: warning.occurredAt ?? new Date().toISOString(),
      count: warning.count ?? 1,
    });
    addContractWarning(auditState, normalized);
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
      logs.push(warning.message);
      await sink.emit(warning);
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
    logs.push(warning.message);
    await sink.emit(warning);
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
    logs.push(warning.message);
    await sink.emit(warning);
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

  private async createThread(context: AgentRunContext) {
    return createCodexRuntimeThread({ context, threadFactory: this.threadFactory });
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

function readToolOperation(payload: Record<string, unknown>): string | null {
  const args = payload.arguments;
  if (!args || typeof args !== 'object' || Array.isArray(args)) return null;
  const operation = (args as Record<string, unknown>).operation;
  return typeof operation === 'string' ? operation : null;
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
