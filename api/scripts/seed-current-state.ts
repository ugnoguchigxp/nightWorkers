import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { ensureNightWorkersSchema } from "../db/bootstrap";
import { client } from "../db/client";

loadEnv({ quiet: true });

const DEFAULT_SNAPSHOT_NAME = "current";
const PRESERVE_TABLES = new Set(["__drizzle_migrations"]);

function resolveSnapshotName() {
	const args = process.argv.slice(2);
	if (args.length === 0) return DEFAULT_SNAPSHOT_NAME;
	if (args.length === 1) return normalizeSnapshotName(args[0]);
	if (args.length === 2 && args[0] === "--snapshot") {
		return normalizeSnapshotName(args[1]);
	}
	throw new Error(
		"Usage: bun api/scripts/seed-current-state.ts [current|cond1|...|cond8]",
	);
}

function normalizeSnapshotName(name: string) {
	if (name === "current" || /^cond[1-8]$/.test(name)) return name;
	throw new Error(
		`Unknown DB snapshot "${name}". Expected current or cond1 through cond8.`,
	);
}

function resolveSnapshotPath(snapshotName: string) {
	const relativePath =
		snapshotName === "current"
			? "drizzle/seeds/current-state.sql"
			: `drizzle/seeds/conditions/${snapshotName}.sql`;
	return path.resolve(process.cwd(), relativePath);
}

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

function quoteIdentifier(identifier: string) {
	return `"${identifier.replaceAll('"', '""')}"`;
}

function buildSeedSql(existingTables: Set<string>, snapshotPath: string) {
	if (!existsSync(snapshotPath)) {
		throw new Error(`DB snapshot does not exist: ${snapshotPath}`);
	}
	const snapshotSql = readFileSync(snapshotPath, "utf8");
	const deleteSql = [...existingTables]
		.filter((table) => !PRESERVE_TABLES.has(table))
		.sort()
		.map((table) => `DELETE FROM ${quoteIdentifier(table)};`)
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
	const snapshotName = resolveSnapshotName();
	const databasePath = resolveDatabasePath();
	const snapshotPath = resolveSnapshotPath(snapshotName);
	await ensureNightWorkersSchema();
	const existingTables = await listExistingTables();
	await Promise.resolve(client.close());
	const sql = buildSeedSql(existingTables, snapshotPath);
	const output = execFileSync("sqlite3", [databasePath], {
		input: sql,
		encoding: "utf8",
	}).trim();

	if (output.length > 0) {
		throw new Error(`Foreign key check failed:\n${output}`);
	}

	console.log(
		`Restored DB snapshot "${snapshotName}" from ${snapshotPath} into ${databasePath}`,
	);
}

void main();
