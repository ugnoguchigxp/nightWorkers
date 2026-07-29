import { startTaskRunInProcess } from "../modules/nightworkers/run-orchestration/start-task-run";
import type { StartTaskRunOptions } from "../modules/nightworkers/run-orchestration/start-task-run-types";
import { stopTaskRun } from "../modules/nightworkers/run-orchestration/stop-task-run";
import { consumeApplicationSettingsWorkerSnapshot } from "../services/settings/application-settings-store";
import { runWithSystemContextBinding } from "../systemContexts/catalog";
import {
	closeWorkerResources,
	sendWorkerMessage,
	waitForRunsToFinish,
} from "./worker-lifecycle";

let activeRunId: string | null = null;
let shuttingDown = false;

consumeApplicationSettingsWorkerSnapshot();

async function shutdown() {
	if (shuttingDown) return;
	shuttingDown = true;
	if (activeRunId) {
		await stopTaskRun(activeRunId).catch(() => undefined);
	}
	await closeWorkerResources().catch(() => undefined);
	process.exit(0);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
process.on("disconnect", () => void shutdown());

process.once("message", (raw) => {
	void runWithSystemContextBinding(async () => {
		try {
			const message = raw as {
				type?: unknown;
				payload?: { taskId?: unknown; options?: StartTaskRunOptions };
			};
			if (
				message.type !== "start" ||
				typeof message.payload?.taskId !== "string"
			) {
				throw new Error("Task worker received an invalid start payload.");
			}
			const run = await startTaskRunInProcess(
				message.payload.taskId,
				message.payload.options ?? {},
			);
			activeRunId = run.id;
			await sendWorkerMessage({ type: "started", runs: [run] });
			await waitForRunsToFinish([run.id]);
			activeRunId = null;
			await closeWorkerResources();
			process.exit(0);
		} catch (error) {
			await sendWorkerMessage({
				type: "failed",
				error: error instanceof Error ? error.message : String(error),
			}).catch(() => undefined);
			await closeWorkerResources().catch(() => undefined);
			process.exit(1);
		}
	});
});
