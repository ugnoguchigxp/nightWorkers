import type { AgentSafetyPolicy } from "../../modules/codingAgent";

export interface RunnerOptions {
	timeoutSeconds?: number;
	env?: Record<string, string>;
	latestUserMessage?: string;
	safetyPolicy?: AgentSafetyPolicy;
}

export interface RunnerStatus {
	status:
		| "running"
		| "completed"
		| "failed"
		| "cancelled"
		| "needs_review"
		| "needs_human"
		| "blocked"
		| "timed_out";
	exitCode?: number;
}

export interface IRunner {
	start(
		runId: string,
		repositoryPath: string,
		prompt: string,
		options?: RunnerOptions,
	): Promise<void>;
	stop(runId: string): Promise<void>;
	getStatus(runId: string): Promise<RunnerStatus>;
	onLog(runId: string, callback: (log: string) => void): void;
}
