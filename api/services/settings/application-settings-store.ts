import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import type { DbTransaction } from "../../db/client";
import {
	applicationSettingMigrations,
	applicationSettingSecrets,
	applicationSettings,
} from "../../db/schema";
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

const APPLICATION_SETTINGS_SCOPES: ApplicationSettingsScope[] = [
	"general",
	"fx-cache",
	"llm",
	"mcp",
	"agent-hooks",
	"server",
	"auth",
	"runtime",
	"integrations",
];

const WORKER_SETTINGS_SNAPSHOT_ENV =
	"NIGHTWORKERS_APPLICATION_SETTINGS_SNAPSHOT";

type WorkerSettingsSnapshot = {
	public: Partial<Record<ApplicationSettingsScope, unknown>>;
	secrets: Partial<Record<ApplicationSettingsScope, unknown>>;
};

let cachedWorkerSnapshotRaw: string | undefined;
let cachedWorkerSnapshot: WorkerSettingsSnapshot | null = null;

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
	const workerSnapshot = readWorkerSnapshot();
	if (workerSnapshot) return (workerSnapshot.secrets[scope] as T) ?? null;
	const value = readJsonRow("application_setting_secrets", scope);
	return value ? (JSON.parse(value) as T) : null;
}

export function createApplicationSettingsWorkerSnapshot() {
	if (process.env.NIGHTWORKERS_EXECUTION_ROLE === "worker")
		throw new Error("A worker cannot create the canonical settings snapshot");
	const snapshot: WorkerSettingsSnapshot = { public: {}, secrets: {} };
	for (const scope of APPLICATION_SETTINGS_SCOPES) {
		const publicValue = readApplicationSetting(scope);
		const secretValue = readApplicationSettingSecrets(scope);
		if (publicValue !== null) snapshot.public[scope] = publicValue;
		if (secretValue !== null) snapshot.secrets[scope] = secretValue;
	}
	return JSON.stringify(snapshot);
}

function readWorkerSnapshot(): WorkerSettingsSnapshot | null {
	if (process.env.NIGHTWORKERS_EXECUTION_ROLE !== "worker") return null;
	const raw = process.env[WORKER_SETTINGS_SNAPSHOT_ENV];
	if (!raw) return { public: {}, secrets: {} };
	if (raw === cachedWorkerSnapshotRaw && cachedWorkerSnapshot)
		return cachedWorkerSnapshot;
	cachedWorkerSnapshotRaw = raw;
	cachedWorkerSnapshot = JSON.parse(raw) as WorkerSettingsSnapshot;
	return cachedWorkerSnapshot;
}

export async function writeApplicationSettingSecrets<T>(
	scope: ApplicationSettingsScope,
	value: T,
): Promise<T> {
	await writeSettingsTransaction((tx) =>
		tx
			.insert(applicationSettingSecrets)
			.values({ scope, valueJson: value as Record<string, unknown> })
			.onConflictDoUpdate({
				target: applicationSettingSecrets.scope,
				set: {
					valueJson: value as Record<string, unknown>,
					revision: sql`${applicationSettingSecrets.revision} + 1`,
					updatedAt: new Date(),
				},
			})
			.returning(),
	);
	return value;
}

export async function writeApplicationSettingBundle<TPublic, TSecrets>(
	scope: ApplicationSettingsScope,
	publicValue: TPublic,
	secretValue: TSecrets,
): Promise<{ publicValue: TPublic; secretValue: TSecrets }> {
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
			.insert(applicationSettingSecrets)
			.values({ scope, valueJson: secretValue as Record<string, unknown> })
			.onConflictDoUpdate({
				target: applicationSettingSecrets.scope,
				set: {
					valueJson: secretValue as Record<string, unknown>,
					revision: sql`${applicationSettingSecrets.revision} + 1`,
					updatedAt: new Date(),
				},
			});
	});
	return { publicValue, secretValue };
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
