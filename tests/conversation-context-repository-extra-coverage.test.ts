import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	const state = {
		selectResults: [] as unknown[],
		updateResults: [] as unknown[],
		insertResults: [] as unknown[],
	};
	const take = (values: unknown[]) => values.shift() ?? [];

	const selectFrom = vi.fn();
	const selectInnerJoin = vi.fn();
	const selectWhere = vi.fn();
	const selectOrderBy = vi.fn();
	const selectLimit = vi.fn(async () => take(state.selectResults));
	const selectChain: Record<string, unknown> = {
		from: selectFrom,
		innerJoin: selectInnerJoin,
		where: selectWhere,
		orderBy: selectOrderBy,
		limit: selectLimit,
		// biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are intentionally awaitable thenables.
		then: (
			onFulfilled: (value: unknown) => unknown,
			onRejected: (reason: unknown) => unknown,
		) =>
			Promise.resolve(take(state.selectResults)).then(onFulfilled, onRejected),
	};
	for (const fn of [selectFrom, selectInnerJoin, selectWhere, selectOrderBy])
		fn.mockImplementation(() => selectChain);

	const updateSet = vi.fn();
	const updateWhere = vi.fn();
	const updateReturning = vi.fn(async () => take(state.updateResults));
	const updateChain = {
		set: updateSet,
		where: updateWhere,
		returning: updateReturning,
	};
	updateSet.mockImplementation(() => updateChain);
	updateWhere.mockImplementation(() => updateChain);

	const insertValues = vi.fn();
	const insertReturning = vi.fn(async () => take(state.insertResults));
	const insertChain = { values: insertValues, returning: insertReturning };
	insertValues.mockImplementation(() => insertChain);

	return {
		state,
		db: {
			select: vi.fn(() => selectChain),
			update: vi.fn(() => updateChain),
			insert: vi.fn(() => insertChain),
		},
		selectLimit,
		updateSet,
		insertValues,
	};
});

vi.mock("../api/db/client", () => ({ db: mocks.db }));

import {
	getLatestConversationContextForTask,
	loadConversationContextSource,
	upsertConversationContextSnapshot,
} from "../api/services/conversation-context/repository";

beforeEach(() => {
	vi.clearAllMocks();
	mocks.state.selectResults.length = 0;
	mocks.state.updateResults.length = 0;
	mocks.state.insertResults.length = 0;
});

