import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	fetchContentTool,
	findFileTool,
	listDirTool,
	searchWebTool,
} from "../../api/services/worker-tools";

let dummyRepoDir: string;

beforeEach(async () => {
	dummyRepoDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "nightworkers-worker-tools-"),
	);
	await fs.mkdir(path.join(dummyRepoDir, "src"), { recursive: true });
	await fs.writeFile(path.join(dummyRepoDir, "hello.txt"), "hello\n", "utf-8");
	await fs.writeFile(
		path.join(dummyRepoDir, "src/main.js"),
		'console.log("ok");\n',
		"utf-8",
	);
});

afterEach(async () => {
	vi.restoreAllMocks();
	await fs.rm(dummyRepoDir, { recursive: true, force: true });
});

describe("Worker Tools Unit Tests", () => {
	it("parses DuckDuckGo search results", async () => {
		const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
			ok: true,
			status: 200,
			text: async () => `
          <div class="result results_links results_links_deep web-result ">
            <div class="links_main links_deep result__body">
              <h2 class="result__title">
                <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage&amp;rut=abc">Example Title</a>
              </h2>
              <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage&amp;rut=abc">Example snippet</a>
            </div>
          </div>
        `,
		} as Response);

		const result = await searchWebTool({
			query: "example query",
			maxResults: 3,
		});

		expect(fetchSpy).toHaveBeenCalled();
		expect(result.ok).toBe(true);
		expect(result.payload.results).toHaveLength(1);
		expect(result.payload.results[0]).toMatchObject({
			title: "Example Title",
			url: "https://example.com/page",
		});
	});
});

describe("fetchContentTool", () => {
	it("fetches and extracts text from HTML pages", async () => {
		const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
			ok: true,
			status: 200,
			url: "https://example.com/docs",
			headers: {
				get: (name: string) =>
					name.toLowerCase() === "content-type"
						? "text/html; charset=utf-8"
						: null,
			},
			text: async () => `
          <html>
            <head>
              <title>Example Docs</title>
              <meta name="description" content="A short example description.">
            </head>
            <body>
              <h1>Hello</h1>
              <p>First paragraph.</p>
              <p>Second paragraph.</p>
            </body>
          </html>
        `,
		} as Response);

		const result = await fetchContentTool({ url: "https://example.com/docs" });

		expect(fetchSpy).toHaveBeenCalled();
		const [calledUrl, calledInit] = fetchSpy.mock.calls[0] as [
			URL | string,
			RequestInit,
		];
		expect(String(calledUrl)).toBe("https://example.com/docs");
		expect(calledInit).toEqual(
			expect.objectContaining({
				headers: expect.objectContaining({
					Accept: expect.stringContaining("text/html"),
				}),
			}),
		);
		expect(result.ok).toBe(true);
		expect(result.payload.title).toBe("Example Docs");
		expect(result.payload.description).toBe("A short example description.");
		expect(result.payload.text).toContain("First paragraph.");
	});

	it("removes executable markup from fetched titles and HTML content", async () => {
		vi.spyOn(global, "fetch").mockResolvedValue({
			ok: true,
			status: 200,
			url: "https://example.com/untrusted",
			headers: { get: () => "text/html; charset=utf-8" },
			text: async () => `
				<title>安全な題名<img src=x onerror=alert(1)></title>
				<meta name="description" content="説明">
				<main>${"通常の本文です。".repeat(80)}</main>
				<xmp><img src=x onerror=alert(1)></xmp>
				<script><script>alert(1)</script></script>
			`,
		} as Response);

		const result = await fetchContentTool({
			url: "https://example.com/untrusted",
		});

		expect(result.ok).toBe(true);
		expect(result.payload.title).toBe("安全な題名");
		expect(result.payload.text).not.toMatch(/<(?:script|img|xmp)\b/i);
		expect(result.payload.text).not.toContain("onerror=");
	});
});

describe("listDirTool", () => {
	it("lists dirs and files in repository root", async () => {
		const result = await listDirTool({
			repoRoot: dummyRepoDir,
			recursive: false,
		});
		expect(result.ok).toBe(true);
		expect(result.payload.files).toContain("hello.txt");
		expect(result.payload.dirs).toContain("src");
	});

	it("fails when target is not a directory", async () => {
		const result = await listDirTool({
			repoRoot: dummyRepoDir,
			relativePath: "hello.txt",
		});
		expect(result.ok).toBe(false);
		expect(result.error?.code).toBe("NOT_A_DIRECTORY");
	});

	it("returns directory_not_found when list target is missing", async () => {
		const result = await listDirTool({
			repoRoot: dummyRepoDir,
			relativePath: "missing-folder",
		});
		expect(result.ok).toBe(false);
		expect(result.error?.code).toBe("DIRECTORY_NOT_FOUND");
		expect(result.error?.message).toBe("Directory not found: missing-folder");
	});

	it("fails when path is denied by policy", async () => {
		const result = await listDirTool({
			repoRoot: dummyRepoDir,
			relativePath: "src",
			deniedPaths: ["src"],
		});
		expect(result.ok).toBe(false);
		expect(result.error?.code).toBe("ACCESS_DENIED");
	});
});

describe("findFileTool", () => {
	it("finds files by wildcard mask", async () => {
		const result = await findFileTool({
			repoRoot: dummyRepoDir,
			fileMask: "*.js",
		});
		expect(result.ok).toBe(true);
		expect(result.payload.files).toContain("src/main.js");
	});

	it("respects maxResults limit", async () => {
		await fs.writeFile(path.join(dummyRepoDir, "src/a.js"), "a", "utf-8");
		await fs.writeFile(path.join(dummyRepoDir, "src/b.js"), "b", "utf-8");
		const result = await findFileTool({
			repoRoot: dummyRepoDir,
			fileMask: "*.js",
			maxResults: 1,
		});
		expect(result.ok).toBe(true);
		expect(result.payload.count).toBe(1);
	});

	it("fails when path is denied by policy", async () => {
		const result = await findFileTool({
			repoRoot: dummyRepoDir,
			fileMask: "*.js",
			relativePath: "src",
			deniedPaths: ["src"],
		});
		expect(result.ok).toBe(false);
		expect(result.error?.code).toBe("ACCESS_DENIED");
	});

	it("returns directory_not_found when find_file start directory is missing", async () => {
		const result = await findFileTool({
			repoRoot: dummyRepoDir,
			fileMask: "*.js",
			relativePath: "missing-folder",
		});
		expect(result.ok).toBe(false);
		expect(result.error?.code).toBe("DIRECTORY_NOT_FOUND");
		expect(result.error?.message).toBe("Directory not found: missing-folder");
	});
});
