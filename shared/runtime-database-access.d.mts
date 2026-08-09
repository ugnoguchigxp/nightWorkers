export const DATABASE_ACCESS_SCOPE_ENV: "NIGHTWORKERS_DATABASE_ACCESS_SCOPE";
export const ISOLATED_RUN_ROOT_ENV: "NIGHTWORKERS_ISOLATED_RUN_ROOT";
export const ISOLATED_RUN_ID_ENV: "NIGHTWORKERS_ISOLATED_RUN_ID";
export const ISOLATED_MANIFEST_PATH_ENV: "NIGHTWORKERS_ISOLATED_MANIFEST_PATH";
export const ISOLATED_RUNTIME_MANIFEST_VERSION: 1;

export const DATABASE_ACCESS_SCOPES: Readonly<{
	operational: "operational";
	isolatedTest: "isolated_test";
	isolatedEvaluation: "isolated_evaluation";
	maintenance: "maintenance";
}>;

export type DatabaseAccessScope =
	(typeof DATABASE_ACCESS_SCOPES)[keyof typeof DATABASE_ACCESS_SCOPES];

export type IsolatedRuntimeManifest = {
	schemaVersion: 1;
	scope: "isolated_test" | "isolated_evaluation";
	purpose: string;
	runId: string;
	runRoot: string;
	databasePath: string;
	runtimeRoot: string;
	workspaceRoot: string;
	createdAt: string;
	ownerPid: number;
};

export function requireDatabaseAccessScope(
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
	allowedScopes?: readonly DatabaseAccessScope[],
): DatabaseAccessScope;

export function requireMaintenanceDatabaseAccess(
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
): void;

export function createIsolatedRuntimeManifest(input: {
	scope: "isolated_test" | "isolated_evaluation";
	purpose: string;
	runId: string;
	runRoot: string;
	databasePath: string;
	runtimeRoot: string;
	workspaceRoot: string;
	createdAt?: string;
	ownerPid?: number;
}): IsolatedRuntimeManifest;

export function writeIsolatedRuntimeManifest(
	manifestPath: string,
	manifest: IsolatedRuntimeManifest,
): string;

export function assertDatabaseAccessEnvironment(
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
	options?: { operationalDatabasePath?: string },
): {
	scope: DatabaseAccessScope;
	databasePath: string;
	runId: string | null;
	manifestPath: string | null;
};

export function assertIsolatedRuntimeEnvironment(
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
	allowedScopes?: readonly DatabaseAccessScope[],
): {
	scope: DatabaseAccessScope;
	manifestPath: string;
	manifest: IsolatedRuntimeManifest;
};

export function resolveLocalDatabasePath(
	databaseUrl: string | undefined,
): string;
