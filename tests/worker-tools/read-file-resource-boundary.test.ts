import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileTool } from "../../api/services/worker-tools/read-file";

const MAX_READ_FILE_BYTES = 4 * 1024 * 1024;

let repositoryRoot: string;
let outsideRoot: string;

beforeEach(async () => {
	repositoryRoot = await fs.mkdtemp(
		path.join(os.tmpdir(), "nightworkers-read-file-"),
	);
	outsideRoot = await fs.mkdtemp(
		path.join(os.tmpdir(), "nightworkers-read-file-outside-"),
	);
});

afterEach(async () => {
	await fs.rm(repositoryRoot, { recursive: true, force: true });
	await fs.rm(outsideRoot, { recursive: true, force: true });
});

describe("read_file resource boundaries", () => {
	it("rejects a sparse file above 4 MiB without adding it to the read cache", async () => {
		const filePath = path.join(repositoryRoot, "sparse-large.txt");
		await fs.writeFile(filePath, "");
		await fs.truncate(filePath, MAX_READ_FILE_BYTES + 1);
		const readCache = new Map();

		const result = await readFileTool({
			filePath: "sparse-large.txt",
			repoRoot: repositoryRoot,
			readCache,
		});

		expect(result).toMatchObject({
			ok: false,
			error: { code: "FILE_TOO_LARGE" },
		});
		expect(readCache).toHaveLength(0);
	});

	it("rejects binary content using only the initial probe", async () => {
		await fs.writeFile(
			path.join(repositoryRoot, "binary.dat"),
			Buffer.from([0x74, 0x65, 0x78, 0x74, 0x00, 0x76, 0x61, 0x6c, 0x75, 0x65]),
		);

		const result = await readFileTool({
			filePath: "binary.dat",
			repoRoot: repositoryRoot,
		});

		expect(result).toMatchObject({
			ok: false,
			error: { code: "UNSUPPORTED_FILE_TYPE" },
		});
	});

	it("rejects a FIFO before opening it for reading", async () => {
		const fifoPath = path.join(repositoryRoot, "events.pipe");
		execFileSync("mkfifo", [fifoPath]);

		const result = await readFileTool({
			filePath: "events.pipe",
			repoRoot: repositoryRoot,
		});

		expect(result).toMatchObject({
			ok: false,
			error: { code: "UNSUPPORTED_FILE_TYPE" },
		});
	});

	it("rejects a symlink that resolves outside the repository", async () => {
		await fs.writeFile(path.join(outsideRoot, "outside.txt"), "outside");
		await fs.symlink(
			path.join(outsideRoot, "outside.txt"),
			path.join(repositoryRoot, "outside-link.txt"),
		);

		const result = await readFileTool({
			filePath: "outside-link.txt",
			repoRoot: repositoryRoot,
		});

		expect(result).toMatchObject({
			ok: false,
			error: { code: "ACCESS_DENIED" },
		});
	});

	it("allows a regular text file exactly at the 4 MiB limit", async () => {
		await fs.writeFile(
			path.join(repositoryRoot, "exact-limit.txt"),
			"a".repeat(MAX_READ_FILE_BYTES),
		);

		const result = await readFileTool({
			filePath: "exact-limit.txt",
			repoRoot: repositoryRoot,
			startLine: 1,
			endLine: 1,
		});

		expect(result).toMatchObject({
			ok: true,
			payload: {
				totalLines: 1,
				linesReturned: 1,
				truncated: false,
			},
		});
	});
});
