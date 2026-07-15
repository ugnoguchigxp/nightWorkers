import { describe, expect, it, vi } from "vitest";
import {
	activatePreparedQueueRun,
	resolveLeaseConflictRunStatus,
} from "../api/modules/nightworkers/run-orchestration/queues";
import { createRetryableLaunch } from "../api/modules/nightworkers/run-orchestration/start-task-run-launch";

describe("Implementation Queue runtime activation", () => {
	it("does not associate Mission Pilot or launch runtime when lease attachment fails", async () => {
		const associate = vi.fn();
		const launch = vi.fn();

		const result = await activatePreparedQueueRun({
			attach: vi.fn().mockResolvedValue(null),
			associate,
			launch,
		});

		expect(result).toEqual({ kind: "lease_conflict" });
		expect(associate).not.toHaveBeenCalled();
		expect(launch).not.toHaveBeenCalled();
	});

	it("launches only after queue attachment and Mission Pilot association", async () => {
		const order: string[] = [];

		const result = await activatePreparedQueueRun({
			attach: async () => {
				order.push("attach");
				return { id: "queue-entry-1", status: "processing" };
			},
			associate: async () => {
				order.push("associate");
			},
			launch: async () => {
				order.push("launch");
			},
		});

		expect(result).toMatchObject({ kind: "launched" });
		expect(order).toEqual(["attach", "associate", "launch"]);
	});

	it("records a prepared terminal run without launching runtime", async () => {
		const order: string[] = [];

		const result = await activatePreparedQueueRun({
			attach: async () => {
				order.push("attach");
				return { id: "queue-entry-1", status: "processing" };
			},
			associate: async () => {
				order.push("associate");
			},
			launch: null,
		});

		expect(result).toMatchObject({ kind: "not_launchable" });
		expect(order).toEqual(["attach"]);
	});

	it("reports activation failure after attachment without launching runtime", async () => {
		const error = new Error("association failed");
		const launch = vi.fn();

		const result = await activatePreparedQueueRun({
			attach: async () => ({ id: "queue-entry-1", status: "processing" }),
			associate: async () => {
				throw error;
			},
			launch,
		});

		expect(result).toMatchObject({ kind: "activation_failed", error });
		expect(launch).not.toHaveBeenCalled();
	});

	it("preserves needs_human when resolving a lease conflict", () => {
		expect(resolveLeaseConflictRunStatus("running")).toBe("cancelled");
		expect(resolveLeaseConflictRunStatus("needs_human")).toBe("needs_human");
		expect(resolveLeaseConflictRunStatus("completed")).toBe("completed");
	});

	it("shares concurrent launch attempts and allows retry after failure", async () => {
		let attempts = 0;
		let releaseFirstAttempt: (() => void) | null = null;
		const launch = createRetryableLaunch(async () => {
			attempts += 1;
			if (attempts === 1) {
				await new Promise<void>((resolve) => {
					releaseFirstAttempt = resolve;
				});
				throw new Error("transient association failure");
			}
		});

		const first = launch();
		const concurrent = launch();
		expect(attempts).toBe(0);
		await vi.waitFor(() => expect(attempts).toBe(1));
		releaseFirstAttempt?.();
		await expect(first).rejects.toThrow("transient association failure");
		await expect(concurrent).rejects.toThrow("transient association failure");

		await launch();
		await launch();
		expect(attempts).toBe(2);
	});
});
