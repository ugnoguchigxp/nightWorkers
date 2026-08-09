import type {
	DatabaseAccessScope,
	IsolatedRuntimeManifest,
} from "../shared/runtime-database-access.mjs";

export type IsolatedRuntimeEnvironment = {
	scope: DatabaseAccessScope;
	runId: string;
	runRoot: string;
	parentRoot: string;
	databasePath: string;
	runtimeRoot: string;
	settingsRoot: string;
	workspaceRoot: string;
	codexHome: string;
	manifestPath: string;
	manifest: IsolatedRuntimeManifest;
	env: Record<string, string>;
};

export function createIsolatedRuntimeEnvironment(options?: {
	repositoryRoot?: string;
	scope?: "isolated_test" | "isolated_evaluation";
	rootName?: string;
	runId?: string;
	databaseName?: string;
	purpose?: string;
	env?: Record<string, string | undefined>;
}): IsolatedRuntimeEnvironment;

export function cleanupIsolatedRuntimeEnvironment(
	environment: IsolatedRuntimeEnvironment,
): void;
