import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
	selectResults: [] as unknown[][],
	insertResults: [] as unknown[][],
	updateResults: [] as unknown[][],
	inserted: [] as unknown[],
	updated: [] as unknown[],
	readReceipt: vi.fn(),
}));

vi.mock("../api/db/client", () => {
	function select() {
		const rows = harness.selectResults.shift() ?? [];
		type Terminal = Promise<unknown[]> & {
			limit: (count: number) => Promise<unknown[]>;
			orderBy: (...values: unknown[]) => Terminal;
		};
		const terminal = Promise.resolve(rows) as Terminal;
		terminal.limit = vi.fn(async () => rows);
		terminal.orderBy = vi.fn(() => terminal);
		const query = {
			from: vi.fn(),
			where: vi.fn(() => terminal),
		};
		query.from.mockReturnValue(query);
		return query;
	}

	function insert() {
		return {
			values: vi.fn((value: unknown) => {
				harness.inserted.push(value);
				return {
					returning: vi.fn(async () => harness.insertResults.shift() ?? []),
				};
			}),
		};
	}

	function update() {
		return {
			set: vi.fn((value: unknown) => {
				harness.updated.push(value);
				return {
					where: vi.fn(() => ({
						returning: vi.fn(async () => harness.updateResults.shift() ?? []),
					})),
				};
			}),
		};
	}

	const fakeDb = {
		select: vi.fn(select),
		insert: vi.fn(insert),
		update: vi.fn(update),
		transaction: vi.fn(),
	};
	fakeDb.transaction.mockImplementation(
		async (callback: (transaction: typeof fakeDb) => unknown) =>
			callback(fakeDb),
	);
	return { db: fakeDb };
});

vi.mock("../api/modules/commandDelivery", () => ({
	readTaskOperatorCommandReceipt: harness.readReceipt,
}));

import {
	claimMissionPilotActionExecution,
	completeMissionPilotActionExecution,
	createMissionPilotActionExecutionIntent,
	digestArguments,
	getLatestSucceededMissionPilotImplementationRunId,
	getMissionPilotActionExecutionByToolCall,
	listMissionPilotActionExecutionReceipts,
	MissionPilotActionExecutionConflictError,
	reconcileMissionPilotActionExecutionReceipts,
} from "../api/modules/missionPilot/persistence/agent/action-execution.repository";

type Receipt = {
	id: string;
	sessionId: string;
	taskId: string;
	actionId: string;
	idempotencyKey: string;
	status: "executing" | "outcome_unknown";
};

const intentInput = {
	sessionId: "session-1",
	taskId: "task-1",
	toolCallId: "tool-1",
	actionId: "task.update",
	idempotencyKey: "key-1",
	arguments: { nested: { z: 1, a: [true, null] } },
	expectedTaskRevision: null,
};

function receipt(
	id: string,
	actionId: string,
	status: Receipt["status"] = "executing",
): Receipt {
	return {
		id,
		sessionId: "session-1",
		taskId: "task-1",
		actionId,
		idempotencyKey: `key-${id}`,
		status,
	};
}

function deliveryFor(
	value: Receipt,
	status: string,
	result: unknown = null,
	failure: unknown = null,
) {
	return {
		id: `command-${value.id}`,
		taskId: value.taskId,
		actionId: value.actionId,
		idempotencyKey: value.idempotencyKey,
		status,
		result,
		failure,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	harness.selectResults.length = 0;
	harness.insertResults.length = 0;
	harness.updateResults.length = 0;
	harness.inserted.length = 0;
	harness.updated.length = 0;
	harness.readReceipt.mockResolvedValue(null);
});

