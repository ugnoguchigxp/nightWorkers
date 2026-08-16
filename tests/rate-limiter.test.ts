import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { rateLimiter } from "../api/middleware/rate-limiter";
import {
	createNightWorkersWsMessageRateLimiter,
	NIGHTWORKERS_WS_MESSAGE_RATE_LIMIT,
	NIGHTWORKERS_WS_MESSAGE_RATE_WINDOW_MS,
} from "../api/security/nightworkers-websocket-policy";

describe("rateLimiter", () => {
	it("keeps each WebSocket connection in an independent fixed message window", () => {
		let now = 1_000;
		const first = createNightWorkersWsMessageRateLimiter({
			now: () => now,
		});
		const second = createNightWorkersWsMessageRateLimiter({
			now: () => now,
		});

		for (
			let index = 0;
			index < NIGHTWORKERS_WS_MESSAGE_RATE_LIMIT;
			index += 1
		) {
			expect(first.tryConsume()).toBe(true);
		}
		expect(first.tryConsume()).toBe(false);
		expect(second.tryConsume()).toBe(true);

		now += NIGHTWORKERS_WS_MESSAGE_RATE_WINDOW_MS - 1;
		expect(first.tryConsume()).toBe(false);
		now += 1;
		expect(first.tryConsume()).toBe(true);
	});

	it("uses a single global bucket when the direct socket is unavailable", async () => {
		const app = new Hono();
		app.use("/limited/*", rateLimiter({ windowMs: 60_000, limit: 1 }));
		app.get("/limited/ping", (c) => c.json({ ok: true }));

		const first = await app.request("/limited/ping", {
			headers: {
				"user-agent": "ua-a",
			},
		});
		expect(first.status).toBe(200);

		const second = await app.request("/limited/ping", {
			headers: {
				"user-agent": "ua-b",
			},
		});
		expect(second.status).toBe(429);
	});

	it("ignores forwarded client IP headers", async () => {
		const app = new Hono();
		app.use("/limited/*", rateLimiter({ windowMs: 60_000, limit: 1 }));
		app.get("/limited/ping", (c) => c.json({ ok: true }));

		const first = await app.request("/limited/ping", {
			headers: {
				"x-forwarded-for": "203.0.113.10",
			},
		});
		expect(first.status).toBe(200);

		const second = await app.request("/limited/ping", {
			headers: {
				"x-forwarded-for": "198.51.100.25",
			},
		});
		expect(second.status).toBe(429);
	});
});
