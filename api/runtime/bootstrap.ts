import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { openSyncSqlite } from "../db/sync-sqlite";
import { getRuntimePaths, isDesktopMode } from "./paths";

const JWT_SECRET_BYTES = 48;

type DesktopRuntimeBootstrapOptions = {
	preserveConfiguredDatabaseUrl?: boolean;
};

function mergeCorsOrigins(
	defaultOrigins: string[],
	configuredOrigins?: string,
) {
	const origins = [
		...defaultOrigins,
		...(configuredOrigins || "")
			.split(",")
			.map((origin) => origin.trim())
			.filter((origin) => origin.length > 0),
	];
	return [...new Set(origins)].join(",");
}

export function ensureDesktopRuntimeBootstrap(
	env: NodeJS.ProcessEnv = process.env,
	options: DesktopRuntimeBootstrapOptions = {},
) {
	if (!isDesktopMode(env)) return;

	const paths = getRuntimePaths(env);
	for (const dir of [
		paths.runtimeRoot,
		paths.settingsDir,
		paths.logsDir,
		paths.secretsDir,
		paths.artifactsDir,
		paths.backupsDir,
	]) {
		fs.mkdirSync(dir, { recursive: true });
	}

	const preserveConfiguredDatabaseUrl =
		options.preserveConfiguredDatabaseUrl ?? true;
	if (!preserveConfiguredDatabaseUrl || !env.DATABASE_URL?.trim()) {
		env.DATABASE_URL = `file:${paths.databasePath}`;
	}
	if (
		!env.AUTH_MODE ||
		((env.AUTH_MODE === "both" || env.AUTH_MODE === "oauth") &&
			!env.GOOGLE_CLIENT_ID &&
			!env.GITHUB_CLIENT_ID)
	) {
		env.AUTH_MODE = "local";
	}
	env.API_AUTH_REQUIRED ||= "false";

	const apiOrigin =
		env.NIGHTWORKERS_API_ORIGIN || `http://127.0.0.1:${env.PORT || 39173}`;
	env.APP_URL = apiOrigin;
	env.CORS_ORIGIN = mergeCorsOrigins(
		[apiOrigin, "http://tauri.localhost", "tauri://localhost"],
		env.CORS_ORIGIN,
	);

	if (!env.JWT_SECRET) {
		const secretPath = `${paths.secretsDir}/jwt-secret`;
		if (fs.existsSync(secretPath)) {
			env.JWT_SECRET = fs.readFileSync(secretPath, "utf-8").trim();
		} else {
			const secret = crypto.randomBytes(JWT_SECRET_BYTES).toString("base64url");
			fs.writeFileSync(secretPath, `${secret}\n`, {
				encoding: "utf-8",
				mode: 0o600,
			});
			env.JWT_SECRET = secret;
		}
	}
}

export function ensureRuntimeDatabasePath(
	env: NodeJS.ProcessEnv = process.env,
	options: { legacyDatabaseUrl?: string } = {},
) {
	if (
		env.NODE_ENV === "test" ||
		env.NIGHTWORKERS_E2E_ISOLATED === "1" ||
		env.NIGHTWORKERS_VITEST_DB_PATH?.trim()
	) {
		return;
	}
	const paths = getRuntimePaths(env);
	fs.mkdirSync(paths.runtimeRoot, { recursive: true, mode: 0o700 });
	const legacyPath = localDatabasePath(
		options.legacyDatabaseUrl ?? env.DATABASE_URL,
	);
	if (
		legacyPath &&
		path.resolve(legacyPath) !== path.resolve(paths.databasePath) &&
		fs.existsSync(legacyPath) &&
		!fs.existsSync(paths.databasePath)
	) {
		const backupPath = path.join(
			paths.backupsDir,
			`pre-migration-${new Date().toISOString().replaceAll(/[:.]/g, "-")}.sqlite`,
		);
		backupSqliteDatabase(legacyPath, backupPath);
		backupSqliteDatabase(legacyPath, paths.databasePath);
		fs.chmodSync(paths.databasePath, 0o600);
	}
	env.DATABASE_URL = `file:${paths.databasePath}`;
}

export function createRuntimeDatabaseBackup(
	env: NodeJS.ProcessEnv = process.env,
): string | null {
	if (env.NODE_ENV === "test" || env.NIGHTWORKERS_E2E_ISOLATED === "1")
		return null;
	const paths = getRuntimePaths(env);
	if (!fs.existsSync(paths.databasePath)) return null;
	fs.mkdirSync(paths.backupsDir, { recursive: true, mode: 0o700 });
	const backupPath = path.join(
		paths.backupsDir,
		`startup-${new Date().toISOString().replaceAll(/[:.]/g, "-")}.sqlite`,
	);
	backupSqliteDatabase(paths.databasePath, backupPath);
	const backups = fs
		.readdirSync(paths.backupsDir)
		.filter((name) => name.endsWith(".sqlite"))
		.sort()
		.reverse();
	for (const stale of backups.slice(5)) {
		fs.rmSync(path.join(paths.backupsDir, stale), { force: true });
	}
	return backupPath;
}

function backupSqliteDatabase(sourcePath: string, destinationPath: string) {
	fs.mkdirSync(path.dirname(destinationPath), { recursive: true, mode: 0o700 });
	const database = openSyncSqlite(sourcePath, {
		readonly: true,
		timeout: 10_000,
	});
	try {
		const escapedDestination = destinationPath.replaceAll("'", "''");
		database.exec(`VACUUM INTO '${escapedDestination}'`);
	} finally {
		database.close();
	}
	fs.chmodSync(destinationPath, 0o600);
}

function localDatabasePath(databaseUrl?: string) {
	const value = databaseUrl?.trim();
	if (!value) return null;
	if (value.startsWith("file:")) return value.slice("file:".length);
	if (value.includes(":")) return null;
	return value;
}
