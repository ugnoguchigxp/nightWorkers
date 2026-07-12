import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	DEFAULT_RUNTIME_LOG_RETENTION,
	RuntimeLogWriter,
} from "../api/runtime/runtime-log-writer";

const roots: string[] = [];

async function createWriter(
	overrides: Partial<typeof DEFAULT_RUNTIME_LOG_RETENTION> = {},
) {
	const root = await fs.mkdtemp(
		path.join(os.tmpdir(), "nightworkers-log-retention-"),
	);
	roots.push(root);
	return {
		root,
		writer: new RuntimeLogWriter(root, () => ({
			...DEFAULT_RUNTIME_LOG_RETENTION,
			...overrides,
		})),
	};
}

afterEach(async () => {
	await Promise.all(
		roots
			.splice(0)
			.map((root) => fs.rm(root, { recursive: true, force: true })),
	);
});

describe("RuntimeLogWriter", () => {
	it("rotates an API log when the UTC day changes and keeps the active filename", async () => {
		const { root, writer } = await createWriter();
		await writer.append("api", "first", new Date("2026-07-01T23:59:00.000Z"));
		await writer.append("api", "second", new Date("2026-07-02T00:00:00.000Z"));
		const names = await fs.readdir(root);
		expect(names).toContain("api.log");
		expect(
			names.some((name) => name.startsWith("api.") && name.endsWith(".log.gz")),
		).toBe(true);
		expect(await fs.readFile(path.join(root, "api.log"), "utf8")).toBe(
			"second\n",
		);
	});

	it("rotates by size and removes expired closed LLM segments", async () => {
		const { root, writer } = await createWriter({
			llmSegmentMaxBytes: 12,
			llmRawLogsMaxBytes: 1024,
			runtimeLogsMaxBytes: 1024,
		});
		await writer.append(
			"llm",
			"1234567890",
			new Date("2026-07-01T12:00:00.000Z"),
		);
		await writer.append(
			"llm",
			"abcdefghij",
			new Date("2026-07-01T12:00:00.000Z"),
		);
		const closed = (await fs.readdir(root)).find((name) =>
			name.startsWith("llm-trace."),
		);
		expect(closed).toBeTruthy();
		await fs.utimes(
			path.join(root, closed as string),
			new Date("2026-06-20T00:00:00.000Z"),
			new Date("2026-06-20T00:00:00.000Z"),
		);
		await writer.sweep(new Date("2026-07-01T12:00:00.000Z"));
		expect(await fs.readdir(root)).not.toContain(closed);
	});

	it("evicts the oldest closed LLM segment when its category exceeds the cap", async () => {
		const { root, writer } = await createWriter({
			llmSegmentMaxBytes: 12,
			llmRawLogsMaxBytes: 18,
			runtimeLogsMaxBytes: 64,
		});
		await writer.append(
			"llm",
			"1234567890",
			new Date("2026-07-01T12:00:00.000Z"),
		);
		await writer.append(
			"llm",
			"abcdefghij",
			new Date("2026-07-01T12:00:00.000Z"),
		);
		await writer.append(
			"llm",
			"klmnopqrst",
			new Date("2026-07-01T12:00:00.000Z"),
		);
		const names = await fs.readdir(root);
		expect(
			names.filter(
				(name) => name.startsWith("llm-trace.") && name.endsWith(".gz"),
			).length,
		).toBeLessThanOrEqual(1);
	});
});
