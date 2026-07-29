import fs from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import type { DbTransaction } from "../../db/client";
import {
	applicationSettingMigrations,
	applicationSettingSecrets,
	applicationSettings,
} from "../../db/schema";
import { openSyncSqlite, type SyncSqliteDatabase } from "../../db/sync-sqlite";
import { getRuntimePaths } from "../../runtime/paths";
import {
	readSecretStoreValue,
	writeSecretStoreValue,
} from "../security/os-secret-store";

export type ApplicationSettingsScope =
	| "general"
	| "fx-cache"
	| "llm"
	| "mcp"
	| "agent-hooks"
	| "server"
	| "runtime"
	| "integrations";

const APPLICATION_SETTINGS_SCOPES: ApplicationSettingsScope[] = [
	"general",
	"fx-cache",
	"llm",
	"mcp",
	"agent-hooks",
	"server",
	"runtime",
	"integrations",
];

const WORKER_SETTINGS_SNAPSHOT_ENV =
	"NIGHTWORKERS_APPLICATION_SETTINGS_SNAPSHOT";

type WorkerSettingsSnapshot = {
	public: Partial<Record<ApplicationSettingsScope, unknown>>;
};

let cachedWorkerSnapshot: WorkerSettingsSnapshot | null = null;
let cachedApplicationSettingSecretValues: string[] | null = null;

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
		return operation(database);
	} finally {
		database.close();
	}
}

function readJsonRow(table: string, scope: ApplicationSettingsScope) {
	try {
		return withDatabase((database) => {
			const row = database.get(
				`SELECT value_json FROM ${table} WHERE scope = ?`,
				[scope],
			) as { value_json?: string } | undefined;
			return row?.value_json ?? "";
		});
	} catch (error) {
		if (String(error).includes("no such table")) return "";
		throw error;
	}
}

async function writeSettingsTransaction<T>(
	callback: (tx: DbTransaction) => Promise<T>,
): Promise<T> {
	const { db } = await import("../../db/client");
	return db.transaction(callback);
}

export function readApplicationSetting<T>(
	scope: ApplicationSettingsScope,
): T | null {
	const workerSnapshot = readWorkerSnapshot();
	if (workerSnapshot) return (workerSnapshot.public[scope] as T) ?? null;
	const value = readJsonRow("application_settings", scope);
	return value ? (JSON.parse(value) as T) : null;
}

export async function writeApplicationSetting<T>(
	scope: ApplicationSettingsScope,
	value: T,
): Promise<T> {
	await writeSettingsTransaction((tx) =>
		tx
			.insert(applicationSettings)
			.values({ scope, valueJson: value as Record<string, unknown> })
			.onConflictDoUpdate({
				target: applicationSettings.scope,
				set: {
					valueJson: value as Record<string, unknown>,
					revision: sql`${applicationSettings.revision} + 1`,
					updatedAt: new Date(),
				},
			})
			.returning(),
	);
	return value;
}

export function readApplicationSettingSecrets<T>(
	scope: ApplicationSettingsScope,
): T | null {
	const value = readSecretStoreValue(secretAccount(scope));
	return value ? (JSON.parse(value) as T) : null;
}

export function createApplicationSettingsWorkerSnapshot() {
	if (process.env.NIGHTWORKERS_EXECUTION_ROLE === "worker")
		throw new Error("A worker cannot create the canonical settings snapshot");
	const snapshot: WorkerSettingsSnapshot = { public: {} };
	for (const scope of APPLICATION_SETTINGS_SCOPES) {
		const publicValue = readApplicationSetting(scope);
		if (publicValue !== null) snapshot.public[scope] = publicValue;
	}
	return JSON.stringify(snapshot);
}

export function consumeApplicationSettingsWorkerSnapshot() {
	if (process.env.NIGHTWORKERS_EXECUTION_ROLE !== "worker") return;
	readWorkerSnapshot();
}

function readWorkerSnapshot(): WorkerSettingsSnapshot | null {
	if (process.env.NIGHTWORKERS_EXECUTION_ROLE !== "worker") return null;
	if (cachedWorkerSnapshot) return cachedWorkerSnapshot;
	const raw = process.env[WORKER_SETTINGS_SNAPSHOT_ENV];
	delete process.env[WORKER_SETTINGS_SNAPSHOT_ENV];
	if (!raw) {
		cachedWorkerSnapshot = { public: {} };
		return cachedWorkerSnapshot;
	}
	cachedWorkerSnapshot = JSON.parse(raw) as WorkerSettingsSnapshot;
	return cachedWorkerSnapshot;
}

