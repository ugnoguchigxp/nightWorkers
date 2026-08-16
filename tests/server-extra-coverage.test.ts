import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	const logInputs: unknown[] = [];
	const socketOpen = {
		OPEN: 1,
		CONNECTING: 0,
		readyState: 1,
		close: vi.fn(),
		terminate: vi.fn(),
	};
	const socketConnecting = {
		OPEN: 1,
		CONNECTING: 0,
		readyState: 0,
		close: vi.fn(),
		terminate: vi.fn(),
	};
	const socketClosed = {
		OPEN: 1,
		CONNECTING: 0,
		readyState: 3,
		close: vi.fn(),
		terminate: vi.fn(),
	};
	const server = {
		close: vi.fn((callback: (error?: Error) => void) => callback()),
		closeIdleConnections: vi.fn(),
		closeAllConnections: vi.fn(),
	};
	const wss = {
		clients: new Set([socketOpen, socketConnecting, socketClosed]),
		close: vi.fn((callback: (error?: Error) => void) => callback()),
	};
	let loopback = true;
	let retentionResult: unknown;
	let queueResult: unknown;
	let fxResult: unknown = { status: "unchanged" };
	let repositoryPreview: Array<Record<string, unknown>> = [];
	let workspacePreview: Array<Record<string, unknown>> = [];
	let cleanupFailures = new Set<string>();
	let retentionCallback: (() => void) | null = null;

	return {
		logInputs,
		socketOpen,
		socketConnecting,
		socketClosed,
		server,
		wss,
		get loopback() {
			return loopback;
		},
		setLoopback(value: boolean) {
			loopback = value;
		},
		get retentionResult() {
			return retentionResult;
		},
		setRetentionResult(value: unknown) {
			retentionResult = value;
		},
		get queueResult() {
			return queueResult;
		},
		setQueueResult(value: unknown) {
			queueResult = value;
		},
		get fxResult() {
			return fxResult;
		},
		setFxResult(value: unknown) {
			fxResult = value;
		},
		get repositoryPreview() {
			return repositoryPreview;
		},
		setRepositoryPreview(value: Array<Record<string, unknown>>) {
			repositoryPreview = value;
		},
		get workspacePreview() {
			return workspacePreview;
		},
		setWorkspacePreview(value: Array<Record<string, unknown>>) {
			workspacePreview = value;
		},
		fails(scope: string) {
			return cleanupFailures.has(scope);
		},
		setCleanupFailures(...scopes: string[]) {
			cleanupFailures = new Set(scopes);
		},
		setRetentionCallback(callback: () => void) {
			retentionCallback = callback;
		},
		get retentionCallback() {
			return retentionCallback;
		},
		reset() {
			logInputs.length = 0;
			loopback = true;
			retentionResult = undefined;
			queueResult = undefined;
			fxResult = { status: "unchanged" };
			repositoryPreview = [];
			workspacePreview = [];
			cleanupFailures = new Set();
			retentionCallback = null;
			server.close.mockReset().mockImplementation((callback) => callback());
			server.closeIdleConnections.mockClear();
			server.closeAllConnections.mockClear();
			wss.close.mockReset().mockImplementation((callback) => callback());
			socketOpen.close.mockClear();
			socketOpen.terminate.mockClear();
			socketConnecting.close.mockClear();
			socketConnecting.terminate.mockClear();
			socketClosed.close.mockClear();
			socketClosed.terminate.mockClear();
		},
	};
});