describe("action execution repository extra coverage", () => {
	it("canonicalizes nested arguments and creates a pending intent", async () => {
		expect(digestArguments({ b: [2, { z: null, a: false }], a: "value" })).toBe(
			digestArguments({ a: "value", b: [2, { a: false, z: null }] }),
		);
		expect(digestArguments([1, 2])).not.toBe(digestArguments([2, 1]));

		const created = { id: "created", status: "pending" };
		harness.selectResults.push([], []);
		harness.insertResults.push([created]);
		await expect(
			createMissionPilotActionExecutionIntent(intentInput),
		).resolves.toBe(created);
		expect(harness.inserted).toHaveLength(1);
		expect(harness.inserted[0]).toMatchObject({
			sessionId: "session-1",
			taskId: "task-1",
			toolCallId: "tool-1",
			actionId: "task.update",
			expectedTaskRevision: null,
			status: "pending",
		});
	});

	it("reuses matching and equivalent intents but rejects every conflicting identity", async () => {
		const argumentsDigest = digestArguments({
			arguments: intentInput.arguments,
			expectedTaskRevision: null,
		});
		const existing = {
			id: "existing",
			argumentsDigest,
			actionId: intentInput.actionId,
			toolCallId: intentInput.toolCallId,
		};
		harness.selectResults.push([existing]);
		await expect(
			createMissionPilotActionExecutionIntent(intentInput),
		).resolves.toBe(existing);

		for (const conflict of [
			{ ...existing, argumentsDigest: "different" },
			{ ...existing, actionId: "task.archive" },
			{ ...existing, toolCallId: "other-tool" },
		]) {
			harness.selectResults.push([conflict]);
			await expect(
				createMissionPilotActionExecutionIntent(intentInput),
			).rejects.toMatchObject({
				name: "MissionPilotActionExecutionConflictError",
				code: "MISSION_PILOT_ACTION_IDEMPOTENCY_CONFLICT",
			});
		}

		const equivalent = { id: "equivalent" };
		harness.selectResults.push([], [equivalent]);
		await expect(
			createMissionPilotActionExecutionIntent(intentInput),
		).resolves.toBe(equivalent);
		expect(
			new MissionPilotActionExecutionConflictError("custom conflict").message,
		).toBe("custom conflict");
	});

	it("returns optional lookup values and lists all receipts", async () => {
		const found = { id: "found" };
		const listed = [{ id: "one" }, { id: "two" }];
		harness.selectResults.push(
			[found],
			[],
			[{ sourceResourceId: "run-1" }],
			[{ sourceResourceId: null }],
			listed,
		);
		await expect(
			getMissionPilotActionExecutionByToolCall("session-1", "tool-1"),
		).resolves.toBe(found);
		await expect(
			getMissionPilotActionExecutionByToolCall("session-1", "missing"),
		).resolves.toBeNull();
		await expect(
			getLatestSucceededMissionPilotImplementationRunId("session-1"),
		).resolves.toBe("run-1");
		await expect(
			getLatestSucceededMissionPilotImplementationRunId("session-1"),
		).resolves.toBeNull();
		await expect(
			listMissionPilotActionExecutionReceipts("session-1"),
		).resolves.toEqual(listed);
	});

	it("claims and completes executions across success, failure, and CAS misses", async () => {
		const claimed = { id: "claim", status: "executing" };
		const succeeded = { id: "success", status: "succeeded" };
		const failed = { id: "failure", status: "failed" };
		harness.updateResults.push([claimed], [], [succeeded], [failed], []);

		await expect(claimMissionPilotActionExecution("claim")).resolves.toBe(
			claimed,
		);
		await expect(
			claimMissionPilotActionExecution("lost-race"),
		).resolves.toBeNull();
		await expect(
			completeMissionPilotActionExecution({ id: "success", result: undefined }),
		).resolves.toBe(succeeded);
		await expect(
			completeMissionPilotActionExecution({
				id: "failure",
				result: { ignored: true },
				failure: {
					kind: "permission",
					retryable: false,
					providerCode: null,
					httpStatus: null,
					message: "denied",
					retryAfterMs: null,
					attempt: 1,
					actionId: "task.update",
					idempotencyKey: "key",
					currentTaskRevision: null,
					details: null,
				},
				sourceResourceType: "task",
				sourceResourceId: "task-1",
			}),
		).resolves.toBe(failed);
		await expect(
			completeMissionPilotActionExecution({
				id: "missing",
				status: "outcome_unknown",
			}),
		).resolves.toBeNull();

		expect(harness.updated).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					status: "succeeded",
					resultJson: null,
					failureJson: null,
					sourceResourceType: null,
					sourceResourceId: null,
				}),
				expect.objectContaining({
					status: "failed",
					resultJson: null,
					sourceResourceType: "task",
					sourceResourceId: "task-1",
				}),
			]),
		);
	});

	it("reconciles every succeeded resource shape and serialization form", async () => {
		const cases = [
			{
				action: "run.implementation.start",
				result: { runId: "run-1", revision: 2.9 },
			},
			{
				action: "task.queue.add",
				result: { data: { id: "queue-1" }, revision: -1 },
			},
			{
				action: "task.message.send",
				result: { data: { taskId: "message-1" }, revision: "3" },
			},
			{
				action: "questionnaire.submit",
				result: { data: { runId: "questionnaire-1" } },
			},
			{
				action: "plan.artifact.update",
				result: { id: "artifact-1", revision: 4 },
			},
			{ action: "git.commit", result: { data: { id: "git-1" } } },
			{ action: "task.update", result: { taskId: "task-2" } },
			{ action: "custom.action", result: ["not", "a", "record"] },
			{
				action: "custom.stored",
				result: {
					receipt: {
						commandId: "stored-command",
						actionId: "custom.stored",
						operationRef: { id: "stored-resource" },
					},
					data: { ok: true },
				},
			},
		];
		const receipts = cases.map((value, index) =>
			receipt(`success-${index}`, value.action),
		);
		const deliveries = new Map(
			receipts.map((value, index) => [
				value.idempotencyKey,
				deliveryFor(value, "succeeded", cases[index]?.result),
			]),
		);
		harness.readReceipt.mockImplementation(async ({ idempotencyKey }) =>
			deliveries.get(idempotencyKey),
		);
		harness.selectResults.push(receipts, [{ id: "final" }]);

		await expect(
			reconcileMissionPilotActionExecutionReceipts("session-1"),
		).resolves.toEqual([{ id: "final" }]);
		expect(harness.updated.map((value) => value.sourceResourceType)).toEqual([
			"task_run",
			"implementation_queue_entry",
			"task_message",
			"questionnaire",
			"artifact",
			"git_operation",
			"task",
			"task_operator_resource",
			"task_operator_resource",
		]);
		expect(harness.updated[0]).toMatchObject({
			resultJson: {
				receipt: {
					operationRef: { kind: "run", id: "run-1", revision: 2 },
				},
			},
			sourceResourceId: "run-1",
		});
		expect(harness.updated[1]).toMatchObject({
			resultJson: {
				receipt: {
					operationRef: { kind: "queue", id: "queue-1", revision: 0 },
				},
			},
		});
		expect(harness.updated[2]).toMatchObject({
			resultJson: {
				receipt: { operationRef: { kind: "task_message" } },
			},
		});
		expect(harness.updated[3]).toMatchObject({
			resultJson: {
				receipt: { operationRef: { kind: "questionnaire" } },
			},
		});
		expect(harness.updated[4]).toMatchObject({
			resultJson: { receipt: { operationRef: { kind: "artifact" } } },
		});
		expect(harness.updated[5]).toMatchObject({
			resultJson: {
				receipt: { operationRef: { kind: "git_operation" } },
			},
		});
		expect(harness.updated[6]).toMatchObject({
			resultJson: { receipt: { operationRef: { kind: "task" } } },
		});
		expect(harness.updated[7]).toMatchObject({
			resultJson: { receipt: { operationRef: null, resourceRefs: [] } },
			sourceResourceId: null,
		});
		expect(harness.updated[8]).toMatchObject({
			resultJson: {
				receipt: {
					operationRef: { id: "stored-resource" },
					replayed: true,
				},
			},
			sourceResourceId: "stored-resource",
		});
	});

	it("maps delivered failure variants including invalid optional fields", async () => {
		const failures = [
			{
				kind: "revision_conflict",
				code: "REVISION",
				statusCode: 409,
				message: "stale",
				currentRevision: 7,
				details: { expected: 6 },
			},
			{ kind: "permission_denied", details: ["invalid"] },
			{ kind: "schema_validation", code: 123, statusCode: "400", message: 5 },
			{ kind: "internal" },
			{ kind: "domain_precondition" },
			null,
		];
		const receipts = failures.map((_, index) =>
			receipt(`failure-${index}`, "task.update"),
		);
		const deliveries = new Map(
			receipts.map((value, index) => [
				value.idempotencyKey,
				deliveryFor(value, "failed", null, failures[index]),
			]),
		);
		harness.readReceipt.mockImplementation(async ({ idempotencyKey }) =>
			deliveries.get(idempotencyKey),
		);
		harness.selectResults.push(receipts, []);

		await reconcileMissionPilotActionExecutionReceipts("session-1");
		expect(harness.updated.map((value) => value.failureJson.kind)).toEqual([
			"revision_conflict",
			"permission",
			"schema_validation",
			"outcome_unknown",
			"domain_precondition",
			"domain_precondition",
		]);
		expect(harness.updated[0]).toMatchObject({
			failureJson: {
				providerCode: "REVISION",
				httpStatus: 409,
				message: "stale",
				currentTaskRevision: 7,
				details: { expected: 6 },
			},
		});
		expect(harness.updated[1]).toMatchObject({
			failureJson: { details: null },
		});
		expect(harness.updated[2]).toMatchObject({
			failureJson: {
				providerCode: null,
				httpStatus: null,
				message: "Task Operator command delivery failed.",
				currentTaskRevision: null,
			},
		});
	});

	it("resets undelivered work and preserves already unknown outcomes", async () => {
		const receipts = [
			receipt("missing", "task.update"),
			receipt("pending", "task.update"),
			receipt("wrong-task", "task.update"),
			receipt("wrong-action", "task.update"),
			receipt("unexpected-status", "task.update"),
			receipt("already-unknown", "task.update", "outcome_unknown"),
		];
		const deliveries = new Map<string, unknown>([
			[
				receipts[1]?.idempotencyKey ?? "",
				deliveryFor(receipts[1] as Receipt, "pending"),
			],
			[
				receipts[2]?.idempotencyKey ?? "",
				{
					...deliveryFor(receipts[2] as Receipt, "succeeded"),
					taskId: "different-task",
				},
			],
			[
				receipts[3]?.idempotencyKey ?? "",
				{
					...deliveryFor(receipts[3] as Receipt, "failed"),
					actionId: "task.archive",
				},
			],
			[
				receipts[4]?.idempotencyKey ?? "",
				deliveryFor(receipts[4] as Receipt, "executing"),
			],
			[
				receipts[5]?.idempotencyKey ?? "",
				{
					...deliveryFor(receipts[5] as Receipt, "succeeded"),
					taskId: "different-task",
				},
			],
		]);
		harness.readReceipt.mockImplementation(
			async ({ idempotencyKey }) => deliveries.get(idempotencyKey) ?? null,
		);
		harness.selectResults.push(receipts, []);

		await reconcileMissionPilotActionExecutionReceipts("session-1");
		expect(harness.updated.map((value) => value.status)).toEqual([
			"pending",
			"pending",
			"outcome_unknown",
			"outcome_unknown",
			"outcome_unknown",
		]);
		expect(harness.updated[0]).toMatchObject({
			resultJson: null,
			failureJson: null,
			startedAt: null,
			finishedAt: null,
		});
		expect(harness.updated[2]).toMatchObject({
			failureJson: {
				kind: "outcome_unknown",
				actionId: "task.update",
				idempotencyKey: "key-wrong-task",
			},
		});
	});
});
