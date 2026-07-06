import { describe, expect, it } from "vitest";
import {
	dedupeAndSortRunEvents,
	getRealtimeMessageDedupeKey,
	mergeRealtimeRunDetails,
	mergeRealtimeRunList,
	mergeRealtimeTodo,
	mergeRealtimeTodoIntoRunDetails,
	mergeRunEvents,
} from "../src/modules/nightworkers/realtimeEvents";
import type {
	RunDetails,
	TaskEvent,
	TaskRunTodo,
} from "../src/modules/nightworkers/types";

function event(id: string, runId: string, seq: number): TaskEvent {
	return {
		id,
		runId,
		seq,
		message: id,
		timestamp: `2026-06-02T00:00:${String(seq).padStart(2, "0")}.000Z`,
	};
}

function todo(
	input: Partial<TaskRunTodo> & Pick<TaskRunTodo, "id" | "runId" | "seq">,
): TaskRunTodo {
	return {
		title: `todo-${input.seq}`,
		taskType: "implementation",
		status: "pending",
		createdAt: "2026-06-02T00:00:00.000Z",
		updatedAt: "2026-06-02T00:00:00.000Z",
		...input,
	};
}

function runDetails(
	input: Partial<RunDetails> & Pick<RunDetails, "id" | "taskId">,
): RunDetails {
	return {
		repositoryId: "repo-1",
		status: "running",
		workerKind: "codex-agent",
		timeoutSeconds: 600,
		startedAt: "2026-06-02T00:00:00.000Z",
		createdAt: "2026-06-02T00:00:00.000Z",
		updatedAt: "2026-06-02T00:00:00.000Z",
		todos: [],
		events: [],
		reviews: [],
		...input,
	};
}

describe("NightWorkers realtime event reconciliation", () => {
	it("dedupes by event id and sorts by seq", () => {
		const merged = dedupeAndSortRunEvents([
			event("evt-2", "run-1", 2),
			{ ...event("evt-1", "run-1", 1), message: "rest copy" },
			{ ...event("evt-1", "run-1", 1), message: "ws copy" },
		]);

		expect(merged.map((e) => e.id)).toEqual(["evt-1", "evt-2"]);
		expect(merged[0]?.message).toBe("ws copy");
	});

	it("keeps buffered events scoped to the latest run only", () => {
		const merged = mergeRunEvents({
			latestRunId: "run-2",
			restEvents: [event("run-2-rest", "run-2", 2)],
			bufferedEventsByRun: {
				"run-1": [event("run-1-ws", "run-1", 1)],
				"run-2": [event("run-2-ws", "run-2", 1)],
			},
		});

		expect(merged.map((e) => e.id)).toEqual(["run-2-ws", "run-2-rest"]);
	});

	it("builds stable websocket message dedupe keys from task sequence metadata", () => {
		expect(
			getRealtimeMessageDedupeKey({
				type: "task_llm_delta",
				taskId: "task-1",
				seq: 3,
				timestamp: "2026-06-03T00:00:00.000Z",
			}),
		).toBe("task-1:task_llm_delta:3:2026-06-03T00:00:00.000Z");
		expect(
			getRealtimeMessageDedupeKey({ type: "task_llm_delta", taskId: "task-1" }),
		).toBeNull();
	});

	it("merges realtime Todo updates without reopening terminal Todos", () => {
		const completed = todo({
			id: "todo-1",
			runId: "run-1",
			seq: 1,
			status: "passed",
			updatedAt: "2026-06-02T00:00:10.000Z",
		});
		const staleRunning = todo({
			id: "todo-1",
			runId: "run-1",
			seq: 1,
			status: "running",
			updatedAt: "2026-06-02T00:00:11.000Z",
		});

		expect(mergeRealtimeTodo([completed], staleRunning)[0]?.status).toBe(
			"passed",
		);
	});

	it("applies realtime Todo completion updates to run details", () => {
		const details = runDetails({
			id: "run-1",
			taskId: "task-1",
			todos: [
				todo({
					id: "todo-1",
					runId: "run-1",
					seq: 1,
					status: "running",
				}),
			],
		});

		const merged = mergeRealtimeTodoIntoRunDetails(
			details,
			todo({
				id: "todo-1",
				runId: "run-1",
				seq: 1,
				status: "passed",
				updatedAt: "2026-06-02T00:00:10.000Z",
			}),
		);

		expect(merged?.todos[0]?.status).toBe("passed");
	});

	it("updates run detail status while preserving hydrated child collections", () => {
		const details = runDetails({
			id: "run-1",
			taskId: "task-1",
			status: "running",
			todos: [todo({ id: "todo-1", runId: "run-1", seq: 1, status: "passed" })],
			events: [event("evt-1", "run-1", 1)],
		});

		const merged = mergeRealtimeRunDetails(details, {
			...details,
			status: "completed",
			todos: undefined,
			events: undefined,
			reviews: undefined,
		});

		expect(merged?.status).toBe("completed");
		expect(merged?.todos).toHaveLength(1);
		expect(merged?.events).toHaveLength(1);
	});

	it("does not let delayed active run updates roll back terminal runs", () => {
		const completed = runDetails({
			id: "run-1",
			taskId: "task-1",
			status: "completed",
			updatedAt: "2026-06-02T00:01:00.000Z",
		});
		const staleRunning = {
			...completed,
			status: "running",
			updatedAt: "2026-06-02T00:01:01.000Z",
		};

		expect(mergeRealtimeRunDetails(completed, staleRunning)?.status).toBe(
			"completed",
		);
		expect(mergeRealtimeRunList([completed], staleRunning)[0]?.status).toBe(
			"completed",
		);
	});

	it("closes cached open Todos when a terminal run update arrives without Todo payloads", () => {
		const details = runDetails({
			id: "run-1",
			taskId: "task-1",
			status: "running",
			todos: [
				todo({ id: "todo-1", runId: "run-1", seq: 1, status: "passed" }),
				todo({ id: "todo-2", runId: "run-1", seq: 2, status: "running" }),
				todo({ id: "todo-3", runId: "run-1", seq: 3, status: "pending" }),
			],
		});

		const merged = mergeRealtimeRunDetails(details, {
			...details,
			status: "cancelled",
			todos: undefined,
			events: undefined,
			reviews: undefined,
		});

		expect(merged?.todos.map((item) => [item.seq, item.status])).toEqual([
			[1, "passed"],
			[2, "failed"],
			[3, "skipped"],
		]);
	});
});
