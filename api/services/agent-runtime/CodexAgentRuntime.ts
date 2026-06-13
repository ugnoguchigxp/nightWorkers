import { randomUUID } from 'node:crypto';
import type { Thread, ThreadEvent } from '@openai/codex-sdk';
import { getNightWorkersCodexToolNames } from '../../mcp/nightworkers-tool-manifest';
import * as repo from '../../modules/nightworkers/nightworkers.repository';
import type { NormalizedLlmUsage } from '../llm-usage';
import { recordLlmUsage } from '../llm-usage';
import { gitDiffTool } from '../worker-tools/git';
import { createCodexEventMapperState, mapCodexThreadEvent } from './codex-event-mapper';
import {
  buildCodexRuntimeSdkOptions,
  buildCodexRuntimeThreadOptions,
  type CodexRuntimeMcpConfigState,
  resolveCodexRuntimeMcpConfigState,
} from './codex-runtime-config';
import type {
  AgentRunContext,
  AgentRuntime,
  AgentRuntimeEvent,
  AgentRuntimeResult,
  AgentRuntimeSink,
  CodexContractWarning,
} from './types';

export type CodexThreadFactory = (context: AgentRunContext) => Promise<Thread> | Thread;
type RuntimeUsageRecorder = typeof recordLlmUsage;

const DEFAULT_RESULT: AgentRuntimeResult = {
  terminalState: 'failed',
  summary: 'Codex Agent Runtime failed.',
  finalReport: '',
  stoppedBy: 'llm_error',
  riskLevel: 'high',
};

const RETRYABLE_IMPORT_CANCEL_ERROR = 'user cancelled MCP tool call';
const NIGHTWORKERS_EXPECTED_CODEX_TOOLS = new Set(getNightWorkersCodexToolNames());

type RuntimeTodoEvidence = {
  id: string;
  seq: number;
  title: string;
  procedureId?: string | null;
};

