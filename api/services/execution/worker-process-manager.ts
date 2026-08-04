import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logEvent } from "../../lib/logger";
import type { StartTaskRunOptions } from "../../modules/nightworkers/run-orchestration/start-task-run-types";
import { createApplicationSettingsWorkerSnapshot } from "../settings/application-settings-store";
import { buildChildProcessEnvironment } from "./child-process-environment";
import {
	attachPersistenceOwnerIpcServer,
	type PersistenceOwnerIpcServerHandle,
} from "./persistence-owner-ipc-server";

type WorkerKind = "task-run-worker" | "queue-worker";
type WorkerStartedMessage = {
	type: "started";
	runs: unknown[];
};
type WorkerFailedMessage = { type: "failed"; error: string };
type WorkerMessage = WorkerStartedMessage | WorkerFailedMessage;

const startupTimeoutMs = 60_000;
const shutdownTimeoutMs = 10_000;
const activeWorkers = new Set<ChildProcess>();
const workersByRunId = new Map<string, ChildProcess>();
const persistenceOwners = new WeakMap<
	ChildProcess,
	PersistenceOwnerIpcServerHandle
>();

function workerEntry(kind: WorkerKind) {
	const bundled = path.join(
		path.dirname(fileURLToPath(import.meta.url)),
		`${kind}.js`,
	);
	if (fs.existsSync(bundled)) {
		return { command: process.execPath, args: [bundled] };
	}
	const source = path.join(process.cwd(), "api", "workers", `${kind}.ts`);
	return {
		command: process.platform === "win32" ? "bun.exe" : "bun",
		args: [source],
	};
}

function trackWorker(child: ChildProcess) {
	activeWorkers.add(child);
	const persistenceOwner = attachPersistenceOwnerIpcServer(child);
	persistenceOwners.set(child, persistenceOwner);
	child.once("exit", () => {
		activeWorkers.delete(child);
		void persistenceOwner.close();
		const lostRuns: Array<{ runId: string; ownerPid: number }> = [];
		for (const [runId, owner] of workersByRunId) {
			if (owner === child) {
				if (child.pid !== undefined) {
					lostRuns.push({ runId, ownerPid: child.pid });
				}
				workersByRunId.delete(runId);
			}
		}
		if (lostRuns.length > 0) {
			void import("../../modules/codingAgent")
				.then(({ interruptCodingAgentRunsAfterWorkerExit }) =>
					interruptCodingAgentRunsAfterWorkerExit(lostRuns),
				)
				.catch((error) => {
					logEvent({
						channel: "worker",
						level: "error",
						message: "failed to reconcile exited Coding Agent worker",
						meta: {
							runIds: lostRuns.map((run) => run.runId),
							errorMessage:
								error instanceof Error ? error.message : String(error),
						},
					});
				});
		}
	});
	child.stdout?.on("data", (chunk) => {
		const message = String(chunk).trim();
		if (!message) return;
		logEvent({ channel: "worker", level: "info", message });
	});
	child.stderr?.on("data", (chunk) => {
		const message = String(chunk).trim();
		if (!message) return;
		logEvent({ channel: "worker", level: "error", message });
	});
}

