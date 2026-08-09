import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { config as dotenvConfig } from "dotenv";
import { z } from "zod";
import {
	assertDatabaseAccessEnvironment,
	requireDatabaseAccessScope,
} from "../shared/runtime-database-access.mjs";
import {
	ensureDesktopRuntimeBootstrap,
	ensureRuntimeDatabasePath,
} from "./runtime/bootstrap";
import { getRuntimePaths } from "./runtime/paths";
import { isLoopbackHost } from "./security/listen-security";
import { readApplicationSetting } from "./services/settings/application-settings-store";

dotenvConfig({ quiet: true }); // ensure env is loaded in Node.js, Bun might auto-load
requireDatabaseAccessScope(process.env);
normalizeListenPort(process.env);
const configuredDatabaseUrl = process.env.DATABASE_URL?.trim();
isolateDirectTestDatabase(process.env);
ensureDesktopRuntimeBootstrap(process.env, {
	preserveConfiguredDatabaseUrl:
		Boolean(configuredDatabaseUrl) || process.env.NODE_ENV !== "production",
});
ensureRuntimeDatabasePath(process.env, {
	legacyDatabaseUrl: configuredDatabaseUrl,
});
const databaseAccess = assertDatabaseAccessEnvironment(process.env, {
	operationalDatabasePath: getRuntimePaths(process.env).databasePath,
});
applyPersistedBootstrapSettings(process.env);

function applyPersistedBootstrapSettings(env: NodeJS.ProcessEnv) {
	if (
		env.NODE_ENV === "test" ||
		env.NIGHTWORKERS_E2E_ISOLATED === "1" ||
		env.NIGHTWORKERS_DATABASE_ACCESS_SCOPE === "isolated_evaluation" ||
		env.NIGHTWORKERS_CONFIG_TEST === "1" ||
		env.NIGHTWORKERS_EXECUTION_ROLE === "worker"
	) {
		return;
	}
	const serverKeys = ["PORT", "HOST", "CORS_ORIGIN", "LOG_LEVEL"] as const;
	const runtimeKeys = [
		"ACTIVE_LLM_PROVIDER",
		"CODEX_ENABLED",
		"IMPLEMENTATION_RUNTIME_LANE",
		"SESSION_QUEUE_MAX_CONCURRENCY",
		"NIGHTWORKERS_RUN_CONTROL_KERNEL_MODE",
		"NIGHTWORKERS_EVIDENCE_TODO_MODE",
	] as const;
	const integrationKeys = [
		"NIGHTWORKERS_VULNWORKBENCH_ENABLED",
		"NIGHTWORKERS_VULNWORKBENCH_CWD",
		"NIGHTWORKERS_VULNWORKBENCH_TIMEOUT_SECONDS",
		"NIGHTWORKERS_VULNWORKBENCH_HANDOFF_TIMEOUT_SECONDS",
		"NIGHTWORKERS_SECURITY_PLUGIN_INTEGRATION",
	] as const;
	const persisted = readApplicationSetting<Record<string, string>>("server");
	const persistedRuntime =
		readApplicationSetting<Record<string, string>>("runtime");
	const persistedIntegrations =
		readApplicationSetting<Record<string, string>>("integrations");
	Object.assign(
		env,
		persisted ?? {},
		persistedRuntime ?? {},
		persistedIntegrations ?? {},
	);
	normalizeListenPort(env);
	env.__NIGHTWORKERS_PERSIST_BOOTSTRAP_SETTINGS = JSON.stringify({
		server: !persisted ? pickEnvironment(env, serverKeys) : null,
		runtime: !persistedRuntime ? pickEnvironment(env, runtimeKeys) : null,
		integrations: !persistedIntegrations
			? pickEnvironment(env, integrationKeys)
			: null,
	});
}

export async function persistBootstrapSettings() {
	const raw = process.env.__NIGHTWORKERS_PERSIST_BOOTSTRAP_SETTINGS;
	if (!raw) return;
	const pending = JSON.parse(raw) as Record<
		string,
		Record<string, string> | null
	>;
	const { writeApplicationSetting } = await import(
		"./services/settings/application-settings-store"
	);
	for (const scope of ["server", "runtime", "integrations"] as const) {
		const value = pending[scope];
		if (value) await writeApplicationSetting(scope, value);
	}
	delete process.env.__NIGHTWORKERS_PERSIST_BOOTSTRAP_SETTINGS;
}

