import { config } from "./config";
import { logEvent } from "./lib/logger";
import { createNightWorkersServer } from "./server";

const shutdownTimeoutMs = 10_000;
const forceExitTimeoutMs = shutdownTimeoutMs + 2_000;

let shuttingDown = false;
let server: Awaited<ReturnType<typeof createNightWorkersServer>> | null = null;

const shutdown = async (signal: NodeJS.Signals) => {
	if (shuttingDown) return;
	shuttingDown = true;
	if (!server) {
		process.exit(0);
	}

	const forceExitTimer = setTimeout(() => {
		logEvent({
			channel: "api",
			level: "error",
			message: "graceful shutdown timed out",
			meta: { signal, timeoutMs: forceExitTimeoutMs },
		});
		process.exit(1);
	}, forceExitTimeoutMs);
	forceExitTimer.unref?.();

	try {
		await server.close(signal);
		clearTimeout(forceExitTimer);
		process.exit(0);
	} catch (error) {
		clearTimeout(forceExitTimer);
		logEvent({
			channel: "api",
			level: "error",
			message: "shutdown failed",
			meta: {
				signal,
				errorMessage: error instanceof Error ? error.message : String(error),
			},
		});
		process.exit(1);
	}
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

async function main() {
	logEvent({
		channel: "api",
		level: "info",
		message: "database access resolved",
		meta: {
			scope: config.DATABASE_ACCESS.scope,
			runId: config.DATABASE_ACCESS.runId,
			databasePath: config.DATABASE_ACCESS.databasePath,
		},
	});
	server = await createNightWorkersServer({
		port: config.PORT,
		shutdownTimeoutMs,
	});
}

void main().catch((error) => {
	logEvent({
		channel: "api",
		level: "error",
		message: "server startup failed",
		meta: {
			errorMessage: error instanceof Error ? error.message : String(error),
		},
	});
	process.exit(1);
});
