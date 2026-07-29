type Query = {
	all: (...params: unknown[]) => unknown;
	get: (...params: unknown[]) => unknown;
	run: (...params: unknown[]) => unknown;
};

export type SyncSqliteDatabase = {
	exec: (sql: string) => void;
	all: (sql: string, params?: unknown[]) => unknown;
	get: (sql: string, params?: unknown[]) => unknown;
	run: (sql: string, params?: unknown[]) => unknown;
	transaction: <T>(callback: () => T) => () => T;
	pragma: (sql: string) => void;
	close: () => void;
};

type DatabaseConstructor = new (
	databasePath: string,
	options?: Record<string, unknown>,
) => {
	exec?: (sql: string) => void;
	query?: (sql: string) => Query;
	prepare?: (sql: string) => Query;
	transaction?: <T>(callback: () => T) => () => T;
	pragma?: (sql: string) => unknown;
	close: () => void;
};

type SqliteModule = {
	Database?: DatabaseConstructor;
	default?: DatabaseConstructor;
};
const runtimeRequire = createRequire(import.meta.url);
const sqliteSpecifier = "libsql";
const sqliteModule = runtimeRequire(sqliteSpecifier) as SqliteModule;
const DatabaseConstructor = (
	typeof sqliteModule === "function"
		? sqliteModule
		: (sqliteModule.Database ?? sqliteModule.default)
) as DatabaseConstructor;

export function openSyncSqlite(
	databasePath: string,
	options: { readonly?: boolean; timeout?: number } = {},
): SyncSqliteDatabase {
	const database = new DatabaseConstructor(databasePath, options);
	const query = (sql: string): Query => {
		if (database.query) return database.query(sql);
		if (database.prepare) return database.prepare(sql);
		throw new Error("SQLite runtime does not provide a query API");
	};
	return {
		exec: (sql) => {
			if (!database.exec)
				throw new Error("SQLite runtime does not provide exec");
			database.exec(sql);
		},
		all: (sql, params = []) => query(sql).all(...params),
		get: (sql, params = []) => query(sql).get(...params),
		run: (sql, params = []) => query(sql).run(...params),
		transaction: (callback) => {
			if (!database.transaction)
				throw new Error("SQLite runtime does not provide transactions");
			return database.transaction(callback);
		},
		pragma: (sql) => {
			if (database.pragma) database.pragma(sql);
			else if (database.exec) database.exec(`PRAGMA ${sql}`);
		},
		close: () => database.close(),
	};
}

import { createRequire } from "node:module";
