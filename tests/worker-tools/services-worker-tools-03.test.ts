import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	inspectStructureTool,
	readFileTool,
	searchFilesTool,
} from "../../api/services/worker-tools";

let dummyRepoDir: string;

beforeEach(async () => {
	dummyRepoDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "nightworkers-worker-tools-"),
	);
	await fs.mkdir(path.join(dummyRepoDir, "src"), { recursive: true });
	await fs.writeFile(path.join(dummyRepoDir, "hello.txt"), "hello\n", "utf-8");
	await fs.writeFile(
		path.join(dummyRepoDir, "large.ts"),
		Array.from({ length: 400 }, (_, index) =>
			index === 200
				? "export function important() { return 1; }"
				: `const line${index} = ${index};`,
		).join("\n"),
		"utf-8",
	);
	await fs.writeFile(
		path.join(dummyRepoDir, "src/tool.ts"),
		[
			"import fs from 'node:fs';",
			"export type ToolInput = { path: string };",
			"export interface Runner { execute(): void }",
			"export class RunnerImpl implements Runner { execute() {} }",
			"export function readFileTool() { return fs.readFileSync; }",
			"export function loadTool() { return readFileTool; }",
		].join("\n"),
		"utf-8",
	);
	await fs.writeFile(
		path.join(dummyRepoDir, "src/symbol-variants.tsx"),
		[
			"import React, { useMemo } from 'react';",
			"import * as pathTools from 'node:path';",
			"export default function Widget() { return <div />; }",
			"export class DefaultNamed { render() { return null; } }",
			"export enum Mode { Read = 'read', Write = 'write' }",
			"export const makeRunner = () => pathTools.basename('runner');",
			"const localValue = useMemo;",
		].join("\n"),
		"utf-8",
	);
	await fs.writeFile(
		path.join(dummyRepoDir, "src/upper.txt"),
		"HELLO\n",
		"utf-8",
	);
	await fs.writeFile(
		path.join(dummyRepoDir, "config.json"),
		JSON.stringify({ scripts: { verify: "pnpm verify" }, items: [1, 2] }),
		"utf-8",
	);
});

afterEach(async () => {
	await fs.rm(dummyRepoDir, { recursive: true, force: true });
});

describe("Worker Tools Unit Tests", () => {
	it("blocks symlinks that resolve outside repo root", async () => {
		const outsideDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "nightworkers-outside-"),
		);
		const linkPath = path.join(dummyRepoDir, "outside-link");
		await fs.writeFile(
			path.join(outsideDir, "secret.txt"),
			"outside\n",
			"utf-8",
		);
		await fs.rm(linkPath, { recursive: true, force: true });
		await fs.symlink(outsideDir, linkPath, "dir");

		const result = await readFileTool({
			filePath: "outside-link/secret.txt",
			repoRoot: dummyRepoDir,
		});

		expect(result.ok).toBe(false);
		expect(result.error?.code).toBe("ACCESS_DENIED");
		await fs.rm(outsideDir, { recursive: true, force: true });
	});

	it("uses compressed context by default for large full-file reads", async () => {
		const result = await readFileTool({
			filePath: "large.ts",
			repoRoot: dummyRepoDir,
		});

		expect(result.ok).toBe(true);
		expect(result.payload.content).toContain("[read-file-compressed]");
		expect(result.payload.content).toContain("important");
		expect(result.payload.compression?.compressed).toBe(true);
	});

	it("allows traditional full read output when compressionMode is off", async () => {
		const result = await readFileTool({
			filePath: "large.ts",
			repoRoot: dummyRepoDir,
			compressionMode: "off",
		});

		expect(result.ok).toBe(true);
		expect(result.payload.content).toContain("1: const line0 = 0;");
		expect(result.payload.content).not.toContain("[read-file-compressed]");
	});

	it("returns a cache marker for unchanged repeated reads in one tool context", async () => {
		const readCache = new Map();
		await readFileTool({
			filePath: "hello.txt",
			repoRoot: dummyRepoDir,
			readCache,
		});
		const secondRead = await readFileTool({
			filePath: "hello.txt",
			repoRoot: dummyRepoDir,
			readCache,
		});

		expect(secondRead.ok).toBe(true);
		expect(secondRead.payload.cached).toBe(true);
		expect(secondRead.payload.content).toContain('"status": "cached"');
		expect(secondRead.payload.content).toContain('"contentReturned": false');
		expect(secondRead.payload.compression?.strategy).toBe("read_cache_marker");
	});

	it("allows fresh reads to bypass the unchanged-file cache marker", async () => {
		const readCache = new Map();
		await readFileTool({
			filePath: "hello.txt",
			repoRoot: dummyRepoDir,
			readCache,
		});
		const freshRead = await readFileTool({
			filePath: "hello.txt",
			repoRoot: dummyRepoDir,
			readCache,
			fresh: true,
		});

		expect(freshRead.ok).toBe(true);
		expect(freshRead.payload.cached).toBe(false);
		expect(freshRead.payload.content).toContain("1: hello");
	});

	it("returns file_not_found when read target is missing", async () => {
		const result = await readFileTool({
			filePath: "missing.txt",
			repoRoot: dummyRepoDir,
		});

		expect(result.ok).toBe(false);
		expect(result.error?.code).toBe("FILE_NOT_FOUND");
		expect(result.error?.message).toBe("File not found: missing.txt");
	});
});

