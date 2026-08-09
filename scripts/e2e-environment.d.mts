import type { IsolatedRuntimeEnvironment } from "./isolated-runtime-environment.mjs";

export type E2eEnvironment = IsolatedRuntimeEnvironment & {
	env: NodeJS.ProcessEnv & Record<string, string>;
};

export function assertIsolatedE2eEnvironment(env?: NodeJS.ProcessEnv): {
	runRoot: string;
	databasePath: string;
	workspaceRoot: string;
	runtimeRoot: string;
};

export function createIsolatedE2eEnvironment(options?: {
	repositoryRoot?: string;
	runId?: string;
	webPort?: number;
	apiPort?: number;
	env?: NodeJS.ProcessEnv;
}): Promise<E2eEnvironment>;

export function cleanupIsolatedE2eEnvironment(
	environment: E2eEnvironment,
): void;
