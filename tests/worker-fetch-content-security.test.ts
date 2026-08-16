import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchContentTool } from "../api/services/worker-tools/fetch-content";

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("fetch_content security regressions", () => {
	it("rejects a loopback URL before any outbound request", async () => {
		const fetchMock = vi.fn<typeof fetch>();
		vi.stubGlobal("fetch", fetchMock);

		const result = await fetchContentTool({
			url: "http://127.0.0.1/private",
		});

		expect(result.ok).toBe(false);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
