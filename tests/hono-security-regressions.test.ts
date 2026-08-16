import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { afterEach, describe, expect, it } from "vitest";
import { errorHandler } from "../api/middleware/error-handler";
import {
	NIGHTWORKERS_API_MAX_BODY_BYTES,
	NIGHTWORKERS_REQUEST_BODY_COMPACTION_CHUNK_COUNT,
	nightworkersRequestBodyLimit,
	readBodyWithinLimit,
} from "../api/security/nightworkers-request-policy";

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

describe("Hono security dependency regressions", () => {
	it("compacts highly fragmented request bodies before rehydrating them", async () => {
		const chunkCount = NIGHTWORKERS_REQUEST_BODY_COMPACTION_CHUNK_COUNT * 2 + 1;
		const chunks = await readBodyWithinLimit(
			new ReadableStream<Uint8Array>({
				start(controller) {
					for (let index = 0; index < chunkCount; index += 1) {
						controller.enqueue(new Uint8Array([index % 251]));
					}
					controller.close();
				},
			}),
		);

		expect(chunks).toHaveLength(3);
		expect(Buffer.concat(chunks)).toHaveLength(chunkCount);
	});

	it("rejects an under-declared streamed API request before its route handler", async () => {
		let handlerReached = false;
		const app = new Hono();
		app.onError(errorHandler);
		app.use("/api/*", nightworkersRequestBodyLimit());
		app.post("/api/upload", (context) => {
			handlerReached = true;
			return context.text("unexpected");
		});
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new Uint8Array(NIGHTWORKERS_API_MAX_BODY_BYTES + 1));
				controller.close();
			},
		});

		const response = await app.fetch(
			new Request("http://localhost/api/upload", {
				method: "POST",
				headers: { "content-length": "1" },
				body,
				duplex: "half",
			} as RequestInit & { duplex: "half" }),
		);

		expect(response.status).toBe(413);
		expect(await response.json()).toMatchObject({
			error: { code: "REQUEST_BODY_TOO_LARGE" },
		});
		expect(handlerReached).toBe(false);
	}, 15_000);

	it("accepts a request containing the maximum supported five prompt images", async () => {
		const app = new Hono();
		app.use("/api/*", nightworkersRequestBodyLimit());
		app.post("/api/upload", async (context) => {
			const body = (await context.req.json()) as { images: unknown[] };
			return context.json({ received: body.images.length });
		});
		const prefix = "data:image/png;base64,";
		const image = `${prefix}${"A".repeat(5_100_000 - prefix.length)}`;
		const payload = JSON.stringify({
			images: Array.from({ length: 5 }, () => ({ dataUrl: image })),
		});
		expect(Buffer.byteLength(payload, "utf8")).toBeLessThan(
			NIGHTWORKERS_API_MAX_BODY_BYTES,
		);

		const response = await app.request("/api/upload", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: payload,
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ received: 5 });
	}, 15_000);

	it("does not reflect an unapproved CORS origin when credentials are enabled", async () => {
		const app = new Hono();
		app.use(
			"*",
			cors({
				origin: (origin) =>
					origin === "https://approved.example" ? origin : null,
				credentials: true,
			}),
		);
		app.get("/", (context) => context.text("ok"));

		const approved = await app.request("/", {
			headers: { Origin: "https://approved.example" },
		});
		const rejected = await app.request("/", {
			headers: { Origin: "https://attacker.example" },
		});

		expect(approved.headers.get("access-control-allow-origin")).toBe(
			"https://approved.example",
		);
		expect(rejected.headers.get("access-control-allow-origin")).toBeNull();
	});

	it("enforces body limits for streams without a Content-Length header", async () => {
		const app = new Hono();
		app.post("/upload", bodyLimit({ maxSize: 8 }), async (context) =>
			context.text(await context.req.text()),
		);
		const body = new ReadableStream({
			start(controller) {
				controller.enqueue(new TextEncoder().encode("123456789"));
				controller.close();
			},
		});
		const request = new Request("http://localhost/upload", {
			method: "POST",
			body,
			duplex: "half",
		} as RequestInit & { duplex: "half" });

		const response = await app.fetch(request);

		expect(response.status).toBe(413);
	});

	it("serves normal assets but rejects encoded Windows traversal paths", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "nightworkers-static-"));
		temporaryDirectories.push(root);
		fs.mkdirSync(path.join(root, "assets"), { recursive: true });
		fs.writeFileSync(path.join(root, "assets", "safe.txt"), "safe");
		fs.writeFileSync(path.join(root, "secret.txt"), "secret");
		const app = new Hono();
		app.use("/assets/*", serveStatic({ root }));

		const safe = await app.request("/assets/safe.txt");
		const traversal = await app.request("/assets/%5C..%5Csecret.txt");

		expect(safe.status).toBe(200);
		expect(await safe.text()).toBe("safe");
		expect(traversal.status).not.toBe(200);
	});
});
