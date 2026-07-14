import fs from "node:fs";
import path from "node:path";
import { openSyncSqlite, type SyncSqliteDatabase } from "../../db/sync-sqlite";
import { getRuntimePaths } from "../../runtime/paths";

export type ApplicationSettingsScope =
	| "general"
	| "fx-cache"
	| "llm"
	| "mcp"
	| "agent-hooks"
	| "server"
	| "auth"
	| "runtime"
	| "integrations";

function databasePath() {
	const url =
		process.env.DATABASE_URL || `file:${getRuntimePaths().databasePath}`;
	return url.startsWith("file:") ? url.slice("file:".length) : url;
}

function withDatabase<T>(operation: (database: SyncSqliteDatabase) => T): T {
	const target = databasePath();
	fs.mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
	const database = openSyncSqlite(target, { timeout: 10_000 });
	try {
		database.pragma("busy_timeout = 10000");
		database.exec(`
			CREATE TABLE IF NOT EXISTS application_settings (
				scope TEXT PRIMARY KEY NOT NULL,
				value_json TEXT NOT NULL,
				revision INTEGER NOT NULL DEFAULT 1,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			);
			CREATE TABLE IF NOT EXISTS application_setting_secrets (
				scope TEXT PRIMARY KEY NOT NULL,
				value_json TEXT NOT NULL,
				revision INTEGER NOT NULL DEFAULT 1,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			);
			CREATE TABLE IF NOT EXISTS application_setting_migrations (
				source TEXT PRIMARY KEY NOT NULL,
				source_fingerprint TEXT NOT NULL,
				imported_at INTEGER NOT NULL,
				completed_at INTEGER NOT NULL,
				result_json TEXT NOT NULL
			);
		`);
		return operation(database);
	} finally {
		database.close();
	}
}

function readJsonRow(table: string, scope: ApplicationSettingsScope) {
	return withDatabase((database) => {
		const row = database.get(
			`SELECT value_json FROM ${table} WHERE scope = ?`,
			[scope],
		) as { value_json?: string } | undefined;
		return row?.value_json ?? "";
	});
}

function upsertJsonRow(
	database: SyncSqliteDatabase,
	table: string,
	scope: ApplicationSettingsScope,
	value: unknown,
	now: number,
) {
	database.run(
		`
			INSERT INTO ${table} (scope, value_json, revision, created_at, updated_at)
			VALUES (?, ?, 1, ?, ?)
			ON CONFLICT(scope) DO UPDATE SET
				value_json = excluded.value_json,
				revision = ${table}.revision + 1,
				updated_at = excluded.updated_at
		`,
		[scope, JSON.stringify(value), now, now],
	);
}

export function readApplicationSetting<T>(
	scope: ApplicationSettingsScope,
): T | null {
	const value = readJsonRow("application_settings", scope);
	return value ? (JSON.parse(value) as T) : null;
}

export function writeApplicationSetting<T>(
	scope: ApplicationSettingsScope,
	value: T,
): T {
	withDatabase((database) => {
		const now = Math.floor(Date.now() / 1000);
		database.transaction(() =>
			upsertJsonRow(database, "application_settings", scope, value, now),
		)();
	});
	return value;
}

export function readApplicationSettingSecrets<T>(
	scope: ApplicationSettingsScope,
): T | null {
	const value = readJsonRow("application_setting_secrets", scope);
	return value ? (JSON.parse(value) as T) : null;
}

export function writeApplicationSettingSecrets<T>(
	scope: ApplicationSettingsScope,
	value: T,
): T {
	withDatabase((database) => {
		const now = Math.floor(Date.now() / 1000);
		database.transaction(() =>
			upsertJsonRow(database, "application_setting_secrets", scope, value, now),
		)();
	});
	return value;
}

export function writeApplicationSettingBundle<TPublic, TSecrets>(
	scope: ApplicationSettingsScope,
	publicValue: TPublic,
	secretValue: TSecrets,
): { publicValue: TPublic; secretValue: TSecrets } {
	withDatabase((database) => {
		const now = Math.floor(Date.now() / 1000);
		database.transaction(() => {
			upsertJsonRow(database, "application_settings", scope, publicValue, now);
			upsertJsonRow(
				database,
				"application_setting_secrets",
				scope,
				secretValue,
				now,
			);
		})();
	});
	return { publicValue, secretValue };
}

export function archiveLegacySettingsFile(filePath: string) {
	if (process.env.NODE_ENV === "test" || !fs.existsSync(filePath)) return;
	const stat = fs.statSync(filePath);
	const archivedPath = `${filePath}.migrated-${Date.now()}.json`;
	fs.renameSync(filePath, archivedPath);
	const now = Math.floor(Date.now() / 1000);
	withDatabase((database) => {
		database.run(
			`
				INSERT OR REPLACE INTO application_setting_migrations
				(source, source_fingerprint, imported_at, completed_at, result_json)
				VALUES (?, ?, ?, ?, ?)
			`,
			[
				filePath,
				`${stat.size}:${stat.mtimeMs}`,
				now,
				now,
				JSON.stringify({ archivedPath }),
			],
		);
	});
}
