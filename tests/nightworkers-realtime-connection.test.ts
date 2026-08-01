import { afterEach, describe, expect, it, vi } from "vitest";
import type { CodingAgentCommandRequestV1 } from "../shared/modules/codingAgent";
import { NightWorkersRealtimeConnection } from "../src/modules/nightworkers/realtime/nightWorkersRealtimeConnection";

type Listener = (event: { data?: string }) => void;

class FakeWebSocket {
	static readonly OPEN = 1;
	static instances: FakeWebSocket[] = [];
	readonly listeners = new Map<string, Listener[]>();
	readyState = 0;

	constructor(public readonly url: string) {
		FakeWebSocket.instances.push(this);
	}

	addEventListener(type: string, listener: Listener) {
		this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
	}

	send() {}

	close() {
		if (FakeWebSocket.instances[0] === this && this.readyState === 0)
			throw new Error("connecting socket cannot close");
		this.readyState = 3;
		this.emit("close");
	}

	emit(type: string, event: { data?: string } = {}) {
		for (const listener of this.listeners.get(type) ?? []) listener(event);
	}
}

const request: CodingAgentCommandRequestV1 = {
	version: 1,
	type: "coding_agent.command.execute",
	requestId: "00000000-0000-4000-8000-000000000001",
	idempotencyKey: "00000000-0000-4000-8000-000000000001",
	taskId: "00000000-0000-4000-8000-000000000002",
	actionId: "run.implementation.start",
	expectedTaskRevision: 1,
	arguments: {},
};

function connection(fallbackUrl: string | null = null) {
	return new NightWorkersRealtimeConnection({
		primaryUrl: "ws://primary.test/ws",
		fallbackUrl,
		onMessage: vi.fn(),
	});
}

describe("NightWorkersRealtimeConnection", () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		FakeWebSocket.instances = [];
	});

	it("connects to the fallback even when a connecting primary cannot close", () => {
		vi.useFakeTimers();
		vi.stubGlobal("WebSocket", FakeWebSocket);
		const realtime = connection("ws://fallback.test/ws");

		realtime.start();
		vi.advanceTimersByTime(0);
		expect(FakeWebSocket.instances.map((socket) => socket.url)).toEqual([
			"ws://primary.test/ws",
		]);
		vi.advanceTimersByTime(1_500);
		expect(FakeWebSocket.instances.map((socket) => socket.url)).toEqual([
			"ws://primary.test/ws",
			"ws://fallback.test/ws",
		]);

		realtime.dispose();
	});

	it("rejects duplicate pending command request ids", async () => {
		vi.useFakeTimers();
		vi.stubGlobal("WebSocket", FakeWebSocket);
		const realtime = connection();
		realtime.start();
		vi.advanceTimersByTime(0);
		const socket = FakeWebSocket.instances[0];
		if (!socket) throw new Error("WebSocket was not created");
		socket.readyState = FakeWebSocket.OPEN;
		socket.emit("open");

		const first = realtime.requestCodingAgentCommand(request, 10_000);
		const firstRejection = expect(first).rejects.toThrow("disposed");
		await expect(
			realtime.requestCodingAgentCommand(request, 10_000),
		).rejects.toThrow("already pending");
		realtime.dispose();
		await firstRejection;
	});
});