type CodexRuntimeAuditState = {
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
  postImportVerificationEvidenceSeen: boolean;
  verificationEvidence: Array<{
    sequence: number;
    command: string | null;
    commandClass: string | null;
    exitCode: number | null;
  }>;
  sawHighRiskNativeImportCommand: boolean;
  highRiskNativeImportCommand: string | null;
  highRiskNativeImportProviderItemId: string | null;
  mcpConfig: CodexRuntimeMcpConfigState;
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
    const auditState = createCodexRuntimeAuditState();

    try {
      if (signal?.aborted || this.cancelledRunIds.has(context.runId)) {
        controller.abort();
        return this.toCancelled('');
      }

      const thread = await this.createThread(context);
      const { events } = await thread.runStreamed(buildCodexRuntimePrompt(context), {
        signal: controller.signal,
      });

      for await (const event of events as AsyncGenerator<ThreadEvent>) {
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
            await this.recordRuntimeUsageIfPresent(context, mapped.payload);
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
          codexContract: buildCodexContractSnapshot(auditState),
        },
      };
    }

    const warnings: CodexContractWarning[] = [];
    const toolName = typeof payload.toolName === 'string' ? payload.toolName : null;
    if (toolName?.startsWith('nightworkers.')) {
      auditState.observedNightWorkersTools.add(toolName);
      if (toolName === 'nightworkers.todo_list') {
        auditState.sawAnyNightworkersTodo = true;
        if (event.type === 'tool_call_finished' && readToolOperation(payload) === 'replace') {
          auditState.sawNightworkersTodoReplace = true;
        }
      }
      if (event.type === 'tool_call_finished' && !NIGHTWORKERS_EXPECTED_CODEX_TOOLS.has(toolName)) {
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
          commandClass,
          exitCode,
        });
        if (
          exitCode === 0 &&
          auditState.importProjectSuccessSequence !== null &&
          sequence > auditState.importProjectSuccessSequence
        ) {
          auditState.postImportVerificationEvidenceSeen = true;
        }
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
      const currentTodo = await this.readCurrentTodoEvidence(context);
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
  ): Promise<RuntimeTodoEvidence | null> {
    try {
      const todos = await repo.listTaskRunTodosForRun(context.runId);
      const current = todos
        .filter((todo) => todo.status === 'running')
        .sort((a, b) => a.seq - b.seq)[0];
      if (!current) return null;
      return {
        id: current.id,
        seq: current.seq,
        title: current.title,
        procedureId: current.procedureId ?? null,
      };
    } catch {
      if (context.currentTodo?.status === 'running') {
        return {
          id: context.currentTodo.id,
          seq: context.currentTodo.seq,
          title: context.currentTodo.title,
          procedureId: context.currentTodo.procedureId ?? null,
        };
      }
      if (context.todoPlan?.length) {
        const current = context.todoPlan
          .filter((todo) => todo.status === 'running')
          .sort((a, b) => a.seq - b.seq)[0];
        if (current) {
          return {
            id: current.id,
            seq: current.seq,
            title: current.title,
            procedureId: current.procedureId ?? null,
          };
        }
      }
      return null;
    }
  }

  private toContractWarningEvent(
    auditState: CodexRuntimeAuditState,
    warning: CodexContractWarning
  ): AgentRuntimeEvent {
    const normalized = normalizeContractWarning(warning);
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
    if (auditState.postImportVerificationEvidenceSeen) return;
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
    if (
      !auditState.sawHighRiskNativeImportCommand ||
      auditState.sawNightworkersImportProjectSuccess ||
      input.terminalState !== 'completed'
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

  private async createThread(context: AgentRunContext): Promise<Thread> {
    if (this.threadFactory) return this.threadFactory(context);
    const { Codex } = await import('@openai/codex-sdk');
    const codexOptions = buildCodexRuntimeSdkOptions({
      accessToken: process.env.CODEX_ACCESS_TOKEN || '',
      env: {
        ...process.env,
        NIGHTWORKERS_TASK_ID: context.taskId,
        NIGHTWORKERS_RUN_ID: context.runId,
      },
    });
    const codex = new Codex(codexOptions);
    const threadOptions = buildCodexRuntimeThreadOptions(context);
    return codex.startThread(threadOptions);
  }

  private async recordRuntimeUsageIfPresent(
    context: AgentRunContext,
    payload: unknown
  ): Promise<void> {
    if (!this.persistRuntimeUsage) return;
    const record =
      payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
    if (record.provider !== 'codex' || !record.usage) return;
    const usage = normalizeRuntimeUsage(record.usage, record.rawUsage);
    if (!usage) return;
    await this.usageRecorder({
      taskId: context.taskId,
      runId: context.runId,
      callId: `codex-runtime:${context.runId}:${randomUUID()}`,
      provider: 'codex',
      model: resolveRuntimeModel(context),
      label: 'codex-runtime',
      round: null,
      usage,
      promptPartTokenEstimates: {
        latestUserMessageTokens:
          context.contextSnapshot.conversationContext?.usage?.latestUserMessageTokens,
        stateCardTokens: context.contextSnapshot.conversationContext?.usage?.stateCardTokens,
        userPromptTokens:
          context.contextSnapshot.conversationContext?.usage?.runtimeUserPromptTokens,
      },
      durationMs: 0,
      metadataJson: {
        source: 'codex_agent_runtime_turn_completed',
        providerEventType: record.providerEventType ?? null,
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
        codexContract: buildCodexContractSnapshot(input.auditState),
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

function createCodexRuntimeAuditState(): CodexRuntimeAuditState {
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
    postImportVerificationEvidenceSeen: false,
    verificationEvidence: [],
    sawHighRiskNativeImportCommand: false,
    highRiskNativeImportCommand: null,
    highRiskNativeImportProviderItemId: null,
    mcpConfig: resolveCodexRuntimeMcpConfigState(),
  };
}

function buildCodexContractSnapshot(state: CodexRuntimeAuditState) {
  return {
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

function addContractWarning(state: CodexRuntimeAuditState, warning: CodexContractWarning) {
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
  const exists = state.contractWarnings.some(
    (existing) =>
      [
        existing.code,
        existing.providerItemId ?? '',
        existing.toolName ?? '',
        existing.command ?? '',
        existing.todoId ?? '',
        existing.todoSeq ?? '',
        (existing.changedFiles ?? []).join(','),
      ].join('|') === key
  );
  if (!exists) state.contractWarnings.push(normalized);
}

function normalizeContractWarning(warning: CodexContractWarning): CodexContractWarning {
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
  };
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

type ProjectImportOutcome =
  | {
      kind: 'cancelled';
      toolName: string;
      providerItemId: string | null;
    }
  | {
      kind: 'failed';
      toolName: string;
      providerItemId: string | null;
      error: string;
      retryableTransportCancel: boolean;
    };

function getProjectImportOutcome(event: AgentRuntimeEvent): ProjectImportOutcome | null {
  if (event.type !== 'tool_call_finished') return null;
  const payload = readEventPayload(event);
  const toolName = payload.toolName === 'nightworkers.import_project' ? payload.toolName : null;
  if (!toolName) {
    return null;
  }
  const providerItemId = typeof payload.providerItemId === 'string' ? payload.providerItemId : null;
  if (payload.status === 'cancelled') {
    return {
      kind: 'cancelled',
      toolName,
      providerItemId,
    };
  }
  const resultError = readMcpResultError(payload.result);
  if (payload.status === 'failed' || typeof payload.error === 'string' || resultError) {
    const error =
      typeof payload.error === 'string'
        ? payload.error
        : resultError || 'nightworkers.import_project failed';
    return {
      kind: 'failed',
      toolName,
      providerItemId,
      error,
      retryableTransportCancel: isRetryableProjectImportTransportCancel(payload, error),
    };
  }
  return null;
}

function isRetryableProjectImportTransportCancel(
  payload: Record<string, unknown>,
  error: string
): boolean {
  return (
    error === RETRYABLE_IMPORT_CANCEL_ERROR &&
    payload.status === 'failed' &&
    (payload.result === null || typeof payload.result === 'undefined')
  );
}

function buildProjectImportFailureReport(
  outcome: Extract<ProjectImportOutcome, { kind: 'failed' }>
): string {
  const providerItem = outcome.providerItemId ? ` providerItemId=${outcome.providerItemId}.` : '';
  if (outcome.retryableTransportCancel) {
    return `Project import failed before the MCP server returned a tool result: ${outcome.error}.${providerItem} Stopping without retry or fallback implementation.`;
  }
  return `Project import failed: ${outcome.error}.${providerItem} Stopping without fallback implementation.`;
}

function buildProjectImportCancelledReport(
  outcome: Extract<ProjectImportOutcome, { kind: 'cancelled' }>
): string {
  const providerItem = outcome.providerItemId ? ` providerItemId=${outcome.providerItemId}.` : '';
  return `Project import was cancelled by the user.${providerItem} Stopping without fallback implementation.`;
}

function normalizeRuntimeUsage(usageValue: unknown, rawUsage: unknown): NormalizedLlmUsage | null {
  if (!usageValue || typeof usageValue !== 'object') return null;
  const usage = usageValue as Record<string, unknown>;
  const inputTokens = normalizeOptionalToken(usage.inputTokens);
  const outputTokens = normalizeOptionalToken(usage.outputTokens);
  const cachedInputTokens = normalizeOptionalToken(usage.cachedInputTokens);
  const reasoningOutputTokens = normalizeOptionalToken(usage.reasoningOutputTokens);
  if (inputTokens === null && outputTokens === null) return null;
  return {
    inputTokens,
    outputTokens,
    cachedInputTokens,
    reasoningOutputTokens,
    totalTokens:
      inputTokens !== null || outputTokens !== null
        ? (inputTokens ?? 0) + (outputTokens ?? 0)
        : null,
    mode: 'measured',
    rawUsage,
  };
}

function normalizeOptionalToken(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : null;
}

function resolveRuntimeModel(context: AgentRunContext): string | null {
  const codexOptions =
    context.runtimeOptions?.codex && typeof context.runtimeOptions.codex === 'object'
      ? (context.runtimeOptions.codex as Record<string, unknown>)
      : null;
  return typeof codexOptions?.model === 'string' ? codexOptions.model : null;
}

export function buildCodexRuntimePrompt(context: AgentRunContext): string {
  const request = (context.latestUserMessage || context.compiledPrompt).trim();
  const nightWorkersToolList = getNightWorkersCodexToolNames().join(', ');
  const contract = [
    '[NightWorkers Runtime Contract]',
    `taskId: ${context.taskId}`,
    `runId: ${context.runId}`,
    `repoRoot: ${context.repoRoot}`,
    '',
    'NightWorkers MCP:',
    '- MCP server name: nightworkers',
    `- Available NightWorkers MCP tools in this lane: ${nightWorkersToolList}.`,
    '- If context-still.initial_instructions has not run in this NightWorkers run, run it before other task work and follow it.',
    '- Treat nightworkers MCP tools as the execution interface. When a named NightWorkers tool fits, call it directly instead of describing equivalent shell steps.',
    '- Execution order: specification -> Todo execution -> verification -> closeout.',
    '- Planning is not closeout. During planning or Todo setup, do not call context-still.compile_eval.',
    '- closeout starts only after implementation and verification are genuinely finished and no implementation Todo remains pending or running.',
    '- Use nightworkers.todo_list as the single Todo control tool.',
    '- For multi-step work, call nightworkers.todo_list operation=replace once near the start. This only defines the Todo plan; it does not complete any Todo.',
    '- operation=replace に closeout Todo を含めない。NightWorkers が最後に「知識登録を行う」と「完了報告を行う」を別々のゲートとして追加する。',
    '- 「知識登録を行う」は start/done せず、context-still.register_candidates の成功後に自動完了される。「完了報告を行う」は最後の assistant 完了報告でのみ自動完了される。',
    '- operation=replace に広域 verify Todo を含めない。NightWorkers が最後に quality_gate_verify Todo を追加する。その Todo が current になる前は typecheck、lint、unit test、build、targeted E2E などの focused checks に留める。',
    '- リポジトリ全体の広域 verify は、追加された quality_gate_verify Todo が current のときだけ実行する。広域 verify 成功後にファイル変更がなければ、再度広域 verify を実行しない。',
    '- Use operation=done only after concrete evidence exists for the current Todo. done auto-starts the next pending Todo.',
    '- Use operation=block for approval/input waits and operation=fail for concrete implementation or verification failures.',
    '- Do not start a later Todo while an earlier Todo is still pending or running. If verification cannot run or fails, close that verification Todo with fail or block first.',
    '- A failed, blocked, or skipped Todo is terminal. Do not try to restart it; continue only to closeout when no earlier Todo is pending or running.',
    '- If a Todo-tracking MCP call fails but the next implementation action is still clear, continue the implementation work. Tracking failure is not task completion.',
    '- After an implementation, scaffold, or verification Todo is running, do not stop with a plan-only answer or next-steps summary. Continue the concrete work, or close the current Todo with block/fail and explain the blocker.',
    '- For planning, implementation-plan, specification, design-doc, or requirement-check work, call nightworkers.read_current_specification first. If missing, use nightworkers.list_recent_specifications and then read by taskId.',
    '- Ground plans and verification steps in the specification content when available.',
    '- Use nightworkers.import_project as the single Project import entrypoint. For new scaffolds, pass source=starter with stack/variant. For arbitrary Git imports, pass source=git with repoUrl.',
    '- For unspecified new Web/API apps in an empty or near-empty Project root, use source=starter, stack=hono, and the default SQLite variant unless the user explicitly asks for another stack, blank project, or a DB/RAG/SSR/SSG variant.',
    '- If the user specifies a DB, choose the matching starter variant such as postgres, pgvector, turso, or cloudflare. If the user asks for RAG or embeddings-backed search, choose variant=rag on the hono stack. If the user specifies SSR or SSG without a DB/RAG variant, pass the matching overlay. Do not combine a DB/RAG variant and an overlay in one call.',
    '- Do not use shell git clone when nightworkers.import_project covers the task.',
    '- If nightworkers.import_project fails, is cancelled, or is not approved, stop and report the tool failure. Do not create a fallback static app or alternate implementation.',
    '- After import_project succeeds, first use postImport.llmContext when present, plus postImport.manifest and postImport.initialization. Do not re-read LLM_CONTEXT.md, package.json, or re-run install unless that payload is missing, truncated, or failed for a reason you are actively fixing.',
    '- Use postImport.manifest.recommendedVerificationCommands when choosing manifest-based verification before reporting completion.',
    '- CLI checks appear as Codex native command_execution events, not NightWorkers MCP tools. Preserve important command, exit code, stdout, and stderr evidence in the final report.',
  ].join('\n');
  return request ? `${request}\n\n${contract}` : contract;
}

function changedFilesFromDiff(diff: string): string[] {
  const files = new Set<string>();
  for (const line of diff.split('\n')) {
    const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (match?.[2]) files.add(match[2]);
  }
  return [...files];
}
