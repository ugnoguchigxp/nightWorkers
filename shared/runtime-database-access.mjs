import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DATABASE_ACCESS_SCOPE_ENV = "NIGHTWORKERS_DATABASE_ACCESS_SCOPE";
export const ISOLATED_RUN_ROOT_ENV = "NIGHTWORKERS_ISOLATED_RUN_ROOT";
export const ISOLATED_RUN_ID_ENV = "NIGHTWORKERS_ISOLATED_RUN_ID";
export const ISOLATED_MANIFEST_PATH_ENV = "NIGHTWORKERS_ISOLATED_MANIFEST_PATH";
export const ISOLATED_RUNTIME_MANIFEST_VERSION = 1;

export const DATABASE_ACCESS_SCOPES = Object.freeze({
	operational: "operational",
	isolatedTest: "isolated_test",
	isolatedEvaluation: "isolated_evaluation",
	maintenance: "maintenance",
});

const VALID_DATABASE_ACCESS_SCOPES = new Set(
	Object.values(DATABASE_ACCESS_SCOPES),
);
const ISOLATED_DATABASE_ACCESS_SCOPES = new Set([
	DATABASE_ACCESS_SCOPES.isolatedTest,
	DATABASE_ACCESS_SCOPES.isolatedEvaluation,
]);

export function requireDatabaseAccessScope(env = process.env, allowedScopes) {
	const scope = env[DATABASE_ACCESS_SCOPE_ENV]?.trim();
	if (!scope || !VALID_DATABASE_ACCESS_SCOPES.has(scope)) {
		throw new Error(
			`${DATABASE_ACCESS_SCOPE_ENV} must explicitly select operational, isolated_test, isolated_evaluation, or maintenance before database modules are loaded.`,
		);
	}
	if (allowedScopes && !allowedScopes.includes(scope)) {
		throw new Error(
			`${DATABASE_ACCESS_SCOPE_ENV}=${scope} is not allowed for this command; expected ${allowedScopes.join(" or ")}.`,
		);
	}
	return scope;
}

export function requireMaintenanceDatabaseAccess(env = process.env) {
	requireDatabaseAccessScope(env, [DATABASE_ACCESS_SCOPES.maintenance]);
	if (env.NIGHTWORKERS_MAINTENANCE_ALLOW_OPERATIONAL !== "1") {
		throw new Error(
			"Maintenance database access requires NIGHTWORKERS_MAINTENANCE_ALLOW_OPERATIONAL=1.",
		);
	}
}

export function createIsolatedRuntimeManifest(input) {
	const scope = requireDatabaseAccessScope(
		{ [DATABASE_ACCESS_SCOPE_ENV]: input.scope },
		[
			DATABASE_ACCESS_SCOPES.isolatedTest,
			DATABASE_ACCESS_SCOPES.isolatedEvaluation,
		],
	);
	return {
		schemaVersion: ISOLATED_RUNTIME_MANIFEST_VERSION,
		scope,
		purpose: requireNonEmptyString(input.purpose, "purpose"),
		runId: requireNonEmptyString(input.runId, "runId"),
		runRoot: path.resolve(requireNonEmptyString(input.runRoot, "runRoot")),
		databasePath: path.resolve(
			requireNonEmptyString(input.databasePath, "databasePath"),
		),
		runtimeRoot: path.resolve(
			requireNonEmptyString(input.runtimeRoot, "runtimeRoot"),
		),
		workspaceRoot: path.resolve(
			requireNonEmptyString(input.workspaceRoot, "workspaceRoot"),
		),
		createdAt: input.createdAt ?? new Date().toISOString(),
		ownerPid: input.ownerPid ?? process.pid,
	};
}

