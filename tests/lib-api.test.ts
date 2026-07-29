import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("lib/api client customFetch integration", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		vi.stubGlobal("window", {
			location: {
				origin: "http://localhost:39174",
				pathname: "/",
				href: "http://localhost:39174/",
			},
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("passes successful API requests through once", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ data: "ok" }), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);
		vi.stubGlobal("fetch", fetchMock);

		const { client } = await import("../src/lib/api");
		const response = await client.projects.$get();

		expect(response.status).toBe(200);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("returns 401 without probing auth, refreshing, or redirecting", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(new Response("unauthorized", { status: 401 }));
		vi.stubGlobal("fetch", fetchMock);

		const { client } = await import("../src/lib/api");
		const response = await client.projects.$get();

		expect(response.status).toBe(401);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain("/api/auth");
		expect(window.location.href).toBe("http://localhost:39174/");
	});
});
