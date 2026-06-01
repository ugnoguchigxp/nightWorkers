import { appendSupervisorTrace, logger } from '../../lib/logger';
import * as repo from '../../modules/nightworkers/nightworkers.repository';
import {
  applyPatchTool,
  findFileTool,
  gitDiffTool,
  gitStatusTool,
  listDirTool,
  readFileTool,
  replaceContentTool,
  runCommandTool,
  searchFilesTool,
} from '../worker-tools';
import { callSupervisorLLM } from './llm-provider';
import { buildRound1SystemPrompt, buildRound2SystemPrompt } from './prompt';

export interface SupervisorLoopInput {
  runId: string;
  repoRoot: string;
  prompt: string;
  timeoutSeconds: number;
  latestUserMessage?: string;
}

export async function runSupervisorLoop(input: SupervisorLoopInput): Promise<string> {
  const { runId, repoRoot, prompt, latestUserMessage } = input;
  let iteration = 0;
  let finalReportText = 'Task execution completed.';
  let consecutiveToolFailures = 0;
  const maxConsecutiveToolFailures = 3;

  // Maintain list of read files for read-before-edit policy validation
  const readFiles: string[] = [];

  while (true) {
    iteration++;
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
    const userPrompt = userInput;

    // 4. Invoke the Supervisor LLM
    let decision: Awaited<ReturnType<typeof callSupervisorLLM>>;
    try {
      const round1 = await callSupervisorLLM(buildRound1SystemPrompt(repoRoot), userPrompt, {
        tolerateSchemaFailure: true,
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
      finalReportText =
        decision.finalResponse?.trim() || decision.instruction?.trim() || decision.rationale;
      const terminalState = decision.terminalState || 'completed';

      await repo.updateTaskRun(runId, {
        finalReport: finalReportText,
        summary: decision.instruction || 'Stopped by supervisor decision',
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
      logger.info({ runId, iteration, toolName: name, toolArgs }, 'Worker tool call start');
      // Log tool call start
      await repo.createTaskEvent({
        taskRunId: runId,
        type: 'info',
        message: `[Worker Tool Call] Invoking tool ${name}...`,
        actor: 'worker',
        eventType: 'tool_call',
        payloadJson: { iteration, toolName: name, arguments: toolArgs },
      });

      let toolResult: any;

      try {
        if (name === 'list_dir') {
          toolResult = await listDirTool({
            relativePath: toolArgs.relativePath,
            recursive: toolArgs.recursive,
            skipIgnored: toolArgs.skipIgnored,
            maxEntries: toolArgs.maxEntries,
            repoRoot,
          });
        } else if (name === 'find_file') {
          toolResult = await findFileTool({
            fileMask: toolArgs.fileMask,
            relativePath: toolArgs.relativePath,
            recursive: toolArgs.recursive,
            maxResults: toolArgs.maxResults,
            repoRoot,
          });
        } else if (name === 'read_file') {
          toolResult = await readFileTool({
            filePath: toolArgs.filePath,
            repoRoot,
            startLine: toolArgs.startLine,
            endLine: toolArgs.endLine,
          });

          if (toolResult.ok && toolResult.payload.content) {
            // Track files read
            if (!readFiles.includes(toolArgs.filePath)) {
              readFiles.push(toolArgs.filePath);
            }
          }
        } else if (name === 'search_files') {
          toolResult = await searchFilesTool({
            query: toolArgs.query,
            repoRoot,
            glob: toolArgs.glob,
          });
        } else if (name === 'apply_patch') {
          toolResult = await applyPatchTool({
            patchContent: toolArgs.patchContent,
            repoRoot,
            readFiles,
            requireReadBeforeEdit: true,
          });
        } else if (name === 'replace_content') {
          toolResult = await replaceContentTool({
            filePath: toolArgs.filePath,
            needle: toolArgs.needle,
            replacement: toolArgs.replacement,
            mode: toolArgs.mode,
            allowMultipleOccurrences: toolArgs.allowMultipleOccurrences,
            readFiles,
            requireReadBeforeEdit: true,
            repoRoot,
          });
        } else if (name === 'run_command') {
          toolResult = await runCommandTool({
            command: toolArgs.command,
            repoRoot,
          });
        } else if (name === 'git_status') {
          toolResult = await gitStatusTool({
            repoRoot,
          });
        } else if (name === 'git_diff') {
          toolResult = await gitDiffTool({
            repoRoot,
          });
        } else {
          throw new Error(`Unsupported tool name: ${name}`);
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

      if (!toolResult.ok) {
        consecutiveToolFailures += 1;
      } else {
        consecutiveToolFailures = 0;
      }

      // Log tool execution result in ledger
      await repo.createTaskEvent({
        taskRunId: runId,
        type: toolResult.ok ? 'info' : 'error',
        message: `[Worker Tool Result] Tool ${name} execution ${toolResult.ok ? 'SUCCESS' : 'FAILED'}.`,
        actor: 'worker',
        eventType: 'tool_result',
        payloadJson: { iteration, ...toolResult },
      });

      if (consecutiveToolFailures >= maxConsecutiveToolFailures) {
        const failureSummary = toolResult.error?.message || 'Unknown tool failure';
        finalReportText = `同一ラン内でツール実行失敗が${maxConsecutiveToolFailures}回連続したため中断しました。lastTool=${name} error=${failureSummary}`;
        await repo.createTaskEvent({
          taskRunId: runId,
          type: 'error',
          message: `[Safety Stop] Aborted after ${maxConsecutiveToolFailures} consecutive tool failures.`,
          actor: 'system',
          eventType: 'error',
          payloadJson: {
            iteration,
            consecutiveToolFailures,
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
      // Loop backup guard
      await repo.createTaskEvent({
        taskRunId: runId,
        type: 'warning',
        message: 'Supervisor did not specify any worker tool action, ending execution loop.',
        actor: 'system',
        eventType: 'warning',
      });
      break;
    }
  }

  logger.info({ runId, finalReportLength: finalReportText.length }, 'Supervisor loop finished');
  return finalReportText;
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