function normalizeListenPort(env: NodeJS.ProcessEnv) {
	const port = Number(env.PORT);
	if (!Number.isInteger(port) || port < 1 || port > 65_535) {
		delete env.PORT;
	}
}

function pickEnvironment(
	env: NodeJS.ProcessEnv,
	keys: readonly string[],
): Record<string, string> {
	return Object.fromEntries(
		keys.flatMap((key) =>
			env[key] === undefined ? [] : [[key, env[key] as string]],
		),
	);
}

function isolateDirectTestDatabase(env: NodeJS.ProcessEnv) {
	if (env.NODE_ENV !== "test" || env.NIGHTWORKERS_E2E_ISOLATED === "1") return;

	const databasePath = env.NIGHTWORKERS_VITEST_DB_PATH?.trim();
	if (databasePath) {
		env.DATABASE_URL = `file:${databasePath}`;
		return;
	}

	const testRoot = fs.mkdtempSync(
		path.join(os.tmpdir(), "nightworkers-bun-test-"),
	);
	const isolatedDatabasePath = path.join(testRoot, "sqlite.db");
	env.NIGHTWORKERS_VITEST_DB_PATH = isolatedDatabasePath;
	env.DATABASE_URL = `file:${isolatedDatabasePath}`;
	process.once("exit", () =>
		fs.rmSync(testRoot, { recursive: true, force: true }),
	);
}

const envSchema = z
	.object({
		NODE_ENV: z
			.enum(["development", "production", "test"])
			.default("development"),
		PORT: z.coerce.number().default(39173),
		HOST: z.string().trim().min(1).default("127.0.0.1"),
		NIGHTWORKERS_DESKTOP: z.enum(["1", "true", "0", "false"]).optional(),
		NIGHTWORKERS_RUNTIME_DIR: z.string().trim().optional(),
		NIGHTWORKERS_RESOURCE_DIR: z.string().trim().optional(),
		NIGHTWORKERS_API_ORIGIN: z.string().url().optional(),
		NIGHTWORKERS_CODEX_MCP_URL: z.string().url().optional(),
		DATABASE_URL: z.string().optional(),
		CORS_ORIGIN: z.string().default("http://localhost:39174"),
		LOG_LEVEL: z.string().default("info"),
	})
	.superRefine((env, ctx) => {
		const desktopMode =
			env.NIGHTWORKERS_DESKTOP === "1" || env.NIGHTWORKERS_DESKTOP === "true";
		if (!env.DATABASE_URL) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["DATABASE_URL"],
				message: desktopMode
					? "DATABASE_URL should be generated during desktop runtime bootstrap."
					: "DATABASE_URL is required.",
			});
		}
		if (!isLoopbackHost(env.HOST)) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["HOST"],
				message:
					"NightWorkers is local-only. HOST must resolve to a loopback address (127.0.0.0/8, localhost, or ::1).",
			});
		}
	});

const result = envSchema.safeParse(process.env);
if (!result.success) {
	console.error("❌ Invalid environment variables:");
	console.error(result.error.format());
	process.exit(1);
}

const corsOrigins = result.data.CORS_ORIGIN.split(",")
	.map((origin) => origin.trim())
	.filter((origin) => origin.length > 0);

if (corsOrigins.length === 0 || corsOrigins.includes("*")) {
	console.error(
		"❌ Invalid CORS_ORIGIN: wildcard (*) is not allowed. Use explicit origin list.",
	);
	process.exit(1);
}

const databaseUrl = result.data.DATABASE_URL;

if (!databaseUrl) {
	console.error("❌ Invalid environment variables: DATABASE_URL is required.");
	process.exit(1);
}

export const config = {
	...result.data,
	DATABASE_URL: databaseUrl,
	DATABASE_ACCESS: databaseAccess,
	CORS_ORIGINS: corsOrigins,
};
