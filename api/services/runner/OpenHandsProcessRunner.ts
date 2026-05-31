import { type ChildProcess, exec, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import type { IRunner, RunnerOptions, RunnerStatus } from './types';

const execAsync = promisify(exec);

export class OpenHandsProcessRunner implements IRunner {
  private processes = new Map<string, ChildProcess>();
  private logCallbacks = new Map<string, Array<(log: string) => void>>();
  private statuses = new Map<string, RunnerStatus>();

  async start(
    runId: string,
    repositoryPath: string,
    prompt: string,
    options?: RunnerOptions
  ): Promise<void> {
    this.statuses.set(runId, { status: 'running' });

    const command = process.env.OPENHANDS_COMMAND || 'docker';
    const rawArgs =
      process.env.OPENHANDS_ARGS ||
      'run --rm -v {repoPath}:/workspace ghcr.io/all-hands-ai/openhands:latest -p {prompt}';

    // Format arguments
    const formattedArgs = rawArgs
      .replace('{repoPath}', repositoryPath)
      .replace('{prompt}', prompt)
      .split(' ')
      .filter((arg) => arg.length > 0);

    console.log(`Starting OpenHands runner for ${runId}: ${command} ${formattedArgs.join(' ')}`);

    try {
      const child = spawn(command, formattedArgs, {
        cwd: repositoryPath,
        env: { ...process.env, ...options?.env },
        shell: true, // run in shell to handle expansions or bash -c easily in development
      });

      this.processes.set(runId, child);

      child.stdout?.on('data', (data) => {
        const chunk = data.toString();
        this.emitLog(runId, chunk);
      });

      child.stderr?.on('data', (data) => {
        const chunk = data.toString();
        this.emitLog(runId, chunk); // capture standard error directly as logs
      });

      child.on('close', (code) => {
        console.log(`OpenHands process for ${runId} exited with code ${code}`);
        this.processes.delete(runId);
        this.statuses.set(runId, {
          status: code === 0 ? 'completed' : 'failed',
          exitCode: code ?? undefined,
        });
      });

      child.on('error', (err) => {
        console.error(`Failed to start OpenHands process for ${runId}:`, err);
        this.processes.delete(runId);
        this.statuses.set(runId, {
          status: 'failed',
        });
        this.emitLog(runId, `[System Error] Failed to start process: ${err.message}`);
      });
      // biome-ignore lint/suspicious/noExplicitAny: catch error
    } catch (err: any) {
      this.statuses.set(runId, { status: 'failed' });
      this.emitLog(runId, `[System Error] Process launch threw: ${err.message}`);
      throw err;
    }
  }

  async stop(runId: string): Promise<void> {
    const child = this.processes.get(runId);
    if (child) {
      child.kill('SIGINT');
      this.statuses.set(runId, { status: 'cancelled' });
      this.processes.delete(runId);
    }
  }

  async getStatus(runId: string): Promise<RunnerStatus> {
    return this.statuses.get(runId) || { status: 'failed' };
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

  async getGitDiff(repositoryPath: string): Promise<string> {
    try {
      const { stdout } = await execAsync('git diff', { cwd: repositoryPath });
      return stdout;
    } catch (err) {
      console.error('Failed to get git diff:', err);
      return '';
    }
  }
}

export const openHandsProcessRunner = new OpenHandsProcessRunner();