describe("conversation context repository extra coverage", () => {
	it("rejects an unknown task", async () => {
		mocks.state.selectResults.push([]);
		await expect(
			loadConversationContextSource({ taskId: "missing" }),
		).rejects.toThrow("Task not found: missing");
	});

	it("maps messages, runs, prior snapshots, and detailed worker failures", async () => {
		const previous = snapshotRow("snapshot-previous");
		mocks.state.selectResults.push(
			[
				{
					id: "task-1",
					title: "Task",
					status: "running",
					description: null,
					objective: "Work",
					repositoryPath: "/repo",
				},
			],
			[previous],
			[
				{
					id: "message-1",
					role: "user",
					content: "hello",
					metadataJson: { key: true },
					createdAt: new Date("2026-01-01"),
				},
			],
			[
				run("run-full"),
				run("run-fallback"),
				run("run-empty-evidence"),
				run("run-clean"),
			],
			[
				{ eventType: "other", payloadJson: null, message: "ignore" },
				{
					eventType: "tool_result",
					message: "failed full",
					payloadJson: {
						payload: {
							ok: false,
							toolName: "run_command",
							summary: "summary",
							error: { code: "EXIT", message: "command failed" },
							evidence: {
								toolName: "evidence-tool",
								failureKind: "command_failure",
								targetPath: "src/a.ts",
								reason: `reason ${"x".repeat(400)}`,
								recoveryDirective: {
									kind: "retry",
									targetPath: "src/a.ts",
									reason: " retry   carefully ",
									maxRepeats: 2,
								},
							},
						},
					},
				},
			],
			[
				{
					eventType: "tool_result",
					message: "fallback message",
					payloadJson: {
						payload: {
							ok: false,
							toolName: 9,
							summary: 9,
							error: { code: 9, message: 9 },
							evidence: {
								reason: 9,
								recoveryDirective: {
									kind: null,
									targetPath: 9,
									reason: 9,
									maxRepeats: "many",
								},
							},
						},
					},
				},
			],
			[
				{
					eventType: "tool_result",
					message: `long ${"z".repeat(600)}`,
					payloadJson: { payload: { ok: false, evidence: [] } },
				},
			],
			[
				{
					eventType: "tool_result",
					message: "success",
					payloadJson: { payload: { ok: true } },
				},
			],
		);

		const result = await loadConversationContextSource({
			taskId: "task-1",
			runId: "run-full",
		});
		expect(result.task.repositoryPath).toBe("/repo");
		expect(result.messages).toEqual([
			expect.objectContaining({ id: "message-1", content: "hello" }),
		]);
		expect(result.previousSnapshot).toEqual(
			expect.objectContaining({ id: "snapshot-previous" }),
		);
		expect(result.runs[0]?.lastToolFailure).toEqual(
			expect.stringContaining("command failed"),
		);
		expect(result.runs[0]).toMatchObject({
			lastWorkerEvidence: {
				recoveryDirective: {
					kind: "retry",
					targetPath: "src/a.ts",
					reason: "retry carefully",
					maxRepeats: 2,
				},
				targets: ["src/a.ts"],
			},
		});
		expect(
			result.runs[0]?.lastWorkerEvidence?.criticalEvidence[0]?.reason,
		).toHaveLength(300);
		expect(result.runs[1]).toMatchObject({
			lastWorkerEvidence: {
				recoveryDirective: {
					kind: "ask_user",
					reason: "Recover from the previous worker tool failure.",
				},
				targets: [],
			},
		});
		expect(result.runs[2]?.lastToolFailure).toHaveLength(500);
		expect(result.runs[3]).toMatchObject({
			lastToolFailure: null,
			lastWorkerEvidence: null,
		});
	});

	it("limits worker evidence lookup to the newest eight runs", async () => {
		const runs = Array.from({ length: 10 }, (_, index) => run(`run-${index}`));
		mocks.state.selectResults.push(
			[{ id: "task", repositoryPath: "/repo" }],
			[],
			[],
			runs,
			...Array.from({ length: 8 }, () => []),
		);
		const result = await loadConversationContextSource({ taskId: "task" });
		expect(result.runs).toHaveLength(10);
		expect(mocks.selectLimit).toHaveBeenCalledTimes(10);
	});

	it("returns the latest snapshot or null", async () => {
		mocks.state.selectResults.push([snapshotRow("latest")], []);
		await expect(
			getLatestConversationContextForTask("task-1"),
		).resolves.toEqual(expect.objectContaining({ id: "latest" }));
		await expect(
			getLatestConversationContextForTask("task-1"),
		).resolves.toBeNull();
	});

	it("updates the run-scoped snapshot when one already exists", async () => {
		const updated = snapshotRow("updated");
		mocks.state.selectResults.push([{ id: "existing" }]);
		mocks.state.updateResults.push([updated]);
		const result = await upsertConversationContextSnapshot({
			taskId: "task-1",
			runId: "run-1",
			snapshot: snapshot() as never,
			stateCardText: "card",
		});
		expect(result.id).toBe("updated");
		expect(mocks.updateSet).toHaveBeenCalledWith(
			expect.objectContaining({ runId: "run-1", sourceRunId: "run-1" }),
		);
	});

	it.each([
		null,
		undefined,
		"run-new",
	])("inserts a snapshot when run id is %s", async (runId) => {
		if (runId) mocks.state.selectResults.push([]);
		mocks.state.insertResults.push([
			snapshotRow(`inserted-${runId ?? "none"}`),
		]);
		const result = await upsertConversationContextSnapshot({
			taskId: "task-1",
			runId,
			snapshot: snapshot() as never,
			stateCardText: "card",
		});
		expect(result.id).toBe(`inserted-${runId ?? "none"}`);
		expect(mocks.insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				runId: runId ?? null,
				createdAt: expect.any(Date),
			}),
		);
	});
});

function run(id: string) {
	return {
		id,
		status: "failed",
		summary: null,
		finalReport: null,
		finalJudgment: null,
		contextSnapshot: null,
		startedAt: new Date("2026-01-01"),
		finishedAt: null,
		endedAt: null,
	};
}

function snapshotRow(id: string) {
	return {
		id,
		taskId: "task-1",
		runId: "run-1",
		version: 1,
		jobType: "coding",
		latestUserMessageId: "message-1",
		previousRunId: null,
		terminalState: null,
		tokenEstimate: 10,
		snapshotJson: snapshot(),
		stateCardText: "card",
		createdAt: new Date("2026-01-01"),
		updatedAt: new Date("2026-01-02"),
	};
}

function snapshot() {
	return {
		version: 1,
		task: { latestUserMessageId: "message-1" },
		classification: { jobType: "coding" },
		continuity: { previousRunId: null, previousTerminalState: null },
		limits: { tokenEstimate: 10 },
	};
}
