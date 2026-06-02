import { appendSupervisorTrace, logger } from '../../lib/logger';
import * as repo from '../../modules/nightworkers/nightworkers.repository';
import { RunBudgetController } from '../run-control/run-budget-controller';
import type { SupervisorLoopResult } from '../run-control/types';
import { buildBlockedToolResult } from '../tool-policy/blocked-result';
import { DefaultToolPolicyGate } from '../tool-policy/tool-policy-gate';
import type { ToolCallRequest, WorkerToolName } from '../tool-policy/types';
import { executeWorkerTool } from '../worker-tools/dispatcher';
import { callSupervisorLLM } from './llm-provider';
import { buildRound1SystemPrompt, buildRound2SystemPrompt } from './prompt';

export interface SupervisorLoopInput {
  runId: string;
  repoRoot: string;
  prompt: string;
  timeoutSeconds: number;
  latestUserMessage?: string;
  maxIterations?: number;
  maxToolCalls?: number;
  maxRepeatedToolPattern?: number;
  deadlineAt?: string;
  safetyPolicy?: {
    allowedPaths?: string[];
    deniedPaths?: string[];
    blockedCommands?: string[];
    maxCommandSeconds?: number;
    requireReadBeforeEdit?: boolean;
  };
}

export async function runSupervisorLoop(input: SupervisorLoopInput): Promise<SupervisorLoopResult> {
  const { runId, repoRoot, prompt, latestUserMessage } = input;
  let finalReportText = 'Task execution completed.';
  let terminalState: SupervisorLoopResult['terminalState'] = 'completed';
  let summary = 'Task execution completed.';
  let stoppedBy: SupervisorLoopResult['stoppedBy'] = 'decision';
  let riskLevel: SupervisorLoopResult['riskLevel'] = 'low';
  const maxIterations = input.maxIterations ?? 30;
  const maxToolCalls = input.maxToolCalls ?? 80;
  const maxRepeatedToolPattern = input.maxRepeatedToolPattern ?? 3;
  const evidenceRequired = requiresRepositoryEvidence(latestUserMessage || prompt || '');
  const budget = new RunBudgetController({
    maxIterations,
    maxToolCalls,
    maxRepeatedAction: maxRepeatedToolPattern,
    maxMissingToolCalls: 3,
    timeoutSeconds: input.timeoutSeconds,
  });
  let iteration = 0;
  let supervisorToolCalls = 0;

  // Maintain list of read files for read-before-edit policy validation
  const readFiles: string[] = [];
  const toolObservations: string[] = [];
  const toolPolicyGate = new DefaultToolPolicyGate();

  appendSupervisorTrace('supervisor_loop_started', {
    runId,
    repoRoot,
    maxIterations,
    maxToolCalls,
    maxRepeatedToolPattern,
    timeoutSeconds: input.timeoutSeconds,
    evidenceRequired,
  });

  while (true) {
    const iterationBudget = budget.onIterationStart();
    iteration += 1;
    if (!iterationBudget.allowed) {
      finalReportText = `Supervisor loop stopped by budget. reason=${iterationBudget.reason}`;
      terminalState = iterationBudget.reason === 'deadline' ? 'timed_out' : 'needs_human';
      summary =
        iterationBudget.reason === 'deadline'
          ? 'Stopped by timeout budget'
          : 'Stopped by iteration budget';
      stoppedBy = 'budget';
      await repo.createTaskEvent({
        taskRunId: runId,
        type: 'error',
        message:
          iterationBudget.reason === 'deadline'
            ? '[Budget Stop] Supervisor timeout reached.'
            : '[Budget Stop] maxIterations reached.',
        actor: 'system',
        eventType: 'error',
        payloadJson: { reason: iterationBudget.reason, ...(iterationBudget.detail || {}) },
      });
      break;
    }
    logger.info({ runId, iteration }, 'Supervisor loop iteration start');

    // 1. Fetch current run and task details
    const run = await repo.getTaskRun(runId);
    if (!run) {
      throw new Error(`Run context not found: ${runId}`);
    }

    const task = await repo.getTask(run.taskId);
    if (!task) {
      throw new Error(`Task context not found: ${run.taskId}`);
    }

    const userInput = (latestUserMessage || prompt || '').trim();

    // 3. Prompt building
    const userPrompt = buildSupervisorUserPrompt(userInput, toolObservations);

    // 4. Invoke the Supervisor LLM
    let decision: Awaited<ReturnType<typeof callSupervisorLLM>>;
    try {
      const round1 = await callSupervisorLLM(buildRound1SystemPrompt(repoRoot), userPrompt, {
        tolerateSchemaFailure: false,
        round: 1,
      });
      logger.info(
        { runId, iteration, round: 1, phase: round1.phase, hasToolCall: Boolean(round1.toolCall) },
        'Supervisor round decision'
      );
      logger.info({ runId, iteration, round: 1, output: round1 }, 'Supervisor round output');
      appendSupervisorTrace('round1_output', {
        runId,
        iteration,
        phase: round1.phase,
        hasToolCall: Boolean(round1.toolCall),
        toolName: round1.toolCall?.name ?? null,
      });
      await repo.createTaskEvent({
        taskRunId: runId,
        type: 'info',
        message: `[Supervisor Round] round=1 phase=${round1.phase} hasToolCall=${Boolean(round1.toolCall)}`,
        actor: 'supervisor',
        eventType: 'supervisor_decision',
        payloadJson: { round: 1, iteration, decision: round1 },
      });

      if (round1.phase === 'stop') {
        decision = round1;
      } else {
        const round2Input = JSON.stringify({
          latestUserMessage: userInput,
          round1Decision: round1,
          observations: toolObservations.slice(-6),
        });
        const round2 = await callSupervisorLLM(buildRound2SystemPrompt(), round2Input, {
          round: 2,
          requireToolCall: true,
        });
        logger.info(
          {
            runId,
            iteration,
            round: 2,
            phase: round2.phase,
            hasToolCall: Boolean(round2.toolCall),
          },
          'Supervisor round decision'
        );
        logger.info({ runId, iteration, round: 2, output: round2 }, 'Supervisor round output');
        appendSupervisorTrace('round2_output', {
          runId,
          iteration,
          phase: round2.phase,
          hasToolCall: Boolean(round2.toolCall),
          toolName: round2.toolCall?.name ?? null,
        });
        await repo.createTaskEvent({
          taskRunId: runId,
          type: 'info',
          message: `[Supervisor Round] round=2 phase=${round2.phase} hasToolCall=${Boolean(round2.toolCall)}`,
          actor: 'supervisor',
          eventType: 'supervisor_decision',
          payloadJson: { round: 2, iteration, decision: round2 },
        });
        decision = round2;
      }
      logger.info(
        {
          runId,
          iteration,
          phase: decision.phase,
          terminalState: decision.terminalState,
          hasToolCall: Boolean(decision.toolCall),
        },
        'Supervisor decision received'
      );
    } catch (err: any) {
      logger.error(
        {
          runId,
          iteration,
          errorMessage: err?.message,
          errorStack: err?.stack,
        },
        'Supervisor LLM call failed'
      );
      appendSupervisorTrace('supervisor_call_failed', {
        runId,
        iteration,
        errorMessage: err?.message,
      });
      await repo.createTaskEvent({
        taskRunId: runId,
        type: 'error',
        message: `Supervisor Loop encountered LLM parsing/connection error: ${err.message}`,
        actor: 'system',
        eventType: 'error',
      });
      finalReportText = `Supervisor LLM call failed: ${err.message}`;
      terminalState = 'needs_human';
      summary = 'Supervisor LLM error';
      stoppedBy = 'llm_error';
      break;
    }

    // 5. Log supervisor decision in the DB ledger
    await repo.createTaskEvent({
      taskRunId: runId,
      type: 'info',
      message: `[Supervisor Decision] Phase: ${decision.phase}. Instruction: ${decision.instruction}`,
      actor: 'supervisor',
      eventType: 'supervisor_decision',
      payloadJson: { iteration, decision },
    });

    // 6. Handle stop decision
    if (decision.phase === 'stop') {
      if (evidenceRequired && supervisorToolCalls === 0) {
        const missingToolBudget = budget.onMissingToolCall();
        const detail = {
          iteration,
          reason: 'stop_without_evidence',
          phase: decision.phase,
          instruction: decision.instruction,
          rationale: decision.rationale,
          finalResponseLength: decision.finalResponse?.length ?? 0,
          expectedEvidence: decision.expectedEvidence ?? [],
          supervisorToolCalls,
          ...(missingToolBudget.detail || {}),
        };
        appendSupervisorTrace('stop_without_evidence', { runId, ...detail });
        await repo.createTaskEvent({
          taskRunId: runId,
          type: missingToolBudget.allowed ? 'warning' : 'error',
          message: missingToolBudget.allowed
            ? '[Supervisor Guard] stop was ignored because repository evidence has not been collected yet.'
            : '[Budget Stop] supervisor repeatedly stopped before collecting repository evidence.',
          actor: 'system',
          eventType: missingToolBudget.allowed ? 'warning' : 'error',
          payloadJson: detail,
        });
        if (!missingToolBudget.allowed) {
          finalReportText =
            '証拠取得が必要なタスクで、Supervisor が対象ファイルやログを確認する前に stop を繰り返したため停止しました。';
          terminalState = 'needs_human';
          summary = 'Stopped because supervisor stopped before collecting required evidence';
          stoppedBy = 'missing_tool_call';
          riskLevel = 'high';
          break;
        }
        continue;
      }

      const qualityFailure = evaluateStopDecisionQuality({
        decision,
        evidenceRequired,
        supervisorToolCalls,
      });
      if (qualityFailure) {
        const missingToolBudget = budget.onMissingToolCall();
        const detail = {
          iteration,
          reason: qualityFailure.reason,
          phase: decision.phase,
          instruction: decision.instruction,
          rationale: decision.rationale,
          finalResponseLength: decision.finalResponse?.trim().length ?? 0,
          expectedEvidence: decision.expectedEvidence ?? [],
          supervisorToolCalls,
          ...(missingToolBudget.detail || {}),
        };
        appendSupervisorTrace('stop_quality_rejected', { runId, ...detail });
        await repo.createTaskEvent({
          taskRunId: runId,
          type: missingToolBudget.allowed ? 'warning' : 'error',
          message: missingToolBudget.allowed
            ? `[Supervisor Guard] ${qualityFailure.message}`
            : '[Budget Stop] supervisor repeatedly returned an incomplete final response.',
          actor: 'system',
          eventType: missingToolBudget.allowed ? 'warning' : 'error',
          payloadJson: detail,
        });
        if (!missingToolBudget.allowed) {
          finalReportText =
            '証拠取得後の最終回答がレビュー本文として不十分なまま繰り返されたため停止しました。';
          terminalState = 'needs_human';
          summary = 'Stopped because final response quality was insufficient';
          stoppedBy = 'missing_tool_call';
          riskLevel = 'high';
          break;
        }
        continue;
      }

      finalReportText =
        decision.finalResponse?.trim() || decision.instruction?.trim() || decision.rationale;
      terminalState =
        (decision.terminalState as SupervisorLoopResult['terminalState']) || 'completed';
      summary = decision.instruction || 'Stopped by supervisor decision';
      stoppedBy = 'decision';
      riskLevel = decision.riskLevel || 'low';

      await repo.updateTaskRun(runId, {
        finalReport: finalReportText,
        summary,
        status: terminalState,
      });

      await repo.updateTaskStatus(task.id, terminalState);
      logger.info(
        { runId, iteration, terminalState, finalReportLength: finalReportText.length },
        'Supervisor loop stopped'
      );
      break;
    }

    // 7. Dispatch worker tool executions
    if (decision.toolCall) {
      const { name, arguments: toolArgs } = decision.toolCall;
      const toolBudget = budget.onToolCall(name, toolArgs || {});
      if (!toolBudget.allowed) {
        finalReportText = `Supervisor loop stopped by budget. reason=${toolBudget.reason}`;
        terminalState = 'needs_human';
        summary =
          toolBudget.reason === 'tool_limit'
            ? 'Stopped by tool-call budget'
            : 'Stopped by repeated tool pattern';
        stoppedBy = 'budget';
        await repo.createTaskEvent({
          taskRunId: runId,
          type: 'error',
          message:
            toolBudget.reason === 'tool_limit'
              ? '[Budget Stop] maxToolCalls reached.'
              : '[Budget Stop] repeated tool pattern detected.',
          actor: 'system',
          eventType: 'error',
          payloadJson: { reason: toolBudget.reason, ...(toolBudget.detail || {}) },
        });
        break;
      }
      supervisorToolCalls += 1;
      logger.info({ runId, iteration, toolName: name, toolArgs }, 'Worker tool call start');
      // Log tool call start
      await repo.createTaskEvent({
        taskRunId: runId,
        type: 'info',
        message: `[Worker Tool Call] Invoking tool ${name}...`,
        actor: 'worker',
        eventType: 'tool_call',
        payloadJson: {
          iteration,
          toolName: name,
          arguments: toolArgs,
          runEvent: buildCanonicalRunEvent({
            runId,
            iteration,
            type: 'tool.call_started',
            severity: 'info',
            actor: 'worker',
            message: `[Worker Tool Call] Invoking tool ${name}...`,
            data: { toolName: name, arguments: toolArgs },
          }),
        },
      });

      let toolResult: any;
      let policyViolationDetected = false;

      try {
        const request: ToolCallRequest = {
          runId,
          iteration,
          toolName: name as WorkerToolName,
          args: (toolArgs && typeof toolArgs === 'object' ? toolArgs : {}) as Record<
            string,
            unknown
          >,
          repoRoot,
          safetyPolicy: input.safetyPolicy,
          readFiles,
        };
        const beforeDecision = await toolPolicyGate.beforeToolCall(request);
        if (!beforeDecision.allowed) {
          toolResult = buildBlockedToolResult(request, beforeDecision);
          policyViolationDetected = true;
          await repo.createTaskEvent({
            taskRunId: runId,
            type: 'error',
            message: `[Tool Policy Blocked] ${name}: ${beforeDecision.message}`,
            actor: 'system',
            eventType: 'error',
            payloadJson: {
              iteration,
              toolName: name,
              policy: beforeDecision,
              runEvent: buildCanonicalRunEvent({
                runId,
                iteration,
                type: 'tool.policy_blocked',
                severity: 'error',
                actor: 'system',
                message: `[Tool Policy Blocked] ${name}: ${beforeDecision.message}`,
                data: { toolName: name, policy: beforeDecision },
              }),
            },
          });

          finalReportText = `Tool policy blocked execution. tool=${name} code=${beforeDecision.code}`;
          terminalState = 'needs_human';
          summary = 'Stopped by policy block';
          stoppedBy = 'policy';
        } else {
          const dispatch = await executeWorkerTool({
            toolName: request.toolName,
            args: beforeDecision.normalizedArgs,
            repoRoot,
            safetyPolicy: input.safetyPolicy,
            readFiles,
          });
          toolResult = dispatch.result;
          if (dispatch.readFilesChanged) {
            readFiles.splice(0, readFiles.length, ...dispatch.readFilesChanged);
          }
          const postDecision = await toolPolicyGate.afterToolCall(
            request,
            dispatch.result,
            beforeDecision.preflight
          );
          toolResult = postDecision.result;
          if (postDecision.policyViolation && !postDecision.policyViolation.allowed) {
            policyViolationDetected = true;
            finalReportText = `Tool policy violation detected after execution. tool=${name} code=${postDecision.policyViolation.code}`;
            terminalState = 'needs_human';
            summary = 'Stopped by postflight policy violation';
            stoppedBy = 'policy';
            await repo.createTaskEvent({
              taskRunId: runId,
              type: 'error',
              message: `[Tool Policy Violation] ${name}: ${postDecision.policyViolation.message}`,
              actor: 'system',
              eventType: 'error',
              payloadJson: {
                iteration,
                toolName: name,
                policy: postDecision.policyViolation,
                runEvent: buildCanonicalRunEvent({
                  runId,
                  iteration,
                  type: 'safety.policy_violation',
                  severity: 'error',
                  actor: 'system',
                  message: `[Tool Policy Violation] ${name}: ${postDecision.policyViolation.message}`,
                  data: { toolName: name, policy: postDecision.policyViolation },
                }),
              },
            });
          }
          if (postDecision.warnings?.length) {
            await repo.createTaskEvent({
              taskRunId: runId,
              type: 'warning',
              message: `[Tool Policy Warning] ${name}`,
              actor: 'system',
              eventType: 'system.warning',
              payloadJson: { iteration, toolName: name, warnings: postDecision.warnings },
            });
          }
        }
      } catch (toolErr: any) {
        toolResult = {
          ok: false,
          toolName: name,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          payload: {},
          error: {
            code: 'TOOL_EXECUTION_ERROR',
            message: toolErr.message,
          },
        };
      }

      logger.info(
        {
          runId,
          iteration,
          toolName: name,
          ok: toolResult.ok,
          error: toolResult.error,
          payloadKeys: Object.keys(toolResult.payload || {}),
          payloadPreview: JSON.stringify(toolResult.payload || {}).slice(0, 500),
        },
        'Worker tool call completed'
      );

      const failureBudget = budget.onToolResult(toolResult.ok);
      toolObservations.push(formatToolObservation(name, toolResult));

      // Log tool execution result in ledger
      await repo.createTaskEvent({
        taskRunId: runId,
        type: toolResult.ok ? 'info' : 'error',
        message: `[Worker Tool Result] Tool ${name} execution ${toolResult.ok ? 'SUCCESS' : 'FAILED'}.`,
        actor: 'worker',
        eventType: 'tool_result',
        payloadJson: {
          iteration,
          ...toolResult,
          runEvent: buildCanonicalRunEvent({
            runId,
            iteration,
            type: 'tool.call_finished',
            severity: toolResult.ok ? 'info' : 'error',
            actor: 'worker',
            message: `[Worker Tool Result] Tool ${name} execution ${toolResult.ok ? 'SUCCESS' : 'FAILED'}.`,
            data: { toolName: name, result: toolResult },
          }),
        },
      });

      if (policyViolationDetected && stoppedBy === 'policy') {
        await repo.updateTaskRun(runId, {
          finalReport: finalReportText,
          summary,
          status: 'needs_human',
        });
        await repo.updateTaskStatus(task.id, 'needs_human');
        break;
      }

      if (!failureBudget.allowed && failureBudget.reason === 'tool_failure') {
        const failureSummary = toolResult.error?.message || 'Unknown tool failure';
        finalReportText = `同一ラン内でツール実行失敗が3回連続したため中断しました。lastTool=${name} error=${failureSummary}`;
        await repo.createTaskEvent({
          taskRunId: runId,
          type: 'error',
          message: '[Safety Stop] Aborted after 3 consecutive tool failures.',
          actor: 'system',
          eventType: 'error',
          payloadJson: {
            iteration,
            ...(failureBudget.detail || {}),
            lastToolName: name,
            lastError: toolResult.error ?? null,
          },
        });
        await repo.updateTaskRun(runId, {
          finalReport: finalReportText,
          summary: 'Stopped by safety policy after repeated tool failures',
          status: 'needs_human',
        });
        await repo.updateTaskStatus(task.id, 'needs_human');
        terminalState = 'needs_human';
        summary = 'Stopped by safety policy after repeated tool failures';
        stoppedBy = 'tool_failure';
        break;
      }

      const multimodalType = detectMessageType(toolResult);
      if (multimodalType) {
        await repo.createTaskMessage({
          taskId: run.taskId,
          runId,
          role: 'tool',
          content: `[${name}] returned ${multimodalType} payload`,
          messageType: multimodalType,
          payloadJson: extractMultimodalPayload(multimodalType, toolResult),
        });
      }

      // Track raw output as artifacts if relevant
      if (
        toolResult.ok &&
        (name === 'git_diff' || name === 'run_command') &&
        toolResult.payload.diff
      ) {
        await repo.createArtifact({
          runId,
          kind: 'diff',
          path: 'git_diff.patch',
          metadataJson: { bytes: toolResult.payload.diff.length },
        });
      }
    } else {
      const missingToolBudget = budget.onMissingToolCall();
      if (!missingToolBudget.allowed) {
        finalReportText = 'toolCall が連続で欠落したため停止しました。';
        terminalState = 'needs_human';
        summary = 'Stopped by missing toolCall pattern';
        stoppedBy = 'missing_tool_call';
      }
      // Loop backup guard
      await repo.createTaskEvent({
        taskRunId: runId,
        type: 'warning',
        message:
          'Supervisor did not specify any worker tool action. continuing until missing_tool_call threshold.',
        actor: 'system',
        eventType: 'warning',
      });
      if (!missingToolBudget.allowed) {
        await repo.createTaskEvent({
          taskRunId: runId,
          type: 'error',
          message: '[Budget Stop] missing toolCall repeated.',
          actor: 'system',
          eventType: 'error',
          payloadJson: { reason: 'missing_tool_call', ...(missingToolBudget.detail || {}) },
        });
      }
      if (!missingToolBudget.allowed) {
        break;
      }
    }
  }

  const run = await repo.getTaskRun(runId);
  if (run) {
    await repo.updateTaskRun(runId, {
      finalReport: finalReportText,
      summary,
      status: terminalState,
    });
    await repo.updateTaskStatus(run.taskId, terminalState);
  }
  appendSupervisorTrace('supervisor_loop_finished', {
    runId,
    terminalState,
    stoppedBy,
    summary,
    riskLevel,
    iterations: iteration,
    supervisorToolCalls,
    evidenceRequired,
    finalReportLength: finalReportText.length,
  });
  logger.info(
    {
      runId,
      terminalState,
      stoppedBy,
      riskLevel,
      iterations: iteration,
      supervisorToolCalls,
      evidenceRequired,
      finalReportLength: finalReportText.length,
    },
    'Supervisor loop finished'
  );
  return {
    finalReport: finalReportText,
    terminalState,
    summary,
    stoppedBy,
    riskLevel,
  };
}

