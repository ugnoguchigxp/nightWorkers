import { describe, expect, it } from "vitest";
import { NightWorkersRealtimeBroker } from "../api/services/realtime/nightworkers-ws";

function createSocket() {
	const sent: unknown[] = [];
	const socket = {
		OPEN: 1,
		readyState: 1,
		send: (wire: string) => {
			sent.push(JSON.parse(wire));
		},
	};
	return { socket: socket as never, sent };
}

describe("NightWorkersRealtimeBroker", () => {
	it("replays recent LLM deltas published before subscription", () => {
		const broker = new NightWorkersRealtimeBroker();
		const taskId = "00000000-0000-4000-8000-000000000001";
		const { socket, sent } = createSocket();

		broker.publish(taskId, {
			type: "task_llm_delta",
			payload: { text: "hello " },
		});
		broker.publish(taskId, {
			type: "task_llm_delta",
			payload: { text: "world" },
		});

		broker.subscribe(taskId, socket);
		const replayed = broker.replayRecent(taskId, socket);

		expect(replayed).toBe(2);
		expect(sent.map((message) => message.payload.text)).toEqual([
			"hello ",
			"world",
		]);
		expect(sent.map((message) => message.replayed)).toEqual([true, true]);
		expect(sent.map((message) => message.seq)).toEqual([1, 2]);
		expect(sent.every((message) => typeof message.timestamp === "string")).toBe(
			true,
		);
	});

	it("does not replay non-replayable direct messages", () => {
		const broker = new NightWorkersRealtimeBroker();
		const taskId = "00000000-0000-4000-8000-000000000002";
		const { socket, sent } = createSocket();

		broker.publish(taskId, {
			type: "task_message_created",
			payload: { message: { id: "message-1" } },
		});

		broker.subscribe(taskId, socket);
		const replayed = broker.replayRecent(taskId, socket);

		expect(replayed).toBe(0);
		expect(sent).toEqual([]);
	});

	it("publishes live messages with sequence metadata for frontend dedupe", () => {
		const broker = new NightWorkersRealtimeBroker();
		const taskId = "00000000-0000-4000-8000-000000000003";
		const { socket, sent } = createSocket();

		broker.subscribe(taskId, socket);
		broker.publish(taskId, {
			type: "task_llm_delta",
			payload: { text: "live" },
		});

		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({
			type: "task_llm_delta",
			taskId,
			seq: 1,
			payload: { text: "live" },
		});
		expect(typeof sent[0].timestamp).toBe("string");
	});

	it("replays Questionnaire state changes after reconnect", () => {
		const broker = new NightWorkersRealtimeBroker();
		const taskId = "00000000-0000-4000-8000-000000000004";
		const { socket, sent } = createSocket();

		broker.publish(taskId, {
			type: "questionnaire.state_changed",
			payload: {
				taskId,
				questionnaireSessionId: "00000000-0000-4000-8000-000000000104",
				status: "review_ready",
				revision: 2,
				stateDigest: "a".repeat(64),
			},
		});
		broker.subscribe(taskId, socket);

		expect(broker.replayRecent(taskId, socket)).toBe(1);
		expect(sent[0]).toMatchObject({
			type: "questionnaire.state_changed",
			taskId,
			replayed: true,
		});
	});
});