vi.mock("@hono/node-server", () => ({ serve: () => mocks.server }));
vi.mock("../api/app", () => ({
	default: { fetch: vi.fn() },
	nodeWebSocket: {
		wss: mocks.wss,
		injectWebSocket: vi.fn(),
	},
}));
vi.mock("../api/composition/mission-pilot", () => ({
	createMissionPilotDependencies: () => ({ dependencies: true }),
	bootstrapComposedMissionPilotStorage: async (input: {
		logger: {
			info: (message: string, context: unknown) => void;
			error: (message: string, context: unknown) => void;
		};
	}) => {
		input.logger.info("bootstrap info", { ok: true });
		input.logger.error("bootstrap error", { ok: false });
	},
	startComposedMissionPilotRuntime: async () => ({ stop: vi.fn() }),
}));
vi.mock("../api/config", () => ({
	config: { PORT: 4321, HOST: "127.0.0.1" },
	persistBootstrapSettings: vi.fn(async () => undefined),
}));
vi.mock("../api/db/bootstrap", () => ({
	ensureNightWorkersSchema: vi.fn(async () => undefined),
}));
vi.mock("../api/db/client", () => ({
	client: {
		close: () =>
			mocks.fails("db") ? Promise.reject("db failure") : Promise.resolve(),
	},
}));
vi.mock("../api/lib/logger", () => ({
	configureRuntimeLogRetention: vi.fn(),
	flushRuntimeLogs: () =>
		mocks.fails("logs") ? Promise.reject("log failure") : Promise.resolve(),
	logEvent: (input: unknown) => mocks.logInputs.push(input),
}));
vi.mock("../api/modules/codingAgent", () => ({
	initializeCodingAgentRunHandlers: vi.fn(),
	reconcileCodingAgentProcessInterruptions: vi.fn(async () => undefined),
	suspendActiveCodingAgentRunsForHostShutdown: vi.fn(async () => undefined),
}));
vi.mock("../api/modules/nightworkers/nightworkers.activity.repository", () => ({
	flushActivityEventQueue: () =>
		mocks.fails("activity")
			? Promise.reject(new Error("activity failure"))
			: Promise.resolve(),
}));
vi.mock("../api/modules/nightworkers/nightworkers.user-intake.handler", () => ({
	initializeTaskUserIntakeHandler: vi.fn(),
}));
vi.mock("../api/modules/queue/queue-management.service", () => ({
	reconcileImplementationQueue: () =>
		mocks.queueResult instanceof Error || typeof mocks.queueResult === "string"
			? Promise.reject(mocks.queueResult)
			: Promise.resolve(mocks.queueResult),
}));
vi.mock("../api/runtime/bootstrap", () => ({
	createRuntimeDatabaseBackup: vi.fn(),
}));
vi.mock("../api/security/listen-security", () => ({
	isLoopbackHost: () => mocks.loopback,
}));
vi.mock("../api/services/execution/worker-process-manager", () => ({
	shutdownIsolatedTaskWorkers: () =>
		mocks.fails("workers")
			? Promise.reject(new Error("worker failure"))
			: Promise.resolve(),
}));
vi.mock(
	"../api/services/git/project-repository-identity-reconciliation",
	() => ({
		previewProjectRepositoryIdentityBackfill: async () =>
			mocks.repositoryPreview,
	}),
);
vi.mock("../api/services/mcp/mcp-client-manager", () => ({
	mcpClientManager: {
		disconnectAll: () =>
			mocks.fails("mcp") ? Promise.reject("mcp failure") : Promise.resolve(),
	},
}));
vi.mock("../api/services/realtime/nightworkers-ws", () => ({
	nightWorkersRealtimeBroker: { closeAll: vi.fn() },
}));
vi.mock("../api/services/runtime-retention/runtime-retention.service", () => ({
	runRuntimeRetentionSweep: () =>
		mocks.retentionResult instanceof Error ||
		typeof mocks.retentionResult === "string"
			? Promise.reject(mocks.retentionResult)
			: Promise.resolve(mocks.retentionResult),
	subscribeRuntimeRetentionSettingsChanged: (callback: () => void) => {
		mocks.setRetentionCallback(callback);
		return vi.fn();
	},
}));
vi.mock("../api/services/settings/application-settings-store", () => ({
	migrateLegacyApplicationSettingSecrets: vi.fn(),
	readApplicationSetting: vi.fn(),
}));
vi.mock(
	"../api/services/settings/general-settings",
	async (importOriginal) => ({
		...(await importOriginal<
			typeof import("../api/services/settings/general-settings")
		>()),
		readGeneralSettings: () => ({
			dataRetention: { sweepIntervalMinutes: 30 },
		}),
		refreshFxRatesIfNeeded: () =>
			mocks.fxResult instanceof Error || typeof mocks.fxResult === "string"
				? Promise.reject(mocks.fxResult)
				: Promise.resolve(mocks.fxResult),
	}),
);
vi.mock("../api/services/workspace/workspace-authority-reconciliation", () => ({
	reconcileTaskWorkspaceAuthorities: async () => mocks.workspacePreview,
}));

