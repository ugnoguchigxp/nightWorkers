import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

const originalWindow = globalThis.window;

beforeEach(() => {
	vi.resetModules();
	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: {
			location: {
				protocol: "http:",
				host: "localhost:39174",
				hostname: "localhost",
			},
		},
	});
});

describe("api base helpers", () => {
	it("uses relative paths in browser dev mode", async () => {
		const { apiPath, wsPath } = await import("../src/lib/api-base");
		expect(apiPath("/api/health")).toBe("/api/health");
		expect(wsPath("/api/ws/nightworkers")).toBe(
			"ws://localhost:39174/api/ws/nightworkers",
		);
	});

	it("uses desktop injected API origin first", async () => {
		window.__NIGHTWORKERS_DESKTOP_CONFIG__ = {
			apiOrigin: "http://127.0.0.1:40200",
		};
		const { apiPath, wsPath } = await import("../src/lib/api-base");
		expect(apiPath("/api/health")).toBe("http://127.0.0.1:40200/api/health");
		expect(wsPath("/api/ws/nightworkers")).toBe(
			"ws://127.0.0.1:40200/api/ws/nightworkers",
		);
	});

	it("rewrites hono client requests to the injected desktop API origin at fetch time", async () => {
		const fetchMock = vi.fn(async () => new Response("[]", { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);

		const { client } = await import("../src/lib/api");
		window.__NIGHTWORKERS_DESKTOP_CONFIG__ = {
			apiOrigin: "http://127.0.0.1:40200",
		};

		await client.repositories.$get();

		expect(fetchMock).toHaveBeenCalled();
		expect(fetchMock.mock.calls[0]?.[0]?.toString()).toBe(
			"http://127.0.0.1:40200/api/repositories",
		);
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
});

afterAll(() => {
	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: originalWindow,
	});
});
