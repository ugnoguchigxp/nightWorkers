import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Reset state between tests (isRefreshing, apiAuthRequiredCache)
// Note: We can import actual or re-import the module to clear state
// To avoid pollution, we can use a custom import block, but since the module
// exports 'client' which keeps global variables, we may need to manipulate them.
// Let's look at src/lib/api.ts again:
// let isRefreshing = false;
// let apiAuthRequiredCache: boolean | null = null;
// To clear cache, we can dynamically import or clear the module registry.
// Vitest resetModules helps, but it only resets vi.doMock states.
// To clear local state in 'api.ts', we can use vi.resetModules() and then import client dynamically in each test.

describe("lib/api client customFetch integration", () => {
	let windowLocation: { pathname: string; href: string } = {
		pathname: "/",
		href: "http://localhost:3000/",
	};

	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		windowLocation = {
			pathname: "/",
			href: "http://localhost:3000/",
		};
		vi.stubGlobal("window", {
			location: windowLocation,
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("passes normal 200 requests through", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ data: "ok" }), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);
		vi.stubGlobal("fetch", fetchMock);

		// Dynamic import to get fresh client with clean cache state
		const { client: freshClient } = await import("../src/lib/api");

		const res = await freshClient.projects.$get();
		expect(fetchMock).toHaveBeenCalled();
		expect(res.status).toBe(200);
	});

	it("rewrites Request/URL inputs using rewriteApiRequestInput", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(new Response("ok", { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);
		// Stub Request if not present in Node
		if (typeof global.Request === "undefined") {
			vi.stubGlobal(
				"Request",
				class Request {
					url: string;
					init?: RequestInit;
					constructor(url: string, init?: RequestInit) {
						this.url = url;
						this.init = init;
					}
				},
			);
		}

		const { client: freshClient } = await import("../src/lib/api");

		// Fetch with URL object
		await freshClient.index.$get();
		expect(fetchMock.mock.calls[0][0].toString()).toContain("/api");
	});

	it("does not refresh when auth is not required (401 from normal API)", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(new Response("401", { status: 401 })) // original request
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ apiAuthRequired: false }), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
			); // auth methods request
		vi.stubGlobal("fetch", fetchMock);

		const { client: freshClient } = await import("../src/lib/api");

		const res = await freshClient.projects.$get();
		expect(res.status).toBe(401);
		// verify methods was called
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("attempts refresh when auth is required and succeeds, retrying the original request", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(new Response("401", { status: 401 })) // original request 401
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ apiAuthRequired: true }), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
			) // auth methods request
			.mockResolvedValueOnce(new Response("ok", { status: 200 })) // auth refresh request POST
			.mockResolvedValueOnce(new Response("retry ok", { status: 200 })); // retried original request

		vi.stubGlobal("fetch", fetchMock);

		const { client: freshClient } = await import("../src/lib/api");

		const res = await freshClient.projects.$get();
		expect(res.status).toBe(200);
		expect(fetchMock).toHaveBeenCalledTimes(4);
	});

	it("redirects to login on failed refresh (HTTP not ok)", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(new Response("401", { status: 401 })) // original request 401
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ apiAuthRequired: true }), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
			) // auth methods request
			.mockResolvedValueOnce(new Response("failed", { status: 400 })); // auth refresh request fails

		vi.stubGlobal("fetch", fetchMock);

		const { client: freshClient } = await import("../src/lib/api");

		const res = await freshClient.projects.$get();
		expect(res.status).toBe(401);
		expect(windowLocation.href).toBe("/login");
	});

	it("redirects to login on failed refresh (network error / fetch throw)", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(new Response("401", { status: 401 })) // original request 401
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ apiAuthRequired: true }), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
			) // auth methods request
			.mockRejectedValueOnce(new Error("Network Error")); // auth refresh request throws

		vi.stubGlobal("fetch", fetchMock);

		const { client: freshClient } = await import("../src/lib/api");

		const res = await freshClient.projects.$get();
		expect(res.status).toBe(401);
		expect(windowLocation.href).toBe("/login");
	});

	it("queues overlapping requests while refreshing and resolves them after success", async () => {
		let resolveRefreshPromise: (value: Response) => void = () => {};
		const refreshPromise = new Promise<Response>((resolve) => {
			resolveRefreshPromise = resolve;
		});

		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(new Response("401", { status: 401 })) // req1 401
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ apiAuthRequired: true }), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
			) // auth methods request
			.mockImplementationOnce(() => refreshPromise) // refresh hangs until we resolve it
			.mockResolvedValueOnce(new Response("401", { status: 401 })) // req2 401 (since it starts overlap, gets 401 too)
			.mockResolvedValueOnce(new Response("req1 ok", { status: 200 })) // req1 retry
			.mockResolvedValueOnce(new Response("req2 ok", { status: 200 })); // req2 retry

		vi.stubGlobal("fetch", fetchMock);

		const { client: freshClient } = await import("../src/lib/api");

		// Start first request
		const p1 = freshClient.projects.$get();

		// Wait slightly to let it trigger methods & enter isRefreshing=true
		await new Promise((resolve) => setTimeout(resolve, 10));

		// Start second request during refresh
		const p2 = freshClient.projects.$get();

		// Wait to let req2 enter queue
		await new Promise((resolve) => setTimeout(resolve, 10));

		// Now resolve the refresh promise
		resolveRefreshPromise(new Response("ok", { status: 200 }));

		const [res1, res2] = await Promise.all([p1, p2]);
		expect(res1.status).toBe(200);
		expect(res2.status).toBe(200);
	});
});
