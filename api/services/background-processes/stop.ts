import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/client";
import { backgroundProcesses } from "../../db/schema";

const STOP_GRACE_MS = 1_000;

type ManagedProcess = {
	child: ChildProcessWithoutNullStreams;
	output: string;
	pendingOutput: string;
	secretValues: string[];
	transientRoot: string | null;
	flushOutput: () => Promise<void>;
};

type BackgroundProcessRecord = typeof backgroundProcesses.$inferSelect;

type MarkFinishedInput = {
	id: string;
	status: "running" | "completed" | "failed" | "stopped" | "lost";
	exitCode?: number | null;
	signal?: string | null;
	stopReason?: string | null;
	output: string;
};

export function createBackgroundProcessStopper(input: {
	managedProcesses: Map<string, ManagedProcess>;
	cleanupTransientRoot: (managed: ManagedProcess) => Promise<void>;
	markFinished: (
		input: MarkFinishedInput,
	) => Promise<BackgroundProcessRecord | null>;
	getBackgroundProcess: (id: string) => Promise<BackgroundProcessRecord | null>;
}) {
	const stopping = new Set<string>();
	const pendingStops = new Map<
		string,
		Promise<BackgroundProcessRecord | null>
	>();

	function isStopping(id: string) {
		return stopping.has(id);
	}

	async function recordStopFailure(id: string, reason: string) {
		const [updated] = await db
			.update(backgroundProcesses)
			.set({ stopReason: reason, updatedAt: new Date() })
			.where(
				and(
					eq(backgroundProcesses.id, id),
					eq(backgroundProcesses.status, "running"),
				),
			)
			.returning();
		return updated ?? input.getBackgroundProcess(id);
	}

	function signalManagedProcess(
		persistedPid: number | null,
		managed: ManagedProcess,
		signal: "SIGTERM" | "SIGKILL",
	) {
		try {
			if (
				persistedPid &&
				managed.child.pid &&
				persistedPid === managed.child.pid
			) {
				process.kill(-persistedPid, signal);
				return true;
			}
			return managed.child.kill(signal);
		} catch {
			try {
				return managed.child.kill(signal);
			} catch {
				return false;
			}
		}
	}

	async function waitForManagedProcessClose(
		child: ChildProcessWithoutNullStreams,
	) {
		if (child.exitCode !== null || child.signalCode !== null) return true;
		return new Promise<boolean>((resolve) => {
			const timeout = setTimeout(() => resolve(false), STOP_GRACE_MS);
			child.once("close", () => {
				clearTimeout(timeout);
				resolve(true);
			});
		});
	}

	async function stopManagedProcess(id: string, reason: string) {
		const [processRecord] = await db
			.select()
			.from(backgroundProcesses)
			.where(eq(backgroundProcesses.id, id));
		if (processRecord?.status !== "running") return processRecord ?? null;
		const managed = input.managedProcesses.get(id);
		if (!managed) {
			return input.markFinished({
				id,
				status: "lost",
				stopReason: "api_process_restarted_or_tracking_lost",
				output: processRecord.latestOutput || "",
			});
		}

		stopping.add(id);
		const terminated = signalManagedProcess(
			processRecord.pid,
			managed,
			"SIGTERM",
		);
		if (!terminated) {
			stopping.delete(id);
			return recordStopFailure(
				processRecord.id,
				"background_process_sigterm_failed",
			);
		}
		let signal: "SIGTERM" | "SIGKILL" = "SIGTERM";
		if (!(await waitForManagedProcessClose(managed.child))) {
			const killed = signalManagedProcess(
				processRecord.pid,
				managed,
				"SIGKILL",
			);
			if (!killed) {
				stopping.delete(id);
				return recordStopFailure(
					processRecord.id,
					"background_process_sigkill_failed",
				);
			}
			signal = "SIGKILL";
			if (!(await waitForManagedProcessClose(managed.child))) {
				stopping.delete(id);
				return recordStopFailure(
					processRecord.id,
					"background_process_stop_timeout",
				);
			}
		}
		stopping.delete(id);
		input.managedProcesses.delete(id);
		await managed.flushOutput();
		await input.cleanupTransientRoot(managed);
		return input.markFinished({
			id,
			status: "stopped",
			signal,
			stopReason: reason,
			output: managed.output,
		});
	}

	async function stopBackgroundProcess(id: string, reason = "user_requested") {
		const current = pendingStops.get(id);
		if (current) return current;
		const stop = stopManagedProcess(id, reason).finally(() => {
			pendingStops.delete(id);
		});
		pendingStops.set(id, stop);
		return stop;
	}

	async function stopBackgroundProcessesForRun(
		runId: string,
		reason = "run_terminal",
	) {
		const records = await db
			.select({ id: backgroundProcesses.id })
			.from(backgroundProcesses)
			.where(
				and(
					eq(backgroundProcesses.runId, runId),
					eq(backgroundProcesses.status, "running"),
				),
			);
		return Promise.all(
			records.map((record) => stopBackgroundProcess(record.id, reason)),
		);
	}

	return {
		isStopping,
		stopBackgroundProcess,
		stopBackgroundProcessesForRun,
	};
}
