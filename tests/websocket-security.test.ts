import type http from "node:http";
import { serve } from "@hono/node-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import app, { nodeWebSocket } from "../api/app";
import {
	isAllowedNightWorkersWebSocketOrigin,
	NIGHTWORKERS_WS_INVALID_PAYLOAD_CODE,
	NIGHTWORKERS_WS_INVALID_PAYLOAD_MESSAGE,
	NIGHTWORKERS_WS_MAX_CHAT_PROMPT_LENGTH,
	NIGHTWORKERS_WS_MAX_MESSAGE_BYTES,
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
	it("accepts an explicitly allowed Origin", async () => {
		const socket = connect(allowedOrigin);
		await waitForOpen(socket);
		expect(socket.readyState).toBe(WebSocket.OPEN);
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

	it("limits chat_submit.prompt length in the client message contract", () => {
		const taskId = "00000000-0000-4000-8000-000000000000";
		expect(
			nightWorkersWsClientMessageSchema.safeParse({
				type: "chat_submit",
				taskId,
				prompt: "x".repeat(NIGHTWORKERS_WS_MAX_CHAT_PROMPT_LENGTH),
			}).success,
		).toBe(true);
		expect(
			nightWorkersWsClientMessageSchema.safeParse({
				type: "chat_submit",
				taskId,
				prompt: "x".repeat(NIGHTWORKERS_WS_MAX_CHAT_PROMPT_LENGTH + 1),
			}).success,
		).toBe(false);
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

	it("keeps a maximum-length prompt within the message byte budget", () => {
		const payload = JSON.stringify({
			type: "chat_submit",
			taskId: "00000000-0000-4000-8000-000000000000",
			prompt: "\ud800".repeat(NIGHTWORKERS_WS_MAX_CHAT_PROMPT_LENGTH),
		});

		expect(Buffer.byteLength(payload, "utf8")).toBeLessThanOrEqual(
			NIGHTWORKERS_WS_MAX_MESSAGE_BYTES,
		);
	});

	it("rejects an oversized chat_submit.prompt without processing it", async () => {
		const socket = connect(allowedOrigin);
		await waitForOpen(socket);
		const response = new Promise<{
			type?: string;
			code?: string;
			message?: string;
		}>((resolve) => {
			socket.on("message", (data) => {
				const parsed = JSON.parse(data.toString()) as {
					type?: string;
					code?: string;
					message?: string;
				};
				if (parsed.type === "error") resolve(parsed);
			});
		});
		socket.send(
			JSON.stringify({
				type: "chat_submit",
				taskId: "00000000-0000-4000-8000-000000000000",
				prompt: "x".repeat(NIGHTWORKERS_WS_MAX_CHAT_PROMPT_LENGTH + 1),
			}),
		);

		await expect(response).resolves.toMatchObject({
			type: "error",
			code: NIGHTWORKERS_WS_INVALID_PAYLOAD_CODE,
			message: NIGHTWORKERS_WS_INVALID_PAYLOAD_MESSAGE,
		});
		socket.close();
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
