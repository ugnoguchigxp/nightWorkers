import type http from "node:http";
import { serve } from "@hono/node-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import app, { nodeWebSocket } from "../api/app";
import {
	isAllowedNightWorkersWebSocketOrigin,
	NIGHTWORKERS_WS_INVALID_PAYLOAD_CODE,
	NIGHTWORKERS_WS_INVALID_PAYLOAD_MESSAGE,
	NIGHTWORKERS_WS_MAX_MESSAGE_BYTES,
	NIGHTWORKERS_WS_MESSAGE_RATE_LIMIT,
	NIGHTWORKERS_WS_RATE_LIMIT_CLOSE_CODE,
	NIGHTWORKERS_WS_RATE_LIMIT_CODE,
	nightWorkersWsClientMessageSchema,
	parseNightWorkersWsClientMessage,
} from "../api/security/nightworkers-websocket-policy";

const allowedOrigin = "http://localhost:39174";
let server: http.Server;
let webSocketUrl: string;

function connect(origin?: string) {
	return new WebSocket(webSocketUrl, origin ? { origin } : undefined);
}

function waitForOpen(socket: WebSocket) {
	return new Promise<void>((resolve, reject) => {
		socket.once("open", resolve);
		socket.once("error", reject);
	});
}

function waitForUnexpectedStatus(socket: WebSocket) {
	return new Promise<number>((resolve, reject) => {
		socket.once("unexpected-response", (_request, response) => {
			response.resume();
			resolve(response.statusCode ?? 0);
		});
		socket.once("open", () =>
			reject(new Error("WebSocket unexpectedly opened")),
		);
		socket.once("error", () => undefined);
	});
}

function waitForMessageCode(socket: WebSocket, code: string) {
	return new Promise<Record<string, unknown>>((resolve) => {
		const onMessage = (data: WebSocket.RawData) => {
			const parsed = JSON.parse(data.toString()) as Record<string, unknown>;
			if (parsed.code !== code) return;
			socket.off("message", onMessage);
			resolve(parsed);
		};
		socket.on("message", onMessage);
	});
}

beforeAll(async () => {
	server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
	nodeWebSocket.injectWebSocket(server);
	if (!server.listening) {
		await new Promise<void>((resolve) => server.once("listening", resolve));
	}
	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("Unable to resolve websocket test server address");
	}
	webSocketUrl = `ws://127.0.0.1:${address.port}/api/ws/nightworkers`;
});

afterAll(async () => {
	for (const socket of nodeWebSocket.wss.clients) socket.terminate();
	await new Promise<void>((resolve, reject) => {
		server.close((error) => (error ? reject(error) : resolve()));
	});
});

