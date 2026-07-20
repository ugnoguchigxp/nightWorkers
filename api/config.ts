import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { config as dotenvConfig } from "dotenv";
import { z } from "zod";
import {
	ensureDesktopRuntimeBootstrap,
	ensureRuntimeDatabasePath,
} from "./runtime/bootstrap";
import { isLoopbackHost } from "./security/listen-security";
import {
	readApplicationSetting,
	readApplicationSettingSecrets,
} from "./services/settings/application-settings-store";

dotenvConfig({ quiet: true }); // ensure env is loaded in Node.js, Bun might auto-load
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
applyPersistedBootstrapSettings(process.env);
applyDevelopmentAppUrlDefault(process.env);

function applyDevelopmentAppUrlDefault(env: NodeJS.ProcessEnv) {
	if (
		(env.NODE_ENV ?? "development") !== "development" ||
		env.APP_URL?.trim()
	) {
		return;
	}
	const port = Number(env.PORT);
	const resolvedPort =
		Number.isInteger(port) && port >= 1 && port <= 65_535 ? port : 39_173;
	env.APP_URL = `http://127.0.0.1:${resolvedPort}`;
}

function applyPersistedBootstrapSettings(env: NodeJS.ProcessEnv) {
	if (
		env.NODE_ENV === "test" ||
		env.NIGHTWORKERS_E2E_ISOLATED === "1" ||
		env.NIGHTWORKERS_CONFIG_TEST === "1" ||
		env.NIGHTWORKERS_EXECUTION_ROLE === "worker"
	) {
		return;
	}
	const serverKeys = [
		"PORT",
		"HOST",
		"APP_URL",
		"CORS_ORIGIN",
		"COOKIE_SAME_SITE",
		"TRUST_PROXY",
		"API_AUTH_REQUIRED",
		"ALLOW_INSECURE_NON_LOOPBACK",
		"LOG_LEVEL",
	] as const;
	const authKeys = [
		"AUTH_MODE",
		"JWT_ACCESS_EXPIRES_IN",
		"JWT_REFRESH_EXPIRES_IN",
		"GOOGLE_CLIENT_ID",
		"GITHUB_CLIENT_ID",
	] as const;
	const secretKeys = [
		"JWT_SECRET",
		"GOOGLE_CLIENT_SECRET",
		"GITHUB_CLIENT_SECRET",
	] as const;
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
	const persistedAuth = readApplicationSetting<Record<string, string>>("auth");
	const persistedRuntime =
		readApplicationSetting<Record<string, string>>("runtime");
	const persistedIntegrations =
		readApplicationSetting<Record<string, string>>("integrations");
	const persistedSecrets =
		readApplicationSettingSecrets<Record<string, string>>("auth");
	Object.assign(
		env,
		persisted ?? {},
		persistedAuth ?? {},
		persistedRuntime ?? {},
		persistedIntegrations ?? {},
		persistedSecrets ?? {},
	);
	normalizeListenPort(env);
	if (!env.JWT_SECRET)
		env.JWT_SECRET = crypto.randomBytes(48).toString("base64url");
	env.__NIGHTWORKERS_PERSIST_BOOTSTRAP_SETTINGS = JSON.stringify({
		server: !persisted ? pickEnvironment(env, serverKeys) : null,
		auth: !persistedAuth ? pickEnvironment(env, authKeys) : null,
		runtime: !persistedRuntime ? pickEnvironment(env, runtimeKeys) : null,
		integrations: !persistedIntegrations
			? pickEnvironment(env, integrationKeys)
			: null,
		secrets: !persistedSecrets ? pickEnvironment(env, secretKeys) : null,
	});
}

