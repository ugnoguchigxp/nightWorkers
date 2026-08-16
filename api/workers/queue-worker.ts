import { initializeComposedCodingAgent } from "../composition/coding-agent";
import { suspendCodingAgentRunForHostShutdown } from "../modules/codingAgent";
import { runImplementationQueueInProcess } from "../modules/nightworkers/run-orchestration/queues";
import { consumeApplicationSettingsWorkerSnapshot } from "../services/settings/application-settings-store";
import { runWithSystemContextBinding } from "../systemContexts/catalog";
import {
	closeWorkerResources,
	sendWorkerMessage,
	waitForRunsToFinish,
} from "./worker-lifecycle";

let activeRunIds: string[] = [];
let shuttingDown = false;

consumeApplicationSettingsWorkerSnapshot();
initializeComposedCodingAgent();

async function shutdown() {
	if (shuttingDown) return;
	shuttingDown = true;
	await Promise.all(
		activeRunIds.map((runId) =>
			suspendCodingAgentRunForHostShutdown(runId).catch(() => undefined),
		),
	);
	await closeWorkerResources().catch(() => undefined);
	process.exit(0);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
process.on("disconnect", () => void shutdown());

process.once("message", (raw) => {
	void runWithSystemContextBinding(async () => {
		try {
			const message = raw as { type?: unknown };
			if (message.type !== "start") {
				throw new Error("Queue worker received an invalid start payload.");
			}
			const firstBatch = await runImplementationQueueInProcess();
			activeRunIds = firstBatch.map((run) => run.id);
			await sendWorkerMessage({ type: "started", runs: firstBatch });
			let batch = firstBatch;
			while (batch.length > 0 && !shuttingDown) {
				await waitForRunsToFinish(batch.map((run) => run.id));
				batch = await runImplementationQueueInProcess();
				activeRunIds = batch.map((run) => run.id);
			}
			activeRunIds = [];
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