describe("inspectStructureTool", () => {
	it("summarizes TypeScript imports and symbols without reading full content", async () => {
		const result = await inspectStructureTool({
			filePath: "src/tool.ts",
			repoRoot: dummyRepoDir,
		});

		expect(result.ok).toBe(true);
		expect(result.payload.kind).toBe("source");
		if (result.payload.kind !== "source")
			throw new Error("expected source output");
		expect(result.payload.imports?.[0]).toMatchObject({ module: "node:fs" });
		expect(result.payload.symbols.map((symbol) => symbol.name)).toEqual(
			expect.arrayContaining([
				"ToolInput",
				"readFileTool",
				"Runner",
				"execute",
				"loadTool",
			]),
		);
		expect(
			result.payload.symbols.find((symbol) => symbol.name === "loadTool"),
		).toMatchObject({
			kind: "function",
			exported: true,
		});
		expect(result.payload.compression?.omittedReason).toBe(
			"source_ast_symbols_only",
		);
	});

	it("summarizes TSX imports, enums, variables, and class methods", async () => {
		const result = await inspectStructureTool({
			filePath: "src/symbol-variants.tsx",
			repoRoot: dummyRepoDir,
		});

		expect(result.ok).toBe(true);
		expect(result.payload.kind).toBe("source");
		if (result.payload.kind !== "source")
			throw new Error("expected source output");
		expect(result.payload.language).toBe("typescript");
		expect(result.payload.imports).toEqual([
			expect.objectContaining({
				module: "react",
				names: ["React", "useMemo"],
			}),
			expect.objectContaining({
				module: "node:path",
				names: ["* as pathTools"],
			}),
		]);
		expect(result.payload.symbols).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: "Widget",
					kind: "function",
					exported: true,
				}),
				expect.objectContaining({
					name: "DefaultNamed",
					kind: "class",
					exported: true,
				}),
				expect.objectContaining({
					name: "render",
					kind: "method",
					exported: false,
				}),
				expect.objectContaining({
					name: "Mode",
					kind: "enum",
					exported: true,
				}),
				expect.objectContaining({
					name: "makeRunner",
					kind: "function",
					exported: true,
				}),
				expect.objectContaining({
					name: "localValue",
					kind: "variable",
					exported: false,
				}),
			]),
		);
	});

	it("omits import summaries when includeImports is false", async () => {
		const result = await inspectStructureTool({
			filePath: "src/tool.ts",
			repoRoot: dummyRepoDir,
			includeImports: false,
		});

		expect(result.ok).toBe(true);
		expect(result.payload.kind).toBe("source");
		if (result.payload.kind !== "source")
			throw new Error("expected source output");
		expect(result.payload.imports).toBeUndefined();
		expect(result.payload.symbols.length).toBeGreaterThan(0);
	});

	it("returns file_not_found when inspect target is missing", async () => {
		const result = await inspectStructureTool({
			filePath: "missing.ts",
			repoRoot: dummyRepoDir,
		});

		expect(result.ok).toBe(false);
		expect(result.error?.code).toBe("FILE_NOT_FOUND");
		expect(result.error?.message).toBe("File not found: missing.ts");
	});

	it("marks JSON shape as truncated only when maxPaths cuts traversal short", async () => {
		const result = await inspectStructureTool({
			filePath: "config.json",
			repoRoot: dummyRepoDir,
			maxPaths: 2,
		});

		expect(result.ok).toBe(true);
		expect(result.payload.kind).toBe("json");
		if (result.payload.kind !== "json") throw new Error("expected json output");
		expect(result.payload.paths.length).toBe(2);
		expect(result.payload.truncated).toBe(true);
	});

	it("summarizes JSON shape without primitive values by default", async () => {
		const result = await inspectStructureTool({
			filePath: "config.json",
			repoRoot: dummyRepoDir,
		});

		expect(result.ok).toBe(true);
		expect(result.payload.kind).toBe("json");
		if (result.payload.kind !== "json") throw new Error("expected json output");
		expect(result.payload.paths).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ path: "$.scripts.verify", type: "string" }),
				expect.objectContaining({ path: "$.items", type: "array", length: 2 }),
			]),
		);
		expect(
			result.payload.paths.find((entry) => entry.path === "$.scripts.verify"),
		).not.toHaveProperty("preview");
		expect(result.payload.truncated).toBe(false);
	});
});