import { createNightWorkersServer } from "../api/server";

beforeEach(() => {
	mocks.reset();
	vi.useFakeTimers();
});

afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
});

describe("server extra coverage", () => {
	it("rejects non-loopback hosts before startup", async () => {
		mocks.setLoopback(false);
		await expect(
			createNightWorkersServer({ host: "0.0.0.0", port: 9999 }),
		).rejects.toThrow("only supports loopback");
	});

	it("starts, reports mismatches and refreshed FX, then closes once", async () => {
		mocks.setRepositoryPreview([
			{ needsBackfill: true },
			{ needsBackfill: false },
		]);
		mocks.setWorkspacePreview([{ mismatchCode: "owner" }, {}]);
		mocks.setRetentionResult("retention startup failure");
		mocks.setQueueResult(new Error("queue failure"));
		mocks.setFxResult({
			status: "refreshed",
			cache: { source: "ecb", validOn: "2026-08-09" },
		});

		const handle = await createNightWorkersServer({
			host: "localhost",
			port: 1234,
		});
		await vi.advanceTimersByTimeAsync(0);
		expect(handle).toMatchObject({
			port: 1234,
			host: "localhost",
			origin: "http://localhost:1234",
		});
		expect(mocks.logInputs).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ message: "bootstrap info" }),
				expect.objectContaining({ message: "bootstrap error" }),
				expect.objectContaining({
					message:
						"project repository identity reconciliation found mismatches",
				}),
				expect.objectContaining({
					message: "task workspace authority reconciliation requires attention",
				}),
				expect.objectContaining({ message: "FX rates refreshed" }),
			]),
		);

		await handle.close("SIGTERM");
		await handle.close();
		expect(mocks.socketOpen.close).toHaveBeenCalledWith(
			1001,
			"server shutting down",
		);
		expect(mocks.socketConnecting.close).toHaveBeenCalled();
		expect(mocks.socketClosed.close).not.toHaveBeenCalled();
		expect(mocks.server.closeIdleConnections).toHaveBeenCalledOnce();
	});

	it("aggregates every asynchronous shutdown failure", async () => {
		mocks.setCleanupFailures("workers", "activity", "logs", "mcp", "db");
		mocks.server.close.mockImplementation((callback) =>
			callback(new Error("http failure")),
		);
		mocks.wss.close.mockImplementation((callback) =>
			callback(new Error("websocket failure")),
		);
		const handle = await createNightWorkersServer();

		await expect(handle.close()).rejects.toMatchObject({
			name: "AggregateError",
			errors: expect.arrayContaining([
				expect.objectContaining({
					message: "Isolated task workers shutdown: worker failure",
				}),
				expect.objectContaining({ message: "HTTP server close: http failure" }),
				expect.objectContaining({
					message: "Runtime log writer flush: log failure",
				}),
			]),
		});
		expect(mocks.logInputs).toContainEqual(
			expect.objectContaining({ message: "shutdown failed" }),
		);
	});

	it("uses close fallbacks and force-terminates clients after a timeout", async () => {
		mocks.server.close.mockImplementation(() => undefined);
		mocks.wss.close.mockImplementation(() => undefined);
		const handle = await createNightWorkersServer({ shutdownTimeoutMs: 5 });
		const closing = handle.close();
		await vi.advanceTimersByTimeAsync(300);
		await closing;

		expect(mocks.server.closeAllConnections).toHaveBeenCalledOnce();
		expect(mocks.socketOpen.terminate).toHaveBeenCalledOnce();
		expect(mocks.socketConnecting.terminate).toHaveBeenCalledOnce();
		expect(mocks.socketClosed.terminate).toHaveBeenCalledOnce();
		expect(mocks.logInputs).toContainEqual(
			expect.objectContaining({ message: "graceful shutdown timed out" }),
		);
	});

	it("logs Error-valued retention and FX failures", async () => {
		mocks.setRetentionResult(new Error("retention error"));
		mocks.setFxResult(new Error("fx error"));
		const handle = await createNightWorkersServer();
		await vi.advanceTimersByTimeAsync(0);
		expect(mocks.logInputs).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					message: "runtime retention startup cleanup failed",
				}),
				expect.objectContaining({ message: "FX rate auto refresh failed" }),
			]),
		);
		await handle.close();
	});
});
