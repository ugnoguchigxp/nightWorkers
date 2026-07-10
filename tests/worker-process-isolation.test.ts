import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	getIsolatedWorkerCount,
	runImplementationQueueInWorker,
	shutdownIsolatedTaskWorkers,
} from "../api/services/execution/worker-process-manager";

describe("worker process isolation", () => {
	afterEach(async () => {
		await shutdownIsolatedTaskWorkers();
	});

	it("starts the queue claimant through IPC without terminating the API test process", async () => {
		const tempDirectory = await fs.mkdtemp(
			path.join(os.tmpdir(), "nightworkers-worker-process-test-"),
		);
		try {
			const runs = await runImplementationQueueInWorker({
				environment: {
					DATABASE_URL: `file:${path.join(tempDirectory, "worker.db")}`,
					NODE_ENV: "test",
				},
			});
			expect(Array.isArray(runs)).toBe(true);
			expect(process.exitCode).not.toBe(1);
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(getIsolatedWorkerCount()).toBe(0);
		} finally {
			await fs.rm(tempDirectory, { recursive: true, force: true });
		}
	}, 20_000);
});
