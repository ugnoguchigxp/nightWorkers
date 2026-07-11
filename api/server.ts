import { serve } from "@hono/node-server";
import app, { nodeWebSocket } from "./app";
import { config } from "./config";
import { ensureNightWorkersSchema } from "./db/bootstrap";
import { client } from "./db/client";
import { logEvent } from "./lib/logger";
import {
	reconcileMissionPilotStartup,
	resumeMissionPilotPlanPipelines,
	submitDueQuestionnaireDrafts,
} from "./modules/missionPilot";
import { flushActivityEventQueue } from "./modules/nightworkers/nightworkers.activity.repository";
import { reconcileImplementationQueue } from "./modules/queue/queue-management.service";
import { shutdownIsolatedTaskWorkers } from "./services/execution/worker-process-manager";
import { mcpClientManager } from "./services/mcp/mcp-client-manager";
import { nightWorkersRealtimeBroker } from "./services/realtime/nightworkers-ws";

export type NightWorkersServerOptions = {
	port?: number;
	host?: string;
	shutdownTimeoutMs?: number;
};

export type NightWorkersServerHandle = {
	port: number;
	host: string;
	origin: string;
	server: ReturnType<typeof serve>;
	close: (signal?: NodeJS.Signals | "manual") => Promise<void>;
};

const defaultShutdownTimeoutMs = 10_000;
const serverCloseCallbackGraceMs = 250;
const webSocketServerCloseGraceMs = 250;

type ServerWithCloseAllConnections = ReturnType<typeof serve> & {
	closeAllConnections?: () => void;
	closeIdleConnections?: () => void;
};

function closeHttpServer(server: ReturnType<typeof serve>) {
	return new Promise<void>((resolve, reject) => {
		let settled = false;
		const settle = (error?: Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(fallbackTimer);
			if (error) {
				reject(error);
				return;
			}
			resolve();
		};
		const fallbackTimer = setTimeout(
			() => settle(),
			serverCloseCallbackGraceMs,
		);
		server.close((error) => {
			if (error) {
				settle(error);
				return;
			}
			settle();
		});
	});
}

function closeWebSocketServer() {
	return new Promise<void>((resolve, reject) => {
		let settled = false;
		const settle = (error?: Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(fallbackTimer);
			if (error) {
				reject(error);
				return;
			}
			resolve();
		};
		const fallbackTimer = setTimeout(
			() => settle(),
			webSocketServerCloseGraceMs,
		);
		nodeWebSocket.wss.close((error) => {
			if (error) {
				settle(error);
				return;
			}
			settle();
		});
	});
}

function closeActiveWebSocketClients(
	code = 1001,
	reason = "server shutting down",
) {
	const clients = [...nodeWebSocket.wss.clients];
	for (const socket of clients) {
		if (
			socket.readyState === socket.OPEN ||
			socket.readyState === socket.CONNECTING
		) {
			socket.close(code, reason);
		}
	}
	return clients.length;
}

function collectCleanupError(
	errors: Error[],
	scope: string,
	result: PromiseSettledResult<void>,
) {
	if (result.status === "fulfilled") return;
	const reason = result.reason;
	const error = reason instanceof Error ? reason : new Error(String(reason));
	error.message = `${scope}: ${error.message}`;
	errors.push(error);
}

