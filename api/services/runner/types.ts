export interface RunnerOptions {
  timeoutSeconds?: number;
  env?: Record<string, string>;
  latestUserMessage?: string;
}

export interface RunnerStatus {
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  exitCode?: number;
}

export interface IRunner {
  start(
    runId: string,
    repositoryPath: string,
    prompt: string,
    options?: RunnerOptions
  ): Promise<void>;
  stop(runId: string): Promise<void>;
  getStatus(runId: string): Promise<RunnerStatus>;
  onLog(runId: string, callback: (log: string) => void): void;
}
