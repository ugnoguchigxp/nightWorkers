import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
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

function ensureSettingsTables() {
	const target = databasePath();
	fs.mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
	execFileSync("sqlite3", [target], {
		input: `
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
  `,
	});
}

function sqlString(value: string) {
	return `'${value.replaceAll("'", "''")}'`;
}

function readJsonRow(table: string, scope: ApplicationSettingsScope) {
	ensureSettingsTables();
	return execFileSync(
		"sqlite3",
		[
			databasePath(),
			`SELECT value_json FROM ${table} WHERE scope = ${sqlString(scope)}`,
		],
		{ encoding: "utf8" },
	).trim();
}

function writeJsonRow(
	table: string,
	scope: ApplicationSettingsScope,
	value: unknown,
) {
	ensureSettingsTables();
	const now = Math.floor(Date.now() / 1000);
	execFileSync("sqlite3", [databasePath()], {
		input: `
      BEGIN IMMEDIATE;
      INSERT INTO ${table} (scope, value_json, revision, created_at, updated_at)
      VALUES (${sqlString(scope)}, ${sqlString(JSON.stringify(value))}, 1, ${now}, ${now})
      ON CONFLICT(scope) DO UPDATE SET
        value_json = excluded.value_json,
        revision = ${table}.revision + 1,
        updated_at = excluded.updated_at;
      COMMIT;
    `,
	});
}

export function readApplicationSetting<T>(
	scope: ApplicationSettingsScope,
): T | null {
	try {
		const value = readJsonRow("application_settings", scope);
		return value ? (JSON.parse(value) as T) : null;
	} catch {
		return null;
	}
}

export function writeApplicationSetting<T>(
	scope: ApplicationSettingsScope,
	value: T,
): T {
	writeJsonRow("application_settings", scope, value);
	return value;
}

export function readApplicationSettingSecrets<T>(
	scope: ApplicationSettingsScope,
): T | null {
	try {
		const value = readJsonRow("application_setting_secrets", scope);
		return value ? (JSON.parse(value) as T) : null;
	} catch {
		return null;
	}
}

export function writeApplicationSettingSecrets<T>(
	scope: ApplicationSettingsScope,
	value: T,
): T {
	writeJsonRow("application_setting_secrets", scope, value);
	return value;
}

export function archiveLegacySettingsFile(filePath: string) {
	if (process.env.NODE_ENV === "test" || !fs.existsSync(filePath)) return;
	const stat = fs.statSync(filePath);
	const archivedPath = `${filePath}.migrated-${Date.now()}.json`;
	fs.renameSync(filePath, archivedPath);
	const now = Math.floor(Date.now() / 1000);
	ensureSettingsTables();
	execFileSync("sqlite3", [databasePath()], {
		input: `INSERT OR REPLACE INTO application_setting_migrations
      (source, source_fingerprint, imported_at, completed_at, result_json)
      VALUES (
        ${sqlString(filePath)},
        ${sqlString(`${stat.size}:${stat.mtimeMs}`)},
        ${now},
        ${now},
        ${sqlString(JSON.stringify({ archivedPath }))}
      );`,
	});
}
