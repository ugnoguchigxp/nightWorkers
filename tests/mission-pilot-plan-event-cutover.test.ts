import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	isFailureLikeTaskRunStatus,
	publishTaskRunTerminal,
	registerTaskRunTerminalListener,
} from "../api/modules/agentsShare";

describe("Mission Pilot Plan event cutover contract", () => {
	it("publishes a neutral terminal event without resuming Coding Agent", async () => {
		const listener = vi.fn();
		const unregister = registerTaskRunTerminalListener(listener);
		await publishTaskRunTerminal({
			type: "task_run.terminal",
			eventId: "event-1",
			taskId: "task-1",
			runId: "run-1",
			status: "failed",
			sourceRef: null,
			occurredAt: "2026-07-16T00:00:00.000Z",
		});
		unregister();
		expect(listener).toHaveBeenCalledWith(
			expect.objectContaining({ type: "task_run.terminal", runId: "run-1" }),
		);
	});

	it("isolates synchronous and asynchronous subscriber failures", async () => {
		const successfulListener = vi.fn();
		const unregisterSyncFailure = registerTaskRunTerminalListener(() => {
			throw new Error("sync listener failed");
		});
		const unregisterAsyncFailure = registerTaskRunTerminalListener(async () => {
			throw new Error("async listener failed");
		});
		const unregisterSuccessful =
			registerTaskRunTerminalListener(successfulListener);

		const publication = await publishTaskRunTerminal({
			type: "task_run.terminal",
			eventId: "event-2",
			taskId: "task-1",
			runId: "run-2",
			status: "completed",
			sourceRef: null,
			occurredAt: "2026-07-16T00:00:00.000Z",
		});

		unregisterSyncFailure();
		unregisterAsyncFailure();
		unregisterSuccessful();
		expect(successfulListener).toHaveBeenCalledOnce();
		expect(publication.listenerCount).toBe(3);
		expect(publication.failures).toHaveLength(2);
	});

	it.each([
		"failed",
		"timed_out",
		"cancelled",
		"blocked",
		"needs_human",
	])("classifies %s as a failure-like terminal status", (status) => {
		expect(isFailureLikeTaskRunStatus(status)).toBe(true);
	});

	it("publishes terminal events only after closeout writes", () => {
		const successSource = fs.readFileSync(
			path.join(
				process.cwd(),
				"api/modules/nightworkers/run-orchestration/runtime-execution.ts",
			),
			"utf8",
		);
		const failureSource = fs.readFileSync(
			path.join(
				process.cwd(),
				"api/modules/nightworkers/run-orchestration/runtime-execution-failure.ts",
			),
			"utf8",
		);

		expect(successSource.indexOf("publishTaskRunTerminal({")).toBeGreaterThan(
			successSource.indexOf("executeMissionPilotContinuation"),
		);
		expect(failureSource.indexOf("publishTaskRunTerminal({")).toBeGreaterThan(
			failureSource.indexOf("publishTaskRunUpdate"),
		);
	});
});