function spawnWorker(
	kind: WorkerKind,
	payload: Record<string, unknown>,
	environment: NodeJS.ProcessEnv = {},
) {
	const entry = workerEntry(kind);
	const applicationSettingsSnapshot = createApplicationSettingsWorkerSnapshot();
	const workerEnvironment = buildChildProcessEnvironment({
		purpose: "task_worker",
		overrides: {
			...Object.fromEntries(
				Object.entries(environment).filter(
					(entry): entry is [string, string] => typeof entry[1] === "string",
				),
			),
			NIGHTWORKERS_EXECUTION_ROLE: "worker",
			NIGHTWORKERS_EXECUTOR_MODE: "in_process",
			NIGHTWORKERS_APPLICATION_SETTINGS_SNAPSHOT: applicationSettingsSnapshot,
			...(kind === "queue-worker" ? { NIGHTWORKERS_QUEUE_WORKER: "1" } : {}),
		},
	});
	const child = spawn(entry.command, entry.args, {
		cwd: process.cwd(),
		env: workerEnvironment,
		stdio: ["ignore", "pipe", "pipe", "ipc"],
	});
	trackWorker(child);
	return new Promise<unknown[]>((resolve, reject) => {
		let settled = false;
		const observedMessageTypes: string[] = [];
		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			child.kill("SIGKILL");
			reject(
				new Error(
					`${kind} did not report startup within ${startupTimeoutMs}ms`,
				),
			);
		}, startupTimeoutMs);
		timer.unref?.();
		child.once("error", (error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			reject(error);
		});
		child.once("exit", (code, signal) => {
			setImmediate(() => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				reject(
					new Error(
						`${kind} exited before startup (code=${code}, signal=${signal}, messages=${observedMessageTypes.join(",") || "none"})`,
					),
				);
			});
		});
		child.on("message", (raw) => {
			const message = raw as WorkerMessage;
			observedMessageTypes.push(
				message &&
					typeof message === "object" &&
					typeof message.type === "string"
					? message.type
					: "invalid",
			);
			if (settled || !message || typeof message !== "object") return;
			if (message.type === "failed") {
				settled = true;
				clearTimeout(timer);
				reject(new Error(message.error));
				return;
			}
			if (message.type !== "started") return;
			settled = true;
			clearTimeout(timer);
			for (const run of message.runs) {
				const runId = (run as { id?: unknown })?.id;
				if (typeof runId === "string") workersByRunId.set(runId, child);
			}
			resolve(message.runs);
		});
		if (!child.send) {
			settled = true;
			clearTimeout(timer);
			child.kill("SIGKILL");
			reject(new Error(`${kind} does not have an IPC send channel`));
			return;
		}
		child.send({ type: "start", payload }, (error) => {
			if (!error || settled) return;
			settled = true;
			clearTimeout(timer);
			child.kill("SIGKILL");
			reject(error);
		});
	});
}

export async function startTaskRunInWorker<T = unknown>(
	taskId: string,
	options: StartTaskRunOptions,
	workerOptions: { environment?: NodeJS.ProcessEnv } = {},
): Promise<T> {
	const runs = await spawnWorker(
		"task-run-worker",
		{ taskId, options },
		workerOptions.environment,
	);
	const run = runs[0];
	if (!run) throw new Error("Task worker did not return a run.");
	return run as T;
}

let queueWorkerStartup: Promise<unknown[]> | null = null;
export async function runImplementationQueueInWorker(
	options: { environment?: NodeJS.ProcessEnv } = {},
) {
	if (queueWorkerStartup) return queueWorkerStartup;
	queueWorkerStartup = spawnWorker(
		"queue-worker",
		{},
		options.environment,
	).finally(() => {
		queueWorkerStartup = null;
	});
	return queueWorkerStartup;
}

export async function stopIsolatedTaskRun(runId: string) {
	const child = workersByRunId.get(runId);
	if (!child || child.exitCode !== null) return false;
	child.kill("SIGTERM");
	return waitForExit(child, shutdownTimeoutMs);
}

async function waitForExit(child: ChildProcess, timeoutMs: number) {
	let exitConfirmed = child.exitCode !== null;
	if (child.exitCode === null) {
		exitConfirmed = await new Promise<boolean>((resolve) => {
			let hardStopTimer: NodeJS.Timeout | null = null;
			const forceStopTimer = setTimeout(() => {
				child.kill("SIGKILL");
				hardStopTimer = setTimeout(() => resolve(false), 2_000);
				hardStopTimer.unref?.();
			}, timeoutMs);
			forceStopTimer.unref?.();
			child.once("exit", () => {
				clearTimeout(forceStopTimer);
				if (hardStopTimer) clearTimeout(hardStopTimer);
				resolve(true);
			});
		});
	}
	await persistenceOwners.get(child)?.close();
	return exitConfirmed || child.exitCode !== null;
}

export async function shutdownIsolatedTaskWorkers() {
	const workers = [...activeWorkers].filter((child) => child.exitCode === null);
	for (const child of workers) child.kill("SIGTERM");
	await Promise.all(
		workers.map((child) => waitForExit(child, shutdownTimeoutMs)),
	);
}

export function getIsolatedWorkerCount() {
	return activeWorkers.size;
}