export async function createNightWorkersServer(
	options: NightWorkersServerOptions = {},
): Promise<NightWorkersServerHandle> {
	const port = options.port ?? config.PORT;
	const host = options.host ?? config.HOST;
	const shutdownTimeoutMs =
		options.shutdownTimeoutMs ?? defaultShutdownTimeoutMs;

	await ensureNightWorkersSchema();
	await reconcileMissionPilotStartup();
	void reconcileImplementationQueue({ apply: true, reason: "startup" }).catch(
		(error) => {
			logEvent({
				channel: "api",
				level: "error",
				message: "implementation queue startup reconciliation failed",
				meta: {
					errorMessage: error instanceof Error ? error.message : String(error),
				},
			});
		},
	);

	const server = serve({
		fetch: app.fetch,
		hostname: host,
		port,
	});
	nodeWebSocket.injectWebSocket(server);
	const missionPilotQuestionnaireTimer = setInterval(() => {
		void submitDueQuestionnaireDrafts().catch((error) => {
			logEvent({
				channel: "api",
				level: "error",
				message: "mission pilot questionnaire scheduler failed",
				meta: {
					errorMessage: error instanceof Error ? error.message : String(error),
				},
			});
		});
	}, 1_000);
	missionPilotQuestionnaireTimer.unref?.();
	const missionPilotPlanTimer = setInterval(() => {
		void resumeMissionPilotPlanPipelines().catch((error) => {
			logEvent({
				channel: "api",
				level: "error",
				message: "mission pilot plan pipeline scheduler failed",
				meta: {
					errorMessage: error instanceof Error ? error.message : String(error),
				},
			});
		});
	}, 5_000);
	missionPilotPlanTimer.unref?.();
	void resumeMissionPilotPlanPipelines({ recoverInterrupted: true }).catch(
		(error) => {
			logEvent({
				channel: "api",
				level: "error",
				message: "mission pilot startup plan recovery failed",
				meta: {
					errorMessage: error instanceof Error ? error.message : String(error),
				},
			});
		},
	);

	logEvent({
		channel: "api",
		level: "info",
		message: "server started",
		meta: { host, port },
	});

	let closed = false;
	const close = async (signal: NodeJS.Signals | "manual" = "manual") => {
		if (closed) return;
		closed = true;
		clearInterval(missionPilotQuestionnaireTimer);
		clearInterval(missionPilotPlanTimer);
		logEvent({
			channel: "api",
			level: "info",
			message: "shutting down",
			meta: { signal },
		});

		nightWorkersRealtimeBroker.closeAll();
		const activeWebSocketClients = closeActiveWebSocketClients();
		logEvent({
			channel: "ws",
			level: "info",
			message: "closing websocket server clients",
			meta: { sockets: activeWebSocketClients },
		});
		(server as ServerWithCloseAllConnections).closeIdleConnections?.();
		const httpClosePromise = closeHttpServer(server);
		const webSocketClosePromise = closeWebSocketServer();
		const forceCloseTimer = setTimeout(() => {
			logEvent({
				channel: "api",
				level: "error",
				message: "graceful shutdown timed out",
				meta: { signal, timeoutMs: shutdownTimeoutMs },
			});
			(server as ServerWithCloseAllConnections).closeAllConnections?.();
			nodeWebSocket.wss.clients.forEach((socket) => {
				socket.terminate();
			});
		}, shutdownTimeoutMs);
		forceCloseTimer.unref?.();

		try {
			const errors: Error[] = [];
			collectCleanupError(
				errors,
				"Isolated task workers shutdown",
				await Promise.allSettled([shutdownIsolatedTaskWorkers()]).then(
					([result]) => result,
				),
			);
			collectCleanupError(
				errors,
				"HTTP server close",
				await Promise.allSettled([httpClosePromise]).then(([result]) => result),
			);
			collectCleanupError(
				errors,
				"Activity event queue flush",
				await Promise.allSettled([flushActivityEventQueue()]).then(
					([result]) => result,
				),
			);
			collectCleanupError(
				errors,
				"WebSocket server close",
				await Promise.allSettled([webSocketClosePromise]).then(
					([result]) => result,
				),
			);
			collectCleanupError(
				errors,
				"MCP client disconnect",
				await Promise.allSettled([mcpClientManager.disconnectAll()]).then(
					([result]) => result,
				),
			);
			collectCleanupError(
				errors,
				"DB client close",
				await Promise.allSettled([Promise.resolve(client.close())]).then(
					([result]) => result,
				),
			);
			clearTimeout(forceCloseTimer);
			if (errors.length > 0) {
				throw new AggregateError(errors, "One or more shutdown steps failed");
			}
			logEvent({
				channel: "api",
				level: "info",
				message: "shutdown complete",
				meta: { signal },
			});
		} catch (error) {
			clearTimeout(forceCloseTimer);
			logEvent({
				channel: "api",
				level: "error",
				message: "shutdown failed",
				meta: {
					signal,
					errorMessage: error instanceof Error ? error.message : String(error),
					errors:
						error instanceof AggregateError
							? error.errors.map((item) =>
									item instanceof Error ? item.message : String(item),
								)
							: undefined,
				},
			});
			throw error;
		}
	};

	return {
		port,
		host,
		origin: `http://${host}:${port}`,
		server,
		close,
	};
}
