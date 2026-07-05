import { getNightWorkersCodexToolNames } from '../../mcp/nightworkers-tool-manifest';
import {
  hasPriorReadEvidence,
  hasValidTodoProgressBeforeFileChange,
  isCodexFileChangeEvent,
  isFailedToolPayload,
  isMcpToolPayload,
  isTodoProgressMutationOperation,
  isValidTodoProgressOperation,
  readChangedFiles,
  readCodexRuntimeExecutionMode,
  readCurrentTodoEvidence,
  readEventPayload,
  readExitCode,
  readImportProjectSuccessPayload,
  readString,
  readTodoActionPayload,
  readTodoTransitionResult,
  readToolOperation,
  recordCommandReadEvidence,
  toContractWarningEvent,
  todoPayload,
} from './codex-runtime-support';
import {
  buildCodexRuntimeContractSnapshot,
  type CodexRuntimeAuditState,
} from './codex-sdk/codex-sdk-mcp-audit';
import type { AgentRunContext, AgentRuntimeEvent, CodexContractWarning } from './types';
import { normalizeVerificationCommand } from './verification-command';

export async function auditCodexMappedEvent(
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
    const todoEvidence = await readCurrentTodoEvidence(context);
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
      (filePath) => !hasPriorReadEvidence(auditState, context.repoRoot, filePath, sequence, payload)
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
    .map((warning) => toContractWarningEvent(auditState, warning))
    .filter((warning): warning is AgentRuntimeEvent => warning !== null);
  return [...warningEvents, auditedEvent];
}
