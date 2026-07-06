import { describe, expect, it } from "vitest";
import * as repo from "../api/modules/nightworkers/nightworkers.repository";
import { NativeApiSessionStore } from "../api/services/agent-runtime/native-api-runner/native-api-session-store";

describe("NativeApiSessionStore", () => {
	it("persists native API turns and provider-native tool calls", async () => {
		const project = await repo.createRepository({
			name: `TEST: native api session ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: project.id,
			title: "TEST: native API session store",
			status: "running",
		});
		const run = await repo.createTaskRun({
			taskId: task.id,
			repositoryId: project.id,
			workerKind: "native-api-runner",
			status: "running",
			timeoutSeconds: 60,
		});
		const store = new NativeApiSessionStore();

		const turn = await store.createTurn({
			runId: run.id,
			taskId: task.id,
			turnIndex: 1,
			provider: "openai-compatible",
			model: "api-model",
			executionMode: "implementation",
			history: [{ type: "user", source: "user", content: "do the work" }],
		});
		const toolCall = await store.recordToolCallPending({
			runId: run.id,
			taskId: task.id,
			turnId: turn.id,
			toolCall: {
				id: "call-1",
				name: "read_current_specification",
				arguments: {},
			},
			todoSeq: 1,
		});

		await store.markToolCallRunning({ id: toolCall.id });
		await store.finishToolCall({
			id: toolCall.id,
			status: "completed",
			result: { ok: true, content: '{"ok":true}' },
		});
		await store.finishTurn({
			turnId: turn.id,
			status: "completed",
			history: [
				{ type: "user", source: "user", content: "do the work" },
				{
					type: "tool_result",
					toolCallId: "call-1",
					toolName: "read_current_specification",
					result: { ok: true, content: '{"ok":true}' },
				},
			],
			providerDebug: { providerEndpointId: "endpoint-1" },
		});

		const turns = await store.listTurns(run.id);
		const toolCalls = await store.listToolCalls(run.id);

		expect(turns).toHaveLength(1);
		expect(turns[0]).toMatchObject({
			runId: run.id,
			taskId: task.id,
			turnIndex: 1,
			status: "completed",
			provider: "openai-compatible",
			model: "api-model",
			executionMode: "implementation",
		});
		expect(toolCalls).toHaveLength(1);
		expect(toolCalls[0]).toMatchObject({
			runId: run.id,
			taskId: task.id,
			turnId: turn.id,
			toolCallId: "call-1",
			toolName: "read_current_specification",
			status: "completed",
			todoSeq: 1,
		});
	});

	it("compacts modelVisibleOutput defensively before persisting tool calls", async () => {
		const project = await repo.createRepository({
			name: `TEST: native api compact output ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: project.id,
			title: "TEST: native API compact output",
			status: "running",
		});
		const run = await repo.createTaskRun({
			taskId: task.id,
			repositoryId: project.id,
			workerKind: "native-api-runner",
			status: "running",
			timeoutSeconds: 60,
		});
		const store = new NativeApiSessionStore();
		const turn = await store.createTurn({
			runId: run.id,
			taskId: task.id,
			turnIndex: 1,
			history: [{ type: "user", source: "user", content: "do the work" }],
		});
		const toolCall = await store.recordToolCallPending({
			runId: run.id,
			taskId: task.id,
			turnId: turn.id,
			toolCall: {
				id: "call-large",
				name: "read_file",
				arguments: {},
			},
		});
		const fullOutput = [
			"start",
			...Array.from(
				{ length: 2000 },
				(_, index) => `verbose persisted output ${index}`,
			),
			"AssertionError: modelVisibleOutput must be compacted",
			...Array.from(
				{ length: 2000 },
				(_, index) => `tail persisted output ${index}`,
			),
		].join("\n");

		await store.finishToolCall({
			id: toolCall.id,
			status: "completed",
			result: { ok: true, content: fullOutput, payload: { fullOutput } },
			modelVisibleOutput: fullOutput,
		});

		const [record] = await store.listToolCalls(run.id);

		expect(record.modelVisibleOutput).toContain(
			"[model-visible-payload-compressed]",
		);
		expect(record.modelVisibleOutput).toContain(
			"modelVisibleOutput must be compacted",
		);
		expect(record.modelVisibleOutput).not.toBe(fullOutput);
		expect(String(record.modelVisibleOutput).length).toBeLessThan(
			fullOutput.length,
		);
		expect(record.resultJson).toMatchObject({
			ok: true,
			payload: { fullOutput },
		});
	});

	it("lists the latest completed previous turn as resumable history", async () => {
		const project = await repo.createRepository({
			name: `TEST: native api resume ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: project.id,
			title: "TEST: native API resume source",
			status: "running",
		});
		const previousRun = await repo.createTaskRun({
			taskId: task.id,
			repositoryId: project.id,
			workerKind: "native-api-runner",
			status: "completed",
			timeoutSeconds: 60,
		});
		const currentRun = await repo.createTaskRun({
			taskId: task.id,
			repositoryId: project.id,
			workerKind: "native-api-runner",
			status: "running",
			timeoutSeconds: 60,
		});
		const store = new NativeApiSessionStore();
		const failedTurn = await store.createTurn({
			runId: previousRun.id,
			taskId: task.id,
			turnIndex: 1,
			provider: "openai",
			model: "failed-model",
			executionMode: "implementation",
			history: [{ type: "user", source: "user", content: "failed source" }],
		});
		await store.finishTurn({
			turnId: failedTurn.id,
			status: "failed",
			history: [{ type: "user", source: "user", content: "failed source" }],
		});
		const crossModeTurn = await store.createTurn({
			runId: previousRun.id,
			taskId: task.id,
			turnIndex: 2,
			provider: "openai",
			model: "api-model",
			executionMode: "planning",
			history: [
				{ type: "user", source: "user", content: "planning request" },
				{ type: "assistant", content: "planning answer" },
			],
		});
		await store.finishTurn({
			turnId: crossModeTurn.id,
			status: "completed",
			history: [
				{ type: "user", source: "user", content: "planning request" },
				{ type: "assistant", content: "planning answer" },
			],
		});
		const completedTurn = await store.createTurn({
			runId: previousRun.id,
			taskId: task.id,
			turnIndex: 3,
			provider: "openai",
			model: "api-model",
			executionMode: "implementation",
			history: [
				{ type: "user", source: "user", content: "previous request" },
				{ type: "assistant", content: "previous answer" },
			],
		});
		await store.finishTurn({
			turnId: completedTurn.id,
			status: "completed",
			history: [
				{ type: "user", source: "user", content: "previous request" },
				{ type: "assistant", content: "previous answer" },
			],
		});

		const resumable = await store.getLatestCompletedTurnForPreviousRun({
			taskId: task.id,
			runId: currentRun.id,
			provider: "openai",
			model: "api-model",
			executionMode: "implementation",
		});

		expect(resumable).toMatchObject({
			id: completedTurn.id,
			runId: previousRun.id,
			taskId: task.id,
			status: "completed",
		});
		expect(resumable?.historyJson).toEqual([
			{ type: "user", source: "user", content: "previous request" },
			{ type: "assistant", content: "previous answer" },
		]);
		await expect(
			store.getLatestCompletedTurnForPreviousRun({
				taskId: task.id,
				runId: currentRun.id,
				provider: "openai",
				model: "different-model",
				executionMode: "implementation",
			}),
		).resolves.toBeNull();
		await expect(
			store.getLatestCompletedTurnForPreviousRun({
				taskId: task.id,
				runId: currentRun.id,
				provider: "openai",
				model: "api-model",
				executionMode: "review",
			}),
		).resolves.toBeNull();
	});
});
