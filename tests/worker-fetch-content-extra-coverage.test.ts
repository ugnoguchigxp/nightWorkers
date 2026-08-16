import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/services/security/safe-outbound-fetch", () => ({
	safeOutboundFetch: async (input: {
		url: URL;
		headers?: Record<string, string>;
	}) => {
		const fetched = await fetch(input.url, { headers: input.headers });
		return {
			response: fetched,
			finalUrl: fetched.url || input.url.href,
		};
	},
}));

import {
	fetchContentTool,
	validateFetchContentUrl,
} from "../api/services/worker-tools/fetch-content";

type ResponseOptions = {
	ok?: boolean;
	status?: number;
	url?: string;
	contentType?: string | null;
	body?: string;
};

function response(options: ResponseOptions = {}): Response {
	const {
		ok = true,
		status = 200,
		url = "https://example.com/page",
		contentType = "text/plain; charset=utf-8",
		body = "",
	} = options;
	return {
		ok,
		status,
		url,
		headers: {
			get: (name: string) =>
				name.toLowerCase() === "content-type" ? contentType : null,
		},
		text: vi.fn().mockResolvedValue(body),
	} as unknown as Response;
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("validateFetchContentUrl security coverage", () => {
	it.each([
		"file:///etc/passwd",
		"data:text/plain,secret",
		"ftp://example.com/file",
	])("rejects non-HTTP URL schemes: %s", (url) => {
		expect(() => validateFetchContentUrl(url)).toThrow(
			"fetch_content only supports http and https URLs.",
		);
	});

	it("accepts HTTP and HTTPS URLs and normalizes their href", () => {
		expect(validateFetchContentUrl("http://example.com").href).toBe(
			"http://example.com/",
		);
		expect(validateFetchContentUrl("https://example.com/a?q=1#part").href).toBe(
			"https://example.com/a?q=1#part",
		);
	});

	it("returns typed invalid-argument results for malformed and file URLs", async () => {
		const malformed = await fetchContentTool({ url: "not a URL" });
		expect(malformed).toMatchObject({
			ok: false,
			payload: { finalUrl: "", status: 0, text: "", truncated: false },
			error: { code: "INVALID_TOOL_ARGS" },
		});
		const file = await fetchContentTool({ url: "file:///etc/passwd" });
		expect(file).toMatchObject({
			ok: false,
			error: {
				code: "INVALID_TOOL_ARGS",
				message: "fetch_content only supports http and https URLs.",
			},
		});
	});
});

describe("fetchContentTool HTTP and redirect coverage", () => {
	it("uses browser-like request headers and preserves redirected final URLs", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			response({
				url: "https://cdn.example.com/final",
				contentType: "application/json",
				body: '{"message":"こんにちは"}',
			}),
		);
		const result = await fetchContentTool({
			url: "https://example.com/start",
		});
		expect(result).toMatchObject({
			ok: true,
			payload: {
				url: "https://example.com/start",
				finalUrl: "https://cdn.example.com/final",
				status: 200,
				text: 'Content:\n{"message":"こんにちは"}',
			},
		});
		expect(fetchSpy).toHaveBeenCalledWith(
			expect.any(URL),
			expect.objectContaining({
				headers: expect.objectContaining({
					Accept: expect.stringContaining("text/html"),
					"User-Agent": expect.stringContaining("Mozilla/5.0"),
				}),
			}),
		);
	});

	it.each([
		"text/plain",
		"application/json",
		"application/xml",
		"application/xhtml+xml",
		"text/markdown",
	])("accepts textual content type %s", async (contentType) => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			response({ contentType, body: "text body" }),
		);
		await expect(
			fetchContentTool({ url: "https://example.com/content" }),
		).resolves.toMatchObject({ ok: true });
	});

	it.each([
		["application/octet-stream", "application/octet-stream"],
		[null, "unknown"],
	] as const)("rejects unsupported or absent content type %#", async (contentType, label) => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(response({ contentType }));
		const result = await fetchContentTool({
			url: "https://example.com/binary",
		});
		expect(result).toMatchObject({
			ok: false,
			payload: { contentType: contentType ?? "", status: 200, text: "" },
			error: {
				code: "UNSUPPORTED_CONTENT_TYPE",
				message: expect.stringContaining(label),
			},
		});
	});

	it("falls back to the source URL when a response has no final URL", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			response({ url: "", body: "plain text" }),
		);
		const result = await fetchContentTool({ url: "https://example.com/plain" });
		expect(result.payload.finalUrl).toBe("https://example.com/plain");
	});
});

describe("fetchContentTool HTTP error coverage", () => {
	it("returns the origin HTTP error without making an unvalidated mirror request", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			response({
				ok: false,
				status: 403,
				url: "https://example.com/protected",
				contentType: "text/html",
			}),
		);
		const result = await fetchContentTool({
			url: "https://example.com/protected?q=1#part",
			maxChars: 500,
		});
		expect(result).toMatchObject({
			ok: false,
			payload: {
				finalUrl: "https://example.com/protected",
				contentType: "text/html",
				status: 403,
				text: "",
				truncated: false,
			},
			error: { code: "FETCH_CONTENT_FAILED" },
		});
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	it("does not interpret an HTTP error page as successful content", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			response({
				ok: false,
				status: 429,
				contentType: "text/html",
				body: "x".repeat(800),
			}),
		);
		const result = await fetchContentTool({
			url: "https://example.com/limited",
			maxChars: 1,
		});
		expect(result).toMatchObject({
			ok: false,
			payload: { status: 429, text: "", truncated: false },
		});
	});

	it("returns the origin HTTP error with its direct final URL", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			response({ ok: false, status: 404, url: "", contentType: null }),
		);
		const result = await fetchContentTool({
			url: "https://example.com/missing",
		});
		expect(result).toMatchObject({
			ok: false,
			payload: {
				finalUrl: "https://example.com/missing",
				contentType: "",
				status: 404,
			},
			error: {
				code: "FETCH_CONTENT_FAILED",
				message: "Failed to fetch URL: HTTP 404",
			},
		});
	});
});