export async function writeApplicationSettingSecrets<T>(
	scope: ApplicationSettingsScope,
	value: T,
): Promise<T> {
	writeSecretStoreValue(secretAccount(scope), JSON.stringify(value));
	cachedApplicationSettingSecretValues = null;
	await writeSettingsTransaction((tx) =>
		tx
			.delete(applicationSettingSecrets)
			.where(eq(applicationSettingSecrets.scope, scope)),
	);
	return value;
}

export async function writeApplicationSettingBundle<TPublic, TSecrets>(
	scope: ApplicationSettingsScope,
	publicValue: TPublic,
	secretValue: TSecrets,
): Promise<{ publicValue: TPublic; secretValue: TSecrets }> {
	writeSecretStoreValue(secretAccount(scope), JSON.stringify(secretValue));
	cachedApplicationSettingSecretValues = null;
	await writeSettingsTransaction(async (tx) => {
		await tx
			.insert(applicationSettings)
			.values({ scope, valueJson: publicValue as Record<string, unknown> })
			.onConflictDoUpdate({
				target: applicationSettings.scope,
				set: {
					valueJson: publicValue as Record<string, unknown>,
					revision: sql`${applicationSettings.revision} + 1`,
					updatedAt: new Date(),
				},
			});
		await tx
			.delete(applicationSettingSecrets)
			.where(eq(applicationSettingSecrets.scope, scope));
	});
	return { publicValue, secretValue };
}

export function migrateLegacyApplicationSettingSecrets() {
	const migratedScopes: ApplicationSettingsScope[] = [];
	withDatabase((database) => {
		let rows: Array<{ scope: string; value_json: string }>;
		try {
			rows = database.all(
				"SELECT scope, value_json FROM application_setting_secrets",
			) as Array<{ scope: string; value_json: string }>;
		} catch (error) {
			if (String(error).includes("no such table")) return;
			throw error;
		}
		for (const row of rows) {
			if (!APPLICATION_SETTINGS_SCOPES.includes(row.scope as never)) continue;
			writeSecretStoreValue(secretAccount(row.scope), row.value_json);
			database.run("DELETE FROM application_setting_secrets WHERE scope = ?", [
				row.scope,
			]);
			migratedScopes.push(row.scope as ApplicationSettingsScope);
		}
		if (migratedScopes.length > 0) {
			database.pragma("wal_checkpoint(TRUNCATE)");
			database.exec("VACUUM");
			database.pragma("wal_checkpoint(TRUNCATE)");
		}
	});
	if (migratedScopes.length > 0) cachedApplicationSettingSecretValues = null;
	return migratedScopes;
}

export function collectApplicationSettingSecretValues() {
	if (cachedApplicationSettingSecretValues)
		return [...cachedApplicationSettingSecretValues];
	const values: string[] = [];
	for (const scope of APPLICATION_SETTINGS_SCOPES) {
		const raw = readSecretStoreValue(secretAccount(scope));
		if (!raw) continue;
		try {
			collectStrings(JSON.parse(raw), values);
		} catch {
			values.push(raw);
		}
	}
	cachedApplicationSettingSecretValues = values;
	return [...values];
}

function collectStrings(value: unknown, target: string[]) {
	if (typeof value === "string") {
		target.push(value);
		return;
	}
	if (!value || typeof value !== "object") return;
	for (const entry of Array.isArray(value) ? value : Object.values(value)) {
		collectStrings(entry, target);
	}
}

function secretAccount(scope: string) {
	return `application-settings/${scope}`;
}

export async function archiveLegacySettingsFile(filePath: string) {
	if (process.env.NODE_ENV === "test" || !fs.existsSync(filePath)) return;
	const stat = fs.statSync(filePath);
	const archivedPath = `${filePath}.migrated-${Date.now()}.json`;
	fs.renameSync(filePath, archivedPath);
	const now = Math.floor(Date.now() / 1000);
	await writeSettingsTransaction((tx) =>
		tx.insert(applicationSettingMigrations).values({
			source: filePath,
			sourceFingerprint: `${stat.size}:${stat.mtimeMs}`,
			importedAt: new Date(now * 1000),
			completedAt: new Date(now * 1000),
			resultJson: { archivedPath },
		}),
	);
}