export async function persistBootstrapSettings() {
	const raw = process.env.__NIGHTWORKERS_PERSIST_BOOTSTRAP_SETTINGS;
	if (!raw) return;
	const pending = JSON.parse(raw) as Record<
		string,
		Record<string, string> | null
	>;
	const { writeApplicationSetting, writeApplicationSettingSecrets } =
		await import("./services/settings/application-settings-store");
	for (const scope of ["server", "auth", "runtime", "integrations"] as const) {
		const value = pending[scope];
		if (value) await writeApplicationSetting(scope, value);
	}
	if (pending.secrets)
		await writeApplicationSettingSecrets("auth", pending.secrets);
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
	env.DATABASE_URL = `file:${path.join(testRoot, "sqlite.db")}`;
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
		JWT_SECRET: z.string().min(32).optional(),
		JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
		JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),
		AUTH_MODE: z.enum(["local", "oauth", "both"]).default("both"),
		GOOGLE_CLIENT_ID: z.string().trim().optional(),
		GOOGLE_CLIENT_SECRET: z.string().trim().optional(),
		GITHUB_CLIENT_ID: z.string().trim().optional(),
		GITHUB_CLIENT_SECRET: z.string().trim().optional(),
		APP_URL: z.string().url().optional(),
		CORS_ORIGIN: z.string().default("http://localhost:39174"),
		COOKIE_SAME_SITE: z.enum(["lax", "strict", "none"]).default("lax"),
		TRUST_PROXY: z
			.enum(["true", "false"])
			.default("false")
			.transform((value) => value === "true"),
		API_AUTH_REQUIRED: z
			.enum(["true", "false"])
			.optional()
			.transform((value) =>
				value === undefined ? undefined : value === "true",
			),
		ALLOW_INSECURE_NON_LOOPBACK: z
			.enum(["true", "false"])
			.default("false")
			.transform((value) => value === "true"),
		SUPERVISOR_REFERENCES_DIR: z.string().trim().optional(),
		SUPERVISOR_SKILLS_DIR: z.string().trim().optional(),
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
		if (!env.JWT_SECRET) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["JWT_SECRET"],
				message: desktopMode
					? "JWT_SECRET should be generated during desktop runtime bootstrap."
					: "JWT_SECRET is required.",
			});
		}
		if (
			env.NODE_ENV === "production" &&
			!isLoopbackHost(env.HOST) &&
			!(env.API_AUTH_REQUIRED ?? false)
		) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["API_AUTH_REQUIRED"],
				message:
					"Non-loopback production binding requires API_AUTH_REQUIRED=true. Bind HOST to 127.0.0.1/::1 or enable authentication.",
			});
		}

		const hasGoogleId = Boolean(env.GOOGLE_CLIENT_ID);
		const hasGoogleSecret = Boolean(env.GOOGLE_CLIENT_SECRET);
		const hasGithubId = Boolean(env.GITHUB_CLIENT_ID);
		const hasGithubSecret = Boolean(env.GITHUB_CLIENT_SECRET);

		if (hasGoogleId !== hasGoogleSecret) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: [hasGoogleId ? "GOOGLE_CLIENT_SECRET" : "GOOGLE_CLIENT_ID"],
				message: "Set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET together.",
			});
		}

		if (hasGithubId !== hasGithubSecret) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: [hasGithubId ? "GITHUB_CLIENT_SECRET" : "GITHUB_CLIENT_ID"],
				message: "Set both GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET together.",
			});
		}

		const oauthProviderCount =
			Number(hasGoogleId && hasGoogleSecret) +
			Number(hasGithubId && hasGithubSecret);
		const oauthEnabled = env.AUTH_MODE === "oauth" || env.AUTH_MODE === "both";

		if (oauthEnabled && !env.APP_URL) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["APP_URL"],
				message: "APP_URL is required when AUTH_MODE is oauth or both.",
			});
		}

		if (env.AUTH_MODE === "oauth" && oauthProviderCount === 0) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["AUTH_MODE"],
				message:
					"AUTH_MODE is oauth, but no OAuth provider is configured. Set Google or GitHub client ID/secret.",
			});
		}

		const secureCookie =
			env.NODE_ENV === "production" ||
			Boolean(env.APP_URL?.toLowerCase().startsWith("https://"));
		if (env.COOKIE_SAME_SITE === "none" && !secureCookie) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["COOKIE_SAME_SITE"],
				message:
					"COOKIE_SAME_SITE=none requires secure cookies. Use HTTPS APP_URL or set NODE_ENV=production.",
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
const jwtSecret = result.data.JWT_SECRET;

if (!databaseUrl || !jwtSecret) {
	console.error(
		"❌ Invalid environment variables: DATABASE_URL and JWT_SECRET are required.",
	);
	process.exit(1);
}

export const config = {
	...result.data,
	DATABASE_URL: databaseUrl,
	JWT_SECRET: jwtSecret,
	API_AUTH_REQUIRED: result.data.API_AUTH_REQUIRED ?? false,
	CORS_ORIGINS: corsOrigins,
};
