import * as repo from '../../modules/nightworkers/nightworkers.repository';
import { runAgentHooks } from '../hooks/hooks-runner';
import type { AgentHookInput, AgentHookRunEvent } from '../hooks/types';
import { runSupervisorLoop } from '../supervisor/supervisor-loop';
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
    const emitHookEvent = async (event: AgentHookRunEvent) => {
      await repo.createRunEvent(
        {
          version: 1,
          runId: context.runId,
          taskId: context.taskId,
          timestamp: new Date().toISOString(),
          type: event.type,
          severity: event.severity,
          actor: 'system',
          message: event.message,
          data: event.data,
        },
        { payloadJson: event.data }
      );
    };
    let sessionHookOpened = false;
    let sessionHookClosed = false;
    const runSessionEndHook = async () => {
      if (!sessionHookOpened || sessionHookClosed) return;
      sessionHookClosed = true;
      await runAgentHooks({
        input: buildSessionHookInput('SessionEnd', context),
        repoRoot: context.repoRoot,
        onEvent: emitHookEvent,
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

      await runAgentHooks({
        input: buildSessionHookInput('SessionStart', context),
        repoRoot: context.repoRoot,
        onEvent: emitHookEvent,
      });
      sessionHookOpened = true;

      const promptHook = await runAgentHooks({
        input: {
          ...buildBaseHookInput('UserPromptSubmit', context),
          hook_event_name: 'UserPromptSubmit',
          prompt: context.latestUserMessage || context.compiledPrompt,
        },
        repoRoot: context.repoRoot,
        onEvent: emitHookEvent,
      });
      if (promptHook.decision === 'block') {
        const finalReport = promptHook.reason || 'User prompt was blocked by an agent hook.';
        await runSessionEndHook();
        return {
          terminalState: 'blocked',
          summary: finalReport,
          finalReport,
          stoppedBy: 'hook',
          riskLevel: 'medium',
          logContent: logs.join('\n'),
        };
      }

      await emit({
        type: 'turn_started',
        message: '[System] Handing control over to Supervisor Loop...',
      });
      const supervisorResult = await runSupervisorLoop({
        runId: context.runId,
        taskId: context.taskId,
        repositoryId: context.repositoryId,
        repoRoot: context.repoRoot,
        prompt: context.compiledPrompt,
        timeoutSeconds: context.timeoutSeconds,
        latestUserMessage: context.latestUserMessage,
        todoPlan: context.todoPlan,
        currentTodo: context.currentTodo,
        safetyPolicy: context.safetyPolicy,
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

      await runSessionEndHook();

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
      try {
        await runSessionEndHook();
      } catch (hookErr: any) {
        appendLog(
          `[System] SessionEnd hook failed while handling runtime error: ${
            hookErr?.message ?? String(hookErr)
          }`
        );
      }
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

function buildBaseHookInput(
  event: AgentHookInput['hook_event_name'],
  context: AgentRunContext
): Omit<AgentHookInput, 'hook_event_name'> & {
  hook_event_name: AgentHookInput['hook_event_name'];
} {
  return {
    hook_event_name: event,
    session_id: context.taskId,
    run_id: context.runId,
    task_id: context.taskId,
    repository_id: context.repositoryId,
    cwd: context.repoRoot,
    timestamp: new Date().toISOString(),
  } as AgentHookInput;
}

function buildSessionHookInput(
  event: 'SessionStart' | 'SessionEnd',
  context: AgentRunContext
): AgentHookInput {
  return {
    ...buildBaseHookInput(event, context),
    hook_event_name: event,
    source: event === 'SessionStart' ? 'run_start' : 'run_end',
  };
}