function requiresRepositoryEvidence(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  if (
    /(^|\s|["'`])[\w./-]+\.(md|ts|tsx|js|jsx|json|jsonl|sql|yaml|yml|toml|lock)\b/.test(normalized)
  ) {
    return true;
  }

  return [
    'review',
    'レビュー',
    'ドキュメント',
    'implementation-plan',
    '実装計画',
    '原因',
    '分析',
    'ログ',
    '調査',
    '修正',
    '実装',
    'regression',
  ].some((keyword) => normalized.includes(keyword));
}

function buildSupervisorUserPrompt(userInput: string, observations: string[]): string {
  if (observations.length === 0) return userInput;
  return [
    userInput,
    '',
    '[Repository evidence collected so far]',
    ...observations
      .slice(-6)
      .map((observation, index) => `Observation ${index + 1}:\n${observation}`),
    '',
    '[Final response requirements]',
    '- If you stop after reviewing repository evidence, finalResponse must contain the actual review findings.',
    '- Do not put the review result only in instruction or rationale.',
    '- Include concrete evidence references such as file paths or line numbers.',
  ].join('\n');
}

function evaluateStopDecisionQuality(input: {
  decision: Awaited<ReturnType<typeof callSupervisorLLM>>;
  evidenceRequired: boolean;
  supervisorToolCalls: number;
}): { reason: string; message: string } | null {
  const { decision, evidenceRequired, supervisorToolCalls } = input;
  if (!evidenceRequired || supervisorToolCalls === 0) return null;

  const finalResponse = decision.finalResponse?.trim() || '';
  if (!finalResponse) {
    return {
      reason: 'empty_final_response_after_evidence',
      message:
        'stop was ignored because finalResponse was empty after repository evidence was collected.',
    };
  }

  if (finalResponse.length < 120) {
    return {
      reason: 'too_short_final_response_after_evidence',
      message:
        'stop was ignored because finalResponse was too short to be a substantive review result.',
    };
  }

  if (
    !/(^|\s|`)[\w./-]+\.(md|ts|tsx|js|jsx|json|jsonl|sql|yaml|yml|toml|lock)(:\d+)?\b/.test(
      finalResponse
    )
  ) {
    return {
      reason: 'missing_evidence_reference_after_evidence',
      message:
        'stop was ignored because finalResponse did not include concrete repository evidence references.',
    };
  }

  return null;
}

function formatToolObservation(toolName: string, toolResult: any): string {
  const status = toolResult.ok ? 'ok' : 'failed';
  const header = `tool=${toolName} status=${status}`;
  if (!toolResult.ok) {
    return `${header}\nerror=${toolResult.error?.code || 'UNKNOWN'}: ${
      toolResult.error?.message || 'Unknown tool error'
    }`;
  }

  if (toolName === 'read_file') {
    const payload = toolResult.payload || {};
    const content = typeof payload.content === 'string' ? payload.content : '';
    const maxChars = 24_000;
    return [
      header,
      `lines=${payload.startLine ?? '?'}-${payload.endLine ?? '?'} total=${payload.totalLines ?? '?'}`,
      content.slice(0, maxChars),
      content.length > maxChars ? '[truncated]' : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  if (toolName === 'search_files') {
    const matches = Array.isArray(toolResult.payload?.matches) ? toolResult.payload.matches : [];
    return `${header}\nmatches=${matches.length}\n${JSON.stringify(matches.slice(0, 10)).slice(0, 3000)}`;
  }

  if (toolName === 'git_status') {
    return `${header}\n${toolResult.payload?.shortStatus || 'Clean worktree'}`;
  }

  if (toolName === 'git_diff') {
    return `${header}\n${toolResult.payload?.diffStat || 'No changes'}`;
  }

  return `${header}\npayload=${JSON.stringify(toolResult.payload || {}).slice(0, 3000)}`;
}

function detectMessageType(
  toolResult: any
): 'chart' | 'browser' | 'playwright' | 'flow' | 'markdown_document' | null {
  const payload = toolResult?.payload;
  if (!payload || typeof payload !== 'object') return null;
  if (payload.chartData) return 'chart';
  if (payload.browserFrameData) return 'browser';
  if (payload.playwrightResult) return 'playwright';
  if (payload.flowData) return 'flow';
  if (payload.markdownDocumentData) return 'markdown_document';
  return null;
}

function extractMultimodalPayload(messageType: string, toolResult: any) {
  const payload = toolResult?.payload || {};
  if (messageType === 'chart') return { chartData: payload.chartData };
  if (messageType === 'browser') return { browserFrameData: payload.browserFrameData };
  if (messageType === 'playwright') return { playwrightResult: payload.playwrightResult };
  if (messageType === 'flow') return { flowData: payload.flowData };
  if (messageType === 'markdown_document')
    return { markdownDocumentData: payload.markdownDocumentData };
  return {};
}

function buildCanonicalRunEvent(input: {
  runId: string;
  iteration: number;
  type: string;
  severity: 'info' | 'warning' | 'error';
  actor: 'system' | 'worker';
  message: string;
  data?: Record<string, unknown>;
}) {
  return {
    version: 1,
    runId: input.runId,
    timestamp: new Date().toISOString(),
    type: input.type,
    severity: input.severity,
    actor: input.actor,
    message: input.message,
    data: { iteration: input.iteration, ...(input.data || {}) },
  };
}