describe("searchFilesTool", () => {
	it("finds query matches inside repo files", async () => {
		const result = await searchFilesTool({
			query: "hello",
			repoRoot: dummyRepoDir,
		});

		expect(result.ok).toBe(true);
		expect(result.payload.count).toBeGreaterThanOrEqual(1);
		expect(result.payload.matches.map((match) => match.excerpt)).toContain(
			"hello",
		);
	});

	it("honors case sensitivity and glob filters for ripgrep searches", async () => {
		const insensitive = await searchFilesTool({
			query: "hello",
			repoRoot: dummyRepoDir,
			glob: "*.txt",
		});
		const sensitive = await searchFilesTool({
			query: "hello",
			repoRoot: dummyRepoDir,
			glob: "*.txt",
			caseSensitive: true,
		});

		expect(insensitive.ok).toBe(true);
		expect(insensitive.payload.matches.map((match) => match.filePath)).toEqual(
			expect.arrayContaining(["hello.txt", "src/upper.txt"]),
		);
		expect(sensitive.ok).toBe(true);
		expect(sensitive.payload.matches.map((match) => match.filePath)).toContain(
			"hello.txt",
		);
		expect(
			sensitive.payload.matches.map((match) => match.filePath),
		).not.toContain("src/upper.txt");
	});

	it("limits search results before returning the payload", async () => {
		const result = await searchFilesTool({
			query: "line",
			repoRoot: dummyRepoDir,
			maxResults: 3,
		});

		expect(result.ok).toBe(true);
		expect(result.payload.count).toBe(3);
		expect(result.payload.matches).toHaveLength(3);
	});

	it("returns an empty ripgrep result when there are no matches", async () => {
		const result = await searchFilesTool({
			query: "not-present-in-fixture",
			repoRoot: dummyRepoDir,
		});

		expect(result.ok).toBe(true);
		expect(result.payload).toMatchObject({
			count: 0,
			matches: [],
			engine: "ripgrep",
		});
	});

	it("falls back to the manual scanner when ripgrep is unavailable", async () => {
		const originalPath = process.env.PATH;
		process.env.PATH = "";
		try {
			const result = await searchFilesTool({
				query: "HELLO",
				repoRoot: dummyRepoDir,
				glob: "*.txt",
				caseSensitive: true,
				maxResults: 1,
			});

			expect(result.ok).toBe(true);
			expect(result.payload).toMatchObject({
				count: 1,
				engine: "fallback",
				matches: [
					expect.objectContaining({
						filePath: "src/upper.txt",
						excerpt: "HELLO",
					}),
				],
			});
		} finally {
			if (originalPath === undefined) delete process.env.PATH;
			else process.env.PATH = originalPath;
		}
	});

	it("returns search_root_not_found when repo root is missing", async () => {
		const result = await searchFilesTool({
			query: "hello",
			repoRoot: path.join(dummyRepoDir, "missing-root"),
		});

		expect(result.ok).toBe(false);
		expect(result.error?.code).toBe("SEARCH_ROOT_NOT_FOUND");
		expect(result.error?.message).toBe("Search root not found: .");
	});
});
