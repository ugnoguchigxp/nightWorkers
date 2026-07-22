import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { getRuntimePaths } from "../runtime/paths";

loadEnv({ quiet: true });

function resolveDatabasePath() {
	const databaseUrl = process.env.DATABASE_URL?.trim();
	if (!databaseUrl) {
		return getRuntimePaths(process.env).databasePath;
	}
	if (
		databaseUrl.startsWith("libsql:") ||
		databaseUrl.startsWith("http:") ||
		databaseUrl.startsWith("https:")
	) {
		throw new Error(
			`db:reset only supports local SQLite files. Received DATABASE_URL=${databaseUrl}`,
		);
	}
	const rawPath = databaseUrl.startsWith("file:")
		? databaseUrl.slice("file:".length)
		: databaseUrl;
	return path.resolve(process.cwd(), rawPath);
}

function removeIfExists(targetPath: string) {
	if (!existsSync(targetPath)) return;
	rmSync(targetPath, { force: true });
}

function deleteDatabaseFiles(databasePath: string) {
	removeIfExists(databasePath);
	removeIfExists(`${databasePath}-wal`);
	removeIfExists(`${databasePath}-shm`);
}

function clearBootstrapRows(databasePath: string) {
	execFileSync("sqlite3", [databasePath], {
		stdio: "inherit",
		input: [
			"DELETE FROM implementation_queue_settings;",
			"DELETE FROM todo_workflow_settings;",
		].join("\n"),
	});
}

async function main() {
	const databasePath = resolveDatabasePath();
	deleteDatabaseFiles(databasePath);
	const [{ ensureNightWorkersSchema }, { client }] = await Promise.all([
		import("../db/bootstrap"),
		import("../db/client"),
	]);
	await ensureNightWorkersSchema();
	await Promise.resolve(client.close());
	clearBootstrapRows(databasePath);
	console.log(`Reset local SQLite DB: ${databasePath}`);
}

void main();
