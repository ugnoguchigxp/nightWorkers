import crypto from "node:crypto";
import {
	missionPilotArtifactTrace,
	missionPilotThoughtTrace,
} from "@nightworkers/mission-pilot/backend";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import {
	enqueueActivityEvent,
	flushActivityEventQueue,
	listActivityEventsForTask,
	runEventToActivityText,
} from "../api/modules/nightworkers/nightworkers.activity.repository";
import * as repo from "../api/modules/nightworkers/nightworkers.repository";
import { codingAgentChatTrace } from "../api/modules/nightworkers/nightworkers.trace-provenance";

beforeAll(async () => {
	await ensureNightWorkersSchema();
});

describe("nightworkers activity repository", () => {
	it("uses the final model text instead of the generic event message", () => {
		const text = runEventToActivityText({
			eventType: "model.response_finished",
			message: "[Codex] Assistant message completed.",
			agentEventType: null,
			payload: {
				runEvent: {
					data: { text: "実装と検証が完了しました。" },
				},
			},
		});

		expect(text).toBe("実装と検証が完了しました。");
	});

	it("includes MCP tool arguments and error details in activity text", () => {
		const text = runEventToActivityText({
			eventType: "tool.call_finished",
			message: "[Codex] MCP tool finished: nightworkers.todo_list",
			agentEventType: null,
			payload: {
				payload: {
					toolName: "nightworkers.todo_list",
					status: "failed",
					arguments: {
						runId: "run-1",
						operation: "done",
						seq: 1,
					},
					error: "CURRENT_TODO_NOT_UNIQUE",
					result: {
						content: [
							{
								type: "text",
								text: '{"error":{"code":"CURRENT_TODO_NOT_UNIQUE"}}',
							},
						],
					},
				},
			},
		});

		expect(text).toContain("nightworkers.todo_list | failed");
		expect(text).toContain("args: runId=run-1 operation=done seq=1");
		expect(text).toContain("error: CURRENT_TODO_NOT_UNIQUE");
		expect(text).toContain("result: ");
	});

	it("snapshots queued payloads before asynchronous flush", async () => {
		const createdRepo = await repo.createRepository({
			name: `TEST: Activity Queue Snapshot ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: createdRepo.id,
			title: "TEST: Activity queue snapshot target",
			description: "Persist original queued payload",
			status: "draft",
		});
		const payload = {
			nested: {
				text: "before",
			},
		};

		enqueueActivityEvent({
			taskId: task.id,
			kind: "system.info",
			source: "system",
			text: "queued snapshot test",
			payloadJson: payload,
			dedupeKey: `snapshot:${crypto.randomUUID()}`,
		});
		payload.nested.text = "after";

		await flushActivityEventQueue();
		const events = await listActivityEventsForTask(task.id);
		const matched = events.find(
			(event) => event.text === "queued snapshot test",
		);

		expect(matched?.payloadJson).toEqual({
			nested: {
				text: "before",
			},
			traceProvenance: {
				owner: "system",
				channel: "internal",
				producer: { kind: "system" },
			},
		});
	});

	it("flushes large activity queues within SQLite's bind-variable limit", async () => {
		const createdRepo = await repo.createRepository({
			name: `TEST: Activity Queue Batch ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: createdRepo.id,
			title: "TEST: Activity queue batch target",
			description: "Persist a queue larger than one safe SQLite insert batch",
			status: "draft",
		});

		for (let index = 0; index < 64; index += 1) {
			enqueueActivityEvent({
				taskId: task.id,
				kind: "system.info",
				source: "system",
				text: `queued batch event ${index}`,
				dedupeKey: `batch:${task.id}:${index}`,
			});
		}

		await flushActivityEventQueue();
		const events = await listActivityEventsForTask(task.id);
		expect(
			events.filter((event) => event.text?.startsWith("queued batch event ")),
		).toHaveLength(64);
	});

	it("keeps Coding Agent chat, Mission Pilot thoughts, and artifacts disjoint", async () => {
		const createdRepo = await repo.createRepository({
			name: `TEST: Trace Channels ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: createdRepo.id,
			title: "TEST: Trace channel target",
			status: "draft",
		});
		await repo.createTaskMessage({
			taskId: task.id,
			role: "assistant",
			content: "coding-agent response",
			trace: codingAgentChatTrace(),
		});
		await repo.createTaskMessage({
			taskId: task.id,
			role: "assistant",
			content: "Mission Pilot artifact body",
			trace: missionPilotArtifactTrace({ sessionId: "pilot-session" }),
		});
		enqueueActivityEvent({
			taskId: task.id,
			kind: "runtime.decision",
			source: "mission_pilot",
			text: "Mission Pilot decision",
			trace: missionPilotThoughtTrace({ sessionId: "pilot-session" }),
		});

		await flushActivityEventQueue();
		const [
			chatEvents,
			pilotEvents,
			artifactEvents,
			chatMessages,
			artifactMessages,
		] = await Promise.all([
			listActivityEventsForTask(task.id, { traceChannel: "chat" }),
			listActivityEventsForTask(task.id, {
				traceChannel: "pilot_thought",
			}),
			listActivityEventsForTask(task.id, { traceChannel: "artifact" }),
			repo.listTaskMessages(task.id, { traceChannel: "chat" }),
			repo.listTaskMessages(task.id, { traceChannel: "artifact" }),
		]);
		expect(chatEvents.map((event) => event.text)).toContain(
			"coding-agent response",
		);
		expect(chatEvents.map((event) => event.text)).not.toContain(
			"Mission Pilot artifact body",
		);
		expect(chatEvents.map((event) => event.text)).not.toContain(
			"Mission Pilot decision",
		);
		expect(pilotEvents.map((event) => event.text)).toEqual([
			"Mission Pilot decision",
		]);
		expect(artifactEvents.map((event) => event.text)).toEqual([
			"Mission Pilot artifact body",
		]);
		expect(chatMessages.map((message) => message.content)).toEqual([
			"coding-agent response",
		]);
		expect(artifactMessages.map((message) => message.content)).toEqual([
			"Mission Pilot artifact body",
		]);
	});

	it("flushes queued activity before deleting its task", async () => {
		const createdRepo = await repo.createRepository({
			name: `TEST: Activity Delete Flush ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: createdRepo.id,
			title: "TEST: Activity delete flush target",
			description: "Delete only after the queued ledger entry is durable",
			status: "draft",
		});
		enqueueActivityEvent({
			taskId: task.id,
			kind: "system.info",
			source: "system",
			text: "queued before delete",
			dedupeKey: `delete:${task.id}`,
		});

		await expect(repo.deleteTask(task.id)).resolves.toMatchObject({
			id: task.id,
		});
		await expect(flushActivityEventQueue()).resolves.toBeUndefined();
	});

	it("flushes queued task activity before deleting its repository", async () => {
		const createdRepo = await repo.createRepository({
			name: `TEST: Repository Activity Delete Flush ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: createdRepo.id,
			title: "TEST: Repository activity delete flush target",
			description: "Drain task activity before repository cascade deletion",
			status: "draft",
		});
		enqueueActivityEvent({
			taskId: task.id,
			kind: "system.info",
			source: "system",
			text: "queued before repository delete",
			dedupeKey: `repository-delete:${task.id}`,
		});

		await expect(repo.deleteRepository(createdRepo.id)).resolves.toMatchObject({
			id: createdRepo.id,
		});
		await expect(flushActivityEventQueue()).resolves.toBeUndefined();
	});
});
