import { NativeAgentRuntime } from '../agent-runtime/NativeAgentRuntime';
import { gitDiffTool } from '../worker-tools';
import type { IRunner, RunnerOptions, RunnerStatus } from './types';

export class NativeLocalRunner implements IRunner {
  private runtime = new NativeAgentRuntime();
  private logCallbacks = new Map<string, Array<(log: string) => void>>();
  private statuses = new Map<string, RunnerStatus>();

  async start(
    runId: string,
    repositoryPath: string,
    prompt: string,
    options?: RunnerOptions
  ): Promise<void> {
    this.statuses.set(runId, { status: 'running' });
    (async () => {
      try {
        const result = await this.runtime.start(
          {
            runId,
            taskId: '',
            repositoryId: '',
            repoRoot: repositoryPath,
            compiledPrompt: prompt,
            latestUserMessage: options?.latestUserMessage || prompt,
            timeoutSeconds: options?.timeoutSeconds ?? 3600,
            safetyPolicy: options?.safetyPolicy,
            contextSnapshot: {
              compiledPrompt: prompt,
              source: 'fallback',
            },
          },
          {
            emit: async (event) => {
              this.emitLog(runId, event.message);
            },
          }
        );
        const isSuccessLike =
          result.terminalState === 'completed' || result.terminalState === 'needs_review';
        this.statuses.set(runId, {
          status: result.terminalState,
          exitCode: isSuccessLike ? 0 : 1,
        });
      } catch (err: any) {
        this.statuses.set(runId, { status: 'failed' });
        this.emitLog(
          runId,
          `[System Error] Native Local Worker failed: ${err?.message ?? 'Unknown error'}`
        );
      }
    })();
  }

  async stop(runId: string): Promise<void> {
    await this.runtime.stop(runId);
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