describe("fetchContentTool HTML extraction and security coverage", () => {
	it("decodes entities, removes executable/raw elements, and normalizes whitespace", async () => {
		const body = [
			"<html><head>",
			"<title>Docs &amp; &#65; &#x42;</title>",
			'<meta name="description" content="Safe &quot;description&quot; &lt;ok&gt;">',
			"</head><body>",
			"<header>Header</header>",
			"<p>Alpha &amp; beta</p>",
			"<ul><li>One</li><li>Two</li></ul>",
			"<br><hr>",
			"<xmp>raw secret</xmp>",
			"<script>alert(1)</script>",
			"<style>hidden</style>",
			"<noscript>fallback</noscript>",
			`<div>${"Readable content 123. ".repeat(30)}</div>`,
			"</body></html>",
		].join("");
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			response({ contentType: "text/html; charset=iso-8859-1", body }),
		);
		const result = await fetchContentTool({
			url: "https://example.com/docs",
		});
		expect(result).toMatchObject({
			ok: true,
			payload: {
				title: "Docs &amp; A B",
				description: 'Safe "description"',
				truncated: false,
			},
		});
		expect(result.payload.text).toContain("Alpha & beta");
		expect(result.payload.text).toContain("- One");
		expect(result.payload.text).not.toMatch(/alert|hidden|raw secret|fallback/);
	});

	it("returns direct HTML without a low-signal mirror request", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			response({
				contentType: "text/html",
				body: "<title>Short</title><p>tiny</p>",
			}),
		);
		const result = await fetchContentTool({ url: "https://example.com/short" });
		expect(result).toMatchObject({
			ok: true,
			payload: {
				title: "Short",
				text: "Title: Short\n\nContent:\ntiny",
			},
		});
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	it("retains the direct title and description for low-signal HTML", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			response({
				contentType: "text/html",
				body: [
					"<title>Origin</title>",
					'<meta name="description" content="Origin description">',
					"<p>short</p>",
				].join(""),
			}),
		);
		const result = await fetchContentTool({
			url: "https://example.com/low-signal",
		});
		expect(result).toMatchObject({
			ok: true,
			payload: {
				title: "Origin",
				description: "Origin description",
				text: "Title: Origin\n\nDescription: Origin description\n\nContent:\nshort",
			},
		});
	});

	it("keeps the direct title when HTML has no long-form content", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			response({
				contentType: "text/html",
				body: "<title>Origin title</title><p>short</p>",
			}),
		);
		const result = await fetchContentTool({
			url: "https://example.com/fallback",
		});
		expect(result.payload).toMatchObject({
			title: "Origin title",
			text: "Title: Origin title\n\nContent:\nshort",
		});
	});

	it("omits empty title, description, and content after sanitization", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			response({
				contentType: "text/html",
				body: '<title><script>x</script></title><meta name="description" content=""><body></body>',
			}),
		);
		const result = await fetchContentTool({ url: "https://example.com/empty" });
		expect(result.ok).toBe(true);
		expect(result.payload.title).toBeUndefined();
		expect(result.payload.description).toBeUndefined();
		expect(result.payload.text).toBe("");
	});
});

describe("fetchContentTool size, encoding, and exception coverage", () => {
	it("clamps oversized maxChars to 40,000 and flags source truncation", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			response({ body: "é".repeat(40_001) }),
		);
		const result = await fetchContentTool({
			url: "https://example.com/large",
			maxChars: 100_000,
		});
		expect(result.payload.text).toHaveLength(40_000);
		expect(result.payload.truncated).toBe(true);
	});

	it("marks an exact limit as truncated when formatted text reaches the cap", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			response({ body: "a".repeat(500) }),
		);
		const result = await fetchContentTool({
			url: "https://example.com/exact",
			maxChars: 500,
		});
		expect(result.payload.text).toHaveLength(500);
		expect(result.payload.truncated).toBe(true);
	});

	it("uses the default size limit when maxChars is omitted", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			response({ body: "a".repeat(12_001) }),
		);
		const result = await fetchContentTool({
			url: "https://example.com/default-limit",
		});
		expect(result.payload.text).toHaveLength(12_000);
		expect(result.payload.truncated).toBe(true);
	});

	it.each([
		[new Error("network offline"), "network offline"],
		[{ message: "object failure" }, "object failure"],
		[{}, "Unknown error"],
		["string failure", "string failure"],
	] as const)("normalizes thrown fetch error %#", async (error, message) => {
		vi.spyOn(globalThis, "fetch").mockRejectedValue(error);
		const result = await fetchContentTool({
			url: "https://example.com/error",
		});
		expect(result).toMatchObject({
			ok: false,
			payload: { finalUrl: "", status: 0, text: "" },
			error: {
				code: "FETCH_CONTENT_FAILED",
				message: `Failed to fetch URL: ${message}`,
			},
		});
	});
});
