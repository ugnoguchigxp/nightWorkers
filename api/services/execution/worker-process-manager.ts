import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logEvent } from "../../lib/logger";
import type { StartTaskRunOptions } from "../../modules/nightworkers/run-orchestration/start-task-run";

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
	child.once("exit", () => {
		activeWorkers.delete(child);
		for (const [runId, owner] of workersByRunId) {
			if (owner === child) workersByRunId.delete(runId);
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
	const child = spawn(entry.command, entry.args, {
		cwd: process.cwd(),
		env: {
			...process.env,
			...environment,
			NIGHTWORKERS_EXECUTION_ROLE: "worker",
			NIGHTWORKERS_EXECUTOR_MODE: "in_process",
			...(kind === "queue-worker" ? { NIGHTWORKERS_QUEUE_WORKER: "1" } : {}),
		},
		stdio: ["ignore", "pipe", "pipe", "ipc"],
	});
	trackWorker(child);
	return new Promise<unknown[]>((resolve, reject) => {
		let settled = false;
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
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			reject(
				new Error(
					`${kind} exited before startup (code=${code}, signal=${signal})`,
				),
			);
		});
		child.on("message", (raw) => {
			const message = raw as WorkerMessage;
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
		child.send?.({ type: "start", payload });
	});
}

export async function startTaskRunInWorker<T = unknown>(
	taskId: string,
	options: StartTaskRunOptions,
): Promise<T> {
	const runs = await spawnWorker("task-run-worker", { taskId, options });
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
	await waitForExit(child, shutdownTimeoutMs);
	return true;
}

function waitForExit(child: ChildProcess, timeoutMs: number) {
	if (child.exitCode !== null) return Promise.resolve();
	return new Promise<void>((resolve) => {
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			resolve();
		}, timeoutMs);
		timer.unref?.();
		child.once("exit", () => {
			clearTimeout(timer);
			resolve();
		});
	});
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