describe("NightWorkers WebSocket security", () => {
	it("closes only the connection that exceeds its message rate limit", async () => {
		const first = connect(allowedOrigin);
		const second = connect(allowedOrigin);
		await Promise.all([waitForOpen(first), waitForOpen(second)]);

		for (
			let index = 0;
			index < NIGHTWORKERS_WS_MESSAGE_RATE_LIMIT;
			index += 1
		) {
			const invalidMessage = waitForMessageCode(
				first,
				NIGHTWORKERS_WS_INVALID_PAYLOAD_CODE,
			);
			first.send("not-json");
			await expect(invalidMessage).resolves.toMatchObject({
				code: NIGHTWORKERS_WS_INVALID_PAYLOAD_CODE,
			});
		}
		const rateLimited = waitForMessageCode(
			first,
			NIGHTWORKERS_WS_RATE_LIMIT_CODE,
		);
		const firstClosed = new Promise<number>((resolve) => {
			first.once("close", (code) => resolve(code));
		});
		const secondError = waitForMessageCode(
			second,
			NIGHTWORKERS_WS_INVALID_PAYLOAD_CODE,
		);
		first.send("not-json");
		second.send("not-json");

		await expect(rateLimited).resolves.toMatchObject({
			code: NIGHTWORKERS_WS_RATE_LIMIT_CODE,
		});
		await expect(firstClosed).resolves.toBe(
			NIGHTWORKERS_WS_RATE_LIMIT_CLOSE_CODE,
		);
		await expect(secondError).resolves.toMatchObject({
			code: NIGHTWORKERS_WS_INVALID_PAYLOAD_CODE,
		});
		expect(second.readyState).toBe(WebSocket.OPEN);
		second.close();
	}, 15_000);

	it("accepts an explicitly allowed Origin", async () => {
		const socket = connect(allowedOrigin);
		const connected = new Promise<Record<string, unknown>>((resolve) => {
			socket.once("message", (data) => resolve(JSON.parse(data.toString())));
		});
		await waitForOpen(socket);
		expect(socket.readyState).toBe(WebSocket.OPEN);
		await expect(connected).resolves.toMatchObject({
			type: "connected",
			capabilities: ["coding_agent.command.v1"],
		});
		socket.close();
	});

	it("rejects an Origin outside the allowlist during upgrade", async () => {
		const socket = connect("https://attacker.example");
		await expect(waitForUnexpectedStatus(socket)).resolves.toBe(403);
	});

	it("rejects an upgrade without an Origin", async () => {
		const socket = connect();
		await expect(waitForUnexpectedStatus(socket)).resolves.toBe(403);
	});

	it("configures the WebSocket receiver message byte limit", () => {
		expect(nodeWebSocket.wss.options.maxPayload).toBe(
			NIGHTWORKERS_WS_MAX_MESSAGE_BYTES,
		);
	});

	it("closes a connection when a message exceeds the byte limit", async () => {
		const socket = connect(allowedOrigin);
		await waitForOpen(socket);
		const closed = new Promise<number>((resolve) => {
			socket.once("close", (code) => resolve(code));
		});
		const payload = "あ".repeat(
			Math.floor(NIGHTWORKERS_WS_MAX_MESSAGE_BYTES / 3) + 1,
		);
		expect(payload.length).toBeLessThan(NIGHTWORKERS_WS_MAX_MESSAGE_BYTES);
		expect(Buffer.byteLength(payload, "utf8")).toBeGreaterThan(
			NIGHTWORKERS_WS_MAX_MESSAGE_BYTES,
		);
		socket.send(payload);
		await expect(closed).resolves.toBe(1009);
	});

	it("accepts a text message exactly at the byte limit", async () => {
		const socket = connect(allowedOrigin);
		await waitForOpen(socket);
		const response = new Promise<{ type?: string; code?: string }>(
			(resolve) => {
				socket.on("message", (data) => {
					const parsed = JSON.parse(data.toString()) as {
						type?: string;
						code?: string;
					};
					if (parsed.type === "error") resolve(parsed);
				});
			},
		);
		const payload = "x".repeat(NIGHTWORKERS_WS_MAX_MESSAGE_BYTES);
		expect(Buffer.byteLength(payload, "utf8")).toBe(
			NIGHTWORKERS_WS_MAX_MESSAGE_BYTES,
		);
		socket.send(payload);

		await expect(response).resolves.toMatchObject({
			type: "error",
			code: NIGHTWORKERS_WS_INVALID_PAYLOAD_CODE,
		});
		expect(socket.readyState).toBe(WebSocket.OPEN);
		socket.close();
	});

	it("rejects binary messages because the protocol accepts JSON text only", async () => {
		const socket = connect(allowedOrigin);
		await waitForOpen(socket);
		const closed = new Promise<number>((resolve) => {
			socket.once("close", (code) => resolve(code));
		});
		socket.send(Buffer.from("{}"));

		await expect(closed).resolves.toBe(1003);
	});

	it("accepts the versioned Coding Agent command contract", () => {
		const taskId = "00000000-0000-4000-8000-000000000000";
		expect(
			nightWorkersWsClientMessageSchema.safeParse({
				version: 1,
				type: "coding_agent.command.execute",
				requestId: "00000000-0000-4000-8000-000000000001",
				idempotencyKey: "delivery-1",
				taskId,
				actionId: "run.implementation.start",
				expectedTaskRevision: 1,
				arguments: {},
			}).success,
		).toBe(true);
		expect(
			nightWorkersWsClientMessageSchema.safeParse({
				version: 1,
				type: "coding_agent.command.execute",
				requestId: "not-a-uuid",
				idempotencyKey: "delivery-1",
				taskId,
				actionId: "run.implementation.start",
				expectedTaskRevision: 1,
				arguments: {},
			}).success,
		).toBe(false);
	});

	it("returns the same typed command failure over WebSocket and REST", async () => {
		const request = {
			version: 1,
			type: "coding_agent.command.execute",
			requestId: "00000000-0000-4000-8000-000000000011",
			idempotencyKey: "delivery-missing-task",
			taskId: "00000000-0000-4000-8000-000000000012",
			actionId: "run.implementation.start",
			expectedTaskRevision: 1,
			arguments: {},
		};
		const socket = connect(allowedOrigin);
		await waitForOpen(socket);
		const websocketResult = new Promise<Record<string, unknown>>((resolve) => {
			socket.on("message", (data) => {
				const message = JSON.parse(data.toString()) as Record<string, unknown>;
				if (message.type === "coding_agent.command.result") resolve(message);
			});
		});
		socket.send(JSON.stringify(request));
		const restResponse = await app.request("/api/coding-agent/commands", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: allowedOrigin,
				"x-nightworkers-e2e": "1",
			},
			body: JSON.stringify(request),
		});
		expect(restResponse.status).toBe(404);
		expect(await websocketResult).toEqual(await restResponse.json());
		socket.close();
	});

	it("normalizes malformed JSON and schema failures to one typed error", () => {
		for (const payload of ["not-json", JSON.stringify({ type: "unknown" })]) {
			expect(() => parseNightWorkersWsClientMessage(payload)).toThrowError(
				expect.objectContaining({
					name: "NightWorkersWsInvalidPayloadError",
					code: NIGHTWORKERS_WS_INVALID_PAYLOAD_CODE,
					message: NIGHTWORKERS_WS_INVALID_PAYLOAD_MESSAGE,
				}),
			);
		}
	});

	it("matches origins exactly instead of trusting localhost-like strings", () => {
		expect(
			isAllowedNightWorkersWebSocketOrigin(allowedOrigin, [allowedOrigin]),
		).toBe(true);
		expect(
			isAllowedNightWorkersWebSocketOrigin(
				"http://localhost:39174.attacker.example",
				[allowedOrigin],
			),
		).toBe(false);
	});
});
