import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { ensureNightWorkersSchema } from "../db/bootstrap";
import { client } from "../db/client";

loadEnv({ quiet: true });

const SNAPSHOT_RELATIVE_PATH = "drizzle/seeds/current-state.sql";
const PRESERVE_TABLES = new Set(["__drizzle_migrations"]);

async function listExistingTables() {
	const result = await client.execute(
		"SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
	);
	return new Set(
		result.rows
			.map((row) => (typeof row.name === "string" ? row.name : null))
			.filter((name): name is string => Boolean(name)),
	);
}

function resolveDatabasePath() {
	const databaseUrl = process.env.DATABASE_URL?.trim();
	if (!databaseUrl) {
		throw new Error("DATABASE_URL is required");
	}
	if (
		databaseUrl.startsWith("libsql:") ||
		databaseUrl.startsWith("http:") ||
		databaseUrl.startsWith("https:")
	) {
		throw new Error(
			`db:seed:current only supports local SQLite files. Received DATABASE_URL=${databaseUrl}`,
		);
	}
	const rawPath = databaseUrl.startsWith("file:")
		? databaseUrl.slice("file:".length)
		: databaseUrl;
	return path.resolve(process.cwd(), rawPath);
}

function buildSeedSql(existingTables: Set<string>) {
	const snapshotPath = path.resolve(process.cwd(), SNAPSHOT_RELATIVE_PATH);
	const snapshotSql = readFileSync(snapshotPath, "utf8");
	const deleteSql = [...existingTables]
		.filter((table) => !PRESERVE_TABLES.has(table))
		.sort()
		.map((table) => `DELETE FROM ${table};`)
		.join("\n");
	return [
		".timeout 10000",
		"PRAGMA foreign_keys=OFF;",
		"BEGIN;",
		deleteSql,
		snapshotSql,
		"COMMIT;",
		"PRAGMA foreign_keys=ON;",
		"PRAGMA foreign_key_check;",
	].join("\n");
}

async function main() {
	const databasePath = resolveDatabasePath();
	await ensureNightWorkersSchema();
	const existingTables = await listExistingTables();
	await Promise.resolve(client.close());
	const sql = buildSeedSql(existingTables);
	const output = execFileSync("sqlite3", [databasePath], {
		input: sql,
		encoding: "utf8",
	}).trim();

	if (output.length > 0) {
		throw new Error(`Foreign key check failed:\n${output}`);
	}

	console.log(`Restored current DB snapshot into ${databasePath}`);
}

void main();