export function writeIsolatedRuntimeManifest(manifestPath, manifest) {
	const target = path.resolve(manifestPath);
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`, {
		encoding: "utf8",
		mode: 0o600,
	});
	return target;
}

export function assertDatabaseAccessEnvironment(
	env = process.env,
	options = {},
) {
	const scope = requireDatabaseAccessScope(env);
	const databasePath = resolveLocalDatabasePath(env.DATABASE_URL);
	const operationalDatabasePath = options.operationalDatabasePath
		? path.resolve(options.operationalDatabasePath)
		: null;

	if (scope === DATABASE_ACCESS_SCOPES.operational) {
		if (!operationalDatabasePath) {
			throw new Error(
				"Operational database validation requires operationalDatabasePath.",
			);
		}
		assertSamePath(
			databasePath,
			operationalDatabasePath,
			"operational database",
		);
		if (env.NIGHTWORKERS_E2E_ISOLATED === "1" || env[ISOLATED_RUN_ROOT_ENV]) {
			throw new Error(
				"Operational database scope cannot be combined with isolation settings.",
			);
		}
		return { scope, databasePath, runId: null, manifestPath: null };
	}

	if (scope === DATABASE_ACCESS_SCOPES.maintenance) {
		requireMaintenanceDatabaseAccess(env);
		return { scope, databasePath, runId: null, manifestPath: null };
	}

	if (operationalDatabasePath) {
		assertDifferentPath(databasePath, operationalDatabasePath, scope);
	}

	if (
		scope === DATABASE_ACCESS_SCOPES.isolatedTest &&
		env.NIGHTWORKERS_E2E_ISOLATED !== "1" &&
		!env[ISOLATED_MANIFEST_PATH_ENV]
	) {
		if (env.NODE_ENV !== "test") {
			throw new Error(
				"Manifest-free isolated_test access is only valid under NODE_ENV=test.",
			);
		}
		const vitestDatabasePath = env.NIGHTWORKERS_VITEST_DB_PATH?.trim();
		if (!vitestDatabasePath) {
			throw new Error(
				"Manifest-free isolated_test access requires NIGHTWORKERS_VITEST_DB_PATH.",
			);
		}
		assertSamePath(databasePath, vitestDatabasePath, "Vitest database");
		return { scope, databasePath, runId: null, manifestPath: null };
	}

	const isolated = assertIsolatedRuntimeEnvironment(env, [scope]);
	return {
		scope,
		databasePath,
		runId: isolated.manifest.runId,
		manifestPath: isolated.manifestPath,
	};
}

export function assertIsolatedRuntimeEnvironment(
	env = process.env,
	allowedScopes = [
		DATABASE_ACCESS_SCOPES.isolatedTest,
		DATABASE_ACCESS_SCOPES.isolatedEvaluation,
	],
) {
	const scope = requireDatabaseAccessScope(env, allowedScopes);
	if (!ISOLATED_DATABASE_ACCESS_SCOPES.has(scope)) {
		throw new Error(`Database scope ${scope} is not isolated.`);
	}
	const manifestPath = path.resolve(
		requireEnvironmentValue(env, ISOLATED_MANIFEST_PATH_ENV),
	);
	const manifest = readManifest(manifestPath);
	if (manifest.schemaVersion !== ISOLATED_RUNTIME_MANIFEST_VERSION) {
		throw new Error("Unsupported isolated runtime manifest schemaVersion.");
	}
	if (manifest.scope !== scope) {
		throw new Error(
			"Isolated runtime manifest scope does not match the environment.",
		);
	}
	const runId = requireEnvironmentValue(env, ISOLATED_RUN_ID_ENV);
	if (manifest.runId !== runId) {
		throw new Error(
			"Isolated runtime manifest runId does not match the environment.",
		);
	}
	const runRoot = path.resolve(
		requireEnvironmentValue(env, ISOLATED_RUN_ROOT_ENV),
	);
	assertSamePath(manifest.runRoot, runRoot, "isolated run root");
	assertPathInside(runRoot, manifestPath, "manifest");
	assertPathInside(runRoot, manifest.databasePath, "database");
	assertPathInside(runRoot, manifest.runtimeRoot, "runtime");
	assertPathInside(runRoot, manifest.workspaceRoot, "workspace");
	assertSamePath(
		resolveLocalDatabasePath(env.DATABASE_URL),
		manifest.databasePath,
		"isolated database",
	);
	assertSamePath(
		requireEnvironmentValue(env, "NIGHTWORKERS_RUNTIME_DIR"),
		manifest.runtimeRoot,
		"isolated runtime",
	);

	return { scope, manifestPath, manifest };
}

export function resolveLocalDatabasePath(databaseUrl) {
	const value = databaseUrl?.trim();
	if (!value)
		throw new Error(
			"DATABASE_URL is required before database access validation.",
		);
	if (!value.startsWith("file:")) {
		throw new Error(
			"NightWorkers database safety only permits local file: SQLite URLs.",
		);
	}
	return path.resolve(fileURLToPath(value));
}

function readManifest(manifestPath) {
	let parsed;
	try {
		parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
	} catch (error) {
		throw new Error(
			`Unable to read isolated runtime manifest: ${String(error)}`,
		);
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("Isolated runtime manifest must be an object.");
	}
	for (const key of [
		"scope",
		"purpose",
		"runId",
		"runRoot",
		"databasePath",
		"runtimeRoot",
		"workspaceRoot",
		"createdAt",
	]) {
		requireNonEmptyString(parsed[key], `manifest.${key}`);
	}
	if (!Number.isInteger(parsed.ownerPid) || parsed.ownerPid < 1) {
		throw new Error("manifest.ownerPid must be a positive integer.");
	}
	return parsed;
}

function requireEnvironmentValue(env, name) {
	return requireNonEmptyString(env[name], name);
}

function requireNonEmptyString(value, name) {
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`${name} is required.`);
	}
	return value.trim();
}

function assertPathInside(root, candidate, label) {
	const resolvedRoot = path.resolve(root);
	const resolvedCandidate = path.resolve(candidate);
	const relative = path.relative(resolvedRoot, resolvedCandidate);
	if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
		throw new Error(`Isolated ${label} path must stay inside the run root.`);
	}

	const existingRoot = fs.realpathSync(resolvedRoot);
	const existingCandidate = fs.realpathSync(resolvedCandidate);
	const realRelative = path.relative(existingRoot, existingCandidate);
	if (
		!realRelative ||
		realRelative.startsWith("..") ||
		path.isAbsolute(realRelative)
	) {
		throw new Error(
			`Isolated ${label} real path must stay inside the run root.`,
		);
	}
}

function assertSamePath(actual, expected, label) {
	if (path.resolve(actual) !== path.resolve(expected)) {
		throw new Error(
			`${label} path does not match the authorized database context.`,
		);
	}
}

function assertDifferentPath(actual, operational, scope) {
	if (path.resolve(actual) === path.resolve(operational)) {
		throw new Error(
			`${scope} database access cannot target the operational database.`,
		);
	}
}
