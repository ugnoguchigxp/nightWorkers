import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	replaceContentTool,
	runCommandTool,
} from "../../api/services/worker-tools";

let dummyRepoDir: string;

beforeEach(async () => {
	dummyRepoDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "nightworkers-worker-tools-"),
	);
	await fs.writeFile(path.join(dummyRepoDir, "hello.txt"), "hello\n", "utf-8");
});

afterEach(async () => {
	await fs.rm(dummyRepoDir, { recursive: true, force: true });
});

describe("Worker Tools Unit Tests", () => {
	it("replaces a single literal occurrence safely", async () => {
		const target = path.join(dummyRepoDir, "hello.txt");
		await fs.writeFile(target, "alpha\nbeta\n", "utf-8");

		const result = await replaceContentTool({
			repoRoot: dummyRepoDir,
			filePath: "hello.txt",
			needle: "alpha",
			replacement: "ALPHA",
			mode: "literal",
		});

		expect(result.ok).toBe(true);
		expect(result.payload.occurrences).toBe(1);

		const updated = await fs.readFile(target, "utf-8");
		expect(updated).toContain("ALPHA");
	});

	it("rejects empty needle", async () => {
		const result = await replaceContentTool({
			repoRoot: dummyRepoDir,
			filePath: "hello.txt",
			needle: "",
			replacement: "X",
			mode: "literal",
		});
		expect(result.ok).toBe(false);
		expect(result.error?.code).toBe("EMPTY_NEEDLE");
	});

	it("returns no_match when target text is missing", async () => {
		await fs.writeFile(
			path.join(dummyRepoDir, "hello.txt"),
			"foo\nbar\n",
			"utf-8",
		);
		const result = await replaceContentTool({
			repoRoot: dummyRepoDir,
			filePath: "hello.txt",
			needle: "not-found",
			replacement: "X",
			mode: "literal",
		});
		expect(result.ok).toBe(false);
		expect(result.error?.code).toBe("NO_MATCH");
	});

	it("returns file_not_found when replacement target is missing", async () => {
		const result = await replaceContentTool({
			repoRoot: dummyRepoDir,
			filePath: "missing.txt",
			needle: "alpha",
			replacement: "X",
			mode: "literal",
		});

		expect(result.ok).toBe(false);
		expect(result.error?.code).toBe("FILE_NOT_FOUND");
		expect(result.error?.message).toBe("File not found: missing.txt");
	});

	it("returns multiple_matches when more than one occurrence exists", async () => {
		await fs.writeFile(
			path.join(dummyRepoDir, "hello.txt"),
			"dup\ndup\n",
			"utf-8",
		);
		const result = await replaceContentTool({
			repoRoot: dummyRepoDir,
			filePath: "hello.txt",
			needle: "dup",
			replacement: "X",
			mode: "literal",
		});
		expect(result.ok).toBe(false);
		expect(result.error?.code).toBe("MULTIPLE_MATCHES");
	});

	it("applies replacement without read-before-edit gating", async () => {
		await fs.writeFile(
			path.join(dummyRepoDir, "hello.txt"),
			"read-me\n",
			"utf-8",
		);
		const result = await replaceContentTool({
			repoRoot: dummyRepoDir,
			filePath: "hello.txt",
			needle: "read-me",
			replacement: "READ",
			mode: "literal",
		});
		expect(result.ok).toBe(true);
		expect(
			await fs.readFile(path.join(dummyRepoDir, "hello.txt"), "utf-8"),
		).toBe("READ\n");
	});
});

describe("runCommandTool", () => {
	it("runs safe commands successfully", async () => {
		const result = await runCommandTool({
			command: 'echo "hello"',
			repoRoot: dummyRepoDir,
		});

		expect(result.ok).toBe(true);
		expect(result.payload.stdout.trim()).toBe("hello");
		expect(result.payload).toMatchObject({
			exitCode: 0,
			signal: null,
			timedOut: false,
			cwd: dummyRepoDir,
			repositoryRoot: dummyRepoDir,
		});
		expect(result.payload.stdoutDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
		expect(result.payload.stderrDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
	});

	it("propagates an earlier pipeline failure", async () => {
		const result = await runCommandTool({
			command: "echo ok | grep missing | head -1",
			repoRoot: dummyRepoDir,
		});

		expect(result.ok).toBe(false);
		expect(result.payload).toMatchObject({
			exitCode: 1,
			timedOut: false,
		});
		expect(result.error?.code).toBe("COMMAND_FAILED");
	});

	it("blocks destructive commands from running", async () => {
		const result = await runCommandTool({
			command: "rm -rf *",
			repoRoot: dummyRepoDir,
		});

		expect(result.ok).toBe(false);
		expect(result.error?.code).toBe("DESTRUCTIVE_COMMAND");
		expect(result.payload).toMatchObject({
			exitCode: -1,
			signal: null,
			timedOut: false,
			cwd: dummyRepoDir,
			repositoryRoot: dummyRepoDir,
		});
		expect(result.payload.stdoutDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
		expect(result.payload.stderrDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
	});

	it("blocks unknown commands by default", async () => {
		const result = await runCommandTool({
			command: "custom-unknown-cmd",
			repoRoot: dummyRepoDir,
		});
		expect(result.ok).toBe(false);
		expect(result.error?.code).toBe("DESTRUCTIVE_COMMAND");
	});

	it("returns command_cwd_not_found when cwd is missing", async () => {
		const result = await runCommandTool({
			command: 'echo "hello"',
			repoRoot: dummyRepoDir,
			cwd: "missing-folder",
		});

		expect(result.ok).toBe(false);
		expect(result.error?.code).toBe("COMMAND_CWD_NOT_FOUND");
		expect(result.error?.message).toBe(
			"Command working directory not found: missing-folder",
		);
	});

	it("returns command_cwd_not_directory when cwd points to a file", async () => {
		const result = await runCommandTool({
			command: 'echo "hello"',
			repoRoot: dummyRepoDir,
			cwd: "hello.txt",
		});

		expect(result.ok).toBe(false);
		expect(result.error?.code).toBe("COMMAND_CWD_NOT_DIRECTORY");
		expect(result.error?.message).toBe(
			"Command working directory is not a directory: hello.txt",
		);
	});

	it("requires background execution for long-running dev commands", async () => {
		const result = await runCommandTool({
			command: "pnpm dev",
			repoRoot: dummyRepoDir,
		});
		expect(result.ok).toBe(false);
		expect(result.error?.code).toBe("BACKGROUND_COMMAND_REQUIRED");
	});
});
