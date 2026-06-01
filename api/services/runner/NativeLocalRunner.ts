import * as repo from '../../modules/nightworkers/nightworkers.repository';
import { runSupervisorLoop } from '../supervisor/supervisor-loop';
import { gitDiffTool, gitStatusTool } from '../worker-tools';
import type { IRunner, RunnerOptions, RunnerStatus } from './types';

export class NativeLocalRunner implements IRunner {
  private logCallbacks = new Map<string, Array<(log: string) => void>>();
  private statuses = new Map<string, RunnerStatus>();

  async start(
    runId: string,
    repositoryPath: string,
    prompt: string,
    options?: RunnerOptions
  ): Promise<void> {
    this.statuses.set(runId, { status: 'running' });
    this.emitLog(
      runId,
      `[System] Native Local Worker started execution in workspace: ${repositoryPath}`
    );

    // Asynchronously run the execution loop so start returns immediately
    (async () => {
      try {
        // Fetch run context
        const run = await repo.getTaskRun(runId);
        if (!run) {
          throw new Error(`Run context not found: ${runId}`);
        }

        // 1. Initial git status check
        this.emitLog(runId, '[Tool Call] Executing git_status...');
        const gitStatusRes = await gitStatusTool({ repoRoot: repositoryPath });

        await repo.createTaskEvent({
          taskRunId: runId,
          type: 'info',
          message: `Git short status: ${gitStatusRes.payload.shortStatus || 'Clean worktree'}`,
          actor: 'worker',
          eventType: 'tool_result',
          payloadJson: gitStatusRes,
        });

        // 2. Call the main supervisor control loop
        this.emitLog(runId, '[System] Handing control over to Supervisor Loop...');
        const finalReport = await runSupervisorLoop({
          runId,
          repoRoot: repositoryPath,
          prompt,
          timeoutSeconds: options?.timeoutSeconds ?? 3600,
          latestUserMessage: options?.latestUserMessage,
        });

        // 3. Final git diff check
        this.emitLog(runId, '[Tool Call] Executing git_diff...');
        const gitDiffRes = await gitDiffTool({ repoRoot: repositoryPath });

        await repo.createTaskEvent({
          taskRunId: runId,
          type: 'checkpoint',
          message: `Execution complete. Diff stat:\n${gitDiffRes.payload.diffStat || 'No changes'}`,
          actor: 'supervisor',
          eventType: 'final_report',
          payloadJson: {
            finalReport,
            diffStat: gitDiffRes.payload.diffStat,
          },
        });

        // Update run status
        this.statuses.set(runId, { status: 'completed', exitCode: 0 });
        this.emitLog(runId, '[System] Native Local Worker completed successfully.');
      } catch (err: any) {
        console.error(`Error in NativeLocalRunner execution loop for run ${runId}:`, err);
        this.statuses.set(runId, { status: 'failed' });
        this.emitLog(runId, `[System Error] Native Local Worker failed: ${err.message}`);
      }
    })();
  }

  async stop(runId: string): Promise<void> {
    this.statuses.set(runId, { status: 'cancelled' });
    this.emitLog(runId, '[System] Native Local Worker execution stopped.');
  }

  async getStatus(runId: string): Promise<RunnerStatus> {
    return this.statuses.get(runId) || { status: 'failed' };
  }

  async getGitDiff(repositoryPath: string): Promise<string> {
    try {
      const res = await gitDiffTool({ repoRoot: repositoryPath });
      return res.payload.diff;
    } catch {
      return '';
    }
  }

  onLog(runId: string, callback: (log: string) => void): void {
    if (!this.logCallbacks.has(runId)) {
      this.logCallbacks.set(runId, []);
    }
    this.logCallbacks.get(runId)?.push(callback);
  }

  private emitLog(runId: string, log: string) {
    const callbacks = this.logCallbacks.get(runId);
    if (callbacks) {
      for (const cb of callbacks) {
        cb(log);
      }
    }
  }
}

export const nativeLocalRunner = new NativeLocalRunner();
export const openHandsProcessRunner = nativeLocalRunner; // compatible export
