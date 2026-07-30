import { serve } from "@hono/node-server";
import app, { nodeWebSocket } from "./app";
import { config, persistBootstrapSettings } from "./config";
import { ensureNightWorkersSchema } from "./db/bootstrap";
import { client } from "./db/client";
import {
	configureRuntimeLogRetention,
	flushRuntimeLogs,
	logEvent,
} from "./lib/logger";
import { initializeCodingAgentRunHandlers } from "./modules/codingAgent";
import {
	reconcileMissionPilotStartup,
	submitDueQuestionnaireDrafts,
} from "./modules/missionPilot";
import { flushActivityEventQueue } from "./modules/nightworkers/nightworkers.activity.repository";
import { initializeTaskUserIntakeHandler } from "./modules/nightworkers/nightworkers.user-intake.handler";
import { reconcileImplementationQueue } from "./modules/queue/queue-management.service";
import { createRuntimeDatabaseBackup } from "./runtime/bootstrap";
import { isLoopbackHost } from "./security/listen-security";
import { shutdownIsolatedTaskWorkers } from "./services/execution/worker-process-manager";
import { previewProjectRepositoryIdentityBackfill } from "./services/git/project-repository-identity-reconciliation";
import { mcpClientManager } from "./services/mcp/mcp-client-manager";
import { nightWorkersRealtimeBroker } from "./services/realtime/nightworkers-ws";
import {
	runRuntimeRetentionSweep,
	subscribeRuntimeRetentionSettingsChanged,
} from "./services/runtime-retention/runtime-retention.service";
import { migrateLegacyApplicationSettingSecrets } from "./services/settings/application-settings-store";
import {
	readGeneralSettings,
	refreshFxRatesIfNeeded,
} from "./services/settings/general-settings";
import { reconcileTaskWorkspaceAuthorities } from "./services/workspace/workspace-authority-reconciliation";

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
const fxRefreshIntervalMs = 60 * 60 * 1000;
const implementationQueueReconcileIntervalMs = 60 * 1000;

initializeCodingAgentRunHandlers();
initializeTaskUserIntakeHandler();

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
	if (!isLoopbackHost(host)) {
		throw new Error(
			`NightWorkers only supports loopback listeners. Received host=${host}`,
		);
	}

	createRuntimeDatabaseBackup();
	await ensureNightWorkersSchema();
	migrateLegacyApplicationSettingSecrets();
	await persistBootstrapSettings();
	const repositoryIdentityPreview =
		await previewProjectRepositoryIdentityBackfill();
	const repositoryIdentityMismatchCount = repositoryIdentityPreview.filter(
		(result) => result.needsBackfill,
	).length;
	if (repositoryIdentityMismatchCount > 0) {
		logEvent({
			channel: "api",
			level: "warn",
			message: "project repository identity reconciliation found mismatches",
			meta: {
				mismatchCount: repositoryIdentityMismatchCount,
				mode: "read_only",
			},
		});
	}
	const workspaceReconciliation = await reconcileTaskWorkspaceAuthorities();
	const workspaceMismatchCount = workspaceReconciliation.filter(
		(result) => result.mismatchCode,
	).length;
	if (workspaceMismatchCount > 0) {
		logEvent({
			channel: "api",
			level: "warn",
			message: "task workspace authority reconciliation requires attention",
			meta: { mismatchCount: workspaceMismatchCount },
		});
	}
	configureRuntimeLogRetention(readGeneralSettings().dataRetention);
	await runRuntimeRetentionSweep({ forceUsageCleanup: true }).catch((error) => {
		logEvent({
			channel: "api",
			level: "warn",
			message: "runtime retention startup cleanup failed",
			meta: {
				errorMessage: error instanceof Error ? error.message : String(error),
			},
		});
	});
	await reconcileMissionPilotStartup();
	let queueReconcileInFlight: Promise<void> | null = null;
	const reconcileQueue = (reason: "startup" | "scheduled") => {
		if (queueReconcileInFlight) return queueReconcileInFlight;
		queueReconcileInFlight = reconcileImplementationQueue({
			apply: true,
			reason,
		})
			.then(() => undefined)
			.catch((error) => {
				logEvent({
					channel: "api",
					level: "error",
					message: "implementation queue reconciliation failed",
					meta: {
						reason,
						errorMessage:
							error instanceof Error ? error.message : String(error),
					},
				});
			})
			.finally(() => {
				queueReconcileInFlight = null;
			});
		return queueReconcileInFlight;
	};
	void reconcileQueue("startup");
	const implementationQueueReconcileTimer = setInterval(
		() => void reconcileQueue("scheduled"),
		implementationQueueReconcileIntervalMs,
	);
	implementationQueueReconcileTimer.unref?.();

	const server = serve({
		fetch: app.fetch,
		hostname: host,
		port,
	});
	nodeWebSocket.injectWebSocket(server);
	let fxRefreshInFlight: Promise<void> | null = null;
	const refreshFxRates = () => {
		if (fxRefreshInFlight) return fxRefreshInFlight;
		fxRefreshInFlight = refreshFxRatesIfNeeded()
			.then((result) => {
				if (result.status !== "refreshed") return;
				logEvent({
					channel: "api",
					level: "info",
					message: "FX rates refreshed",
					meta: {
						source: result.cache.source,
						validOn: result.cache.validOn,
					},
				});
			})
			.catch((error) => {
				logEvent({
					channel: "api",
					level: "warn",
					message: "FX rate auto refresh failed",
					meta: {
						errorMessage:
							error instanceof Error ? error.message : String(error),
					},
				});
			})
			.finally(() => {
				fxRefreshInFlight = null;
			});
		return fxRefreshInFlight;
	};
	void refreshFxRates();
	const fxRefreshTimer = setInterval(
		() => void refreshFxRates(),
		fxRefreshIntervalMs,
	);
	fxRefreshTimer.unref?.();
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
	let closed = false;
	let retentionTimer: NodeJS.Timeout | null = null;
	const scheduleRetentionSweep = () => {
		if (closed) return;
		if (retentionTimer) clearTimeout(retentionTimer);
		retentionTimer = setTimeout(
			() => {
				void runRuntimeRetentionSweep()
					.catch((error) => {
						logEvent({
							channel: "api",
							level: "warn",
							message: "runtime retention scheduled cleanup failed",
							meta: {
								errorMessage:
									error instanceof Error ? error.message : String(error),
							},
						});
					})
					.finally(scheduleRetentionSweep);
			},
			readGeneralSettings().dataRetention.sweepIntervalMinutes * 60 * 1000,
		);
		retentionTimer.unref?.();
	};
	const unsubscribeRetentionReload = subscribeRuntimeRetentionSettingsChanged(
		scheduleRetentionSweep,
	);
	scheduleRetentionSweep();
	logEvent({
		channel: "api",
		level: "info",
		message: "server started",
		meta: { host, port },
	});

	const close = async (signal: NodeJS.Signals | "manual" = "manual") => {
		if (closed) return;
		closed = true;
		clearInterval(missionPilotQuestionnaireTimer);
		if (retentionTimer) clearTimeout(retentionTimer);
		unsubscribeRetentionReload();
		clearInterval(fxRefreshTimer);
		clearInterval(implementationQueueReconcileTimer);
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
				"Runtime log writer flush",
				await Promise.allSettled([flushRuntimeLogs()]).then(
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
