import { client } from "../db/client";
import { flushActivityEventQueue } from "../modules/nightworkers/nightworkers.activity.repository";
import * as repo from "../modules/nightworkers/nightworkers.repository";

const activeRunStatuses = new Set([
	"running",
	"context_compiling",
	"compiling_context",
	"finalizing",
]);

export async function waitForRunsToFinish(runIds: string[]) {
	while (runIds.length > 0) {
		const runs = await Promise.all(
			runIds.map((runId) => repo.getTaskRun(runId)),
		);
		if (runs.every((run) => !run || !activeRunStatuses.has(run.status))) return;
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
}

let closeWorkerResourcesPromise: Promise<void> | null = null;

export function closeWorkerResources() {
	closeWorkerResourcesPromise ??= (async () => {
		await flushActivityEventQueue();
		client.close();
	})();
	return closeWorkerResourcesPromise;
}

export function sendWorkerMessage(message: Record<string, unknown>) {
	const send = process.send;
	if (!process.connected || !send) return Promise.resolve();
	return new Promise<void>((resolve, reject) => {
		send.call(process, message, (error) => {
			if (error) reject(error);
			else resolve();
		});
	});
}
