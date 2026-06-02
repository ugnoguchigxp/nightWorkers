import { runSupervisorLoop } from '../supervisor/supervisor-loop';
import { gitDiffTool, gitStatusTool } from '../worker-tools';
import type { AgentRunContext, AgentRuntime, AgentRuntimeResult, AgentRuntimeSink } from './types';

const DEFAULT_RESULT: AgentRuntimeResult = {
  terminalState: 'failed',
  summary: 'Runtime execution failed.',
  finalReport: '',
  stoppedBy: 'llm_error',
  riskLevel: 'high',
};

export class NativeAgentRuntime implements AgentRuntime {
  readonly kind = 'native-local' as const;
  private cancelledRunIds = new Set<string>();

  async start(
    context: AgentRunContext,
    sink: AgentRuntimeSink,
    signal?: AbortSignal
  ): Promise<AgentRuntimeResult> {
    const logs: string[] = [];
    const appendLog = (line: string) => {
      logs.push(line);
    };
    const currentTodoData = context.currentTodo
      ? {
          todoId: context.currentTodo.id,
          todoSeq: context.currentTodo.seq,
          todoTitle: context.currentTodo.title,
          taskType: context.currentTodo.taskType,
          procedureId: context.currentTodo.procedureId,
        }
      : {};

    const emit = async (event: Parameters<AgentRuntimeSink['emit']>[0]) => {
      appendLog(event.message);
      const payload =
        event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
          ? { ...currentTodoData, ...(event.payload as Record<string, unknown>) }
          : { ...currentTodoData, payload: event.payload };
      await sink.emit({
        ...event,
        payload: Object.keys(currentTodoData).length > 0 ? payload : event.payload,
      });
    };

    try {
      if (signal?.aborted || this.cancelledRunIds.has(context.runId)) {
        return this.toCancelled(logs.join('\n'));
      }

      await emit({
        type: 'runtime_started',
        message: `[System] Native Local Worker started execution in workspace: ${context.repoRoot}`,
      });

      await emit({
        type: 'tool_call_started',
        message: '[Tool Call] Executing git_status...',
        payload: { toolName: 'git_status' },
      });
      const gitStatusRes = await gitStatusTool({ repoRoot: context.repoRoot });
      await emit({
        type: 'tool_call_finished',
        message: `Git short status: ${gitStatusRes.payload.shortStatus || 'Clean worktree'}`,
        payload: gitStatusRes,
      });

      await emit({
        type: 'turn_started',
        message: '[System] Handing control over to Supervisor Loop...',
      });
      const supervisorResult = await runSupervisorLoop({
        runId: context.runId,
        repoRoot: context.repoRoot,
        prompt: context.compiledPrompt,
        timeoutSeconds: context.timeoutSeconds,
        latestUserMessage: context.latestUserMessage,
        todoPlan: context.todoPlan,
        currentTodo: context.currentTodo,
        safetyPolicy: context.safetyPolicy,
      });

      await emit({
        type: 'tool_call_started',
        message: '[Tool Call] Executing git_diff...',
        payload: { toolName: 'git_diff' },
      });
      const gitDiffRes = await gitDiffTool({ repoRoot: context.repoRoot });
      await emit({
        type: 'diff_collected',
        message: `Execution complete. Diff stat:\n${gitDiffRes.payload.diffStat || 'No changes'}`,
        payload: {
          diffStat: gitDiffRes.payload.diffStat,
          hasChanges: gitDiffRes.payload.hasChanges,
        },
      });

      const terminalState = this.cancelledRunIds.has(context.runId)
        ? 'cancelled'
        : supervisorResult.terminalState;
      const stoppedBy = this.cancelledRunIds.has(context.runId)
        ? 'cancelled'
        : supervisorResult.stoppedBy;
      const result: AgentRuntimeResult = {
        terminalState,
        summary: supervisorResult.summary,
        finalReport: supervisorResult.finalReport,
        stoppedBy,
        riskLevel: supervisorResult.riskLevel,
        diffPatch: gitDiffRes.payload.diff,
        logContent: logs.join('\n'),
      };

      await emit({
        type: 'runtime_finished',
        message: `[System] Native Local Worker finished with terminalState=${result.terminalState}.`,
        payload: {
          terminalState: result.terminalState,
          finalReport: result.finalReport,
          summary: result.summary,
          stoppedBy: result.stoppedBy,
        },
      });

      return result;
    } catch (err: any) {
      const message = `[System Error] Native Local Worker failed: ${err?.message ?? 'Unknown error'}`;
      await emit({
        type: 'runtime_error',
        message,
        payload: {
          error: err?.message ?? String(err),
        },
      });
      logs.push(message);
      return {
        ...DEFAULT_RESULT,
        summary: err?.message ? `Runtime failed: ${err.message}` : DEFAULT_RESULT.summary,
        logContent: logs.join('\n'),
      };
    }
  }

  async stop(runId: string): Promise<void> {
    this.cancelledRunIds.add(runId);
  }

  private toCancelled(logContent: string): AgentRuntimeResult {
    return {
      terminalState: 'cancelled',
      summary: 'Runtime execution cancelled.',
      finalReport: 'Runtime execution cancelled.',
      stoppedBy: 'cancelled',
      riskLevel: 'medium',
      logContent,
    };
  }
}
