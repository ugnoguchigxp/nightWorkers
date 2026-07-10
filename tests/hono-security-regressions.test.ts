import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { afterEach, describe, expect, it } from "vitest";
import { setAuthCookies } from "../api/lib/auth-cookies";

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

describe("Hono security dependency regressions", () => {
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

	it("keeps authentication cookies HttpOnly and scoped", async () => {
		const app = new Hono();
		app.get("/", (context) => {
			setAuthCookies(context, {
				accessToken: "access-token",
				refreshToken: "refresh-token",
			});
			return context.text("ok");
		});

		const response = await app.request("/");
		const cookies = response.headers.getSetCookie().join("\n");

		expect(cookies).toContain("access_token=access-token");
		expect(cookies).toContain("refresh_token=refresh-token");
		expect(cookies).toContain("HttpOnly");
		expect(cookies).toContain("SameSite=Lax");
		expect(cookies).toContain("Path=/api/auth");
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
