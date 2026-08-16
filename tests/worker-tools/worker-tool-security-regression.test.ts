import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommandTool } from "../../api/services/worker-tools";

let repositoryRoot: string;

beforeEach(async () => {
	repositoryRoot = await fs.mkdtemp(
		path.join(os.tmpdir(), "nightworkers-worker-security-"),
	);
	await fs.writeFile(path.join(repositoryRoot, ".env"), "fixture-secret\n");
	await fs.writeFile(path.join(repositoryRoot, ".env.example"), "example\n");
	await fs.writeFile(path.join(repositoryRoot, "public.txt"), "public\n");
});

afterEach(async () => {
	await fs.rm(repositoryRoot, { recursive: true, force: true });
});

describe("worker tool security regressions", () => {
	it.each([
		"echo allowed | touch escaped.txt",
		"echo allowed || touch escaped.txt",
		"echo allowed && touch escaped.txt",
		"echo allowed; touch escaped.txt",
		"echo allowed > escaped.txt",
		"echo allowed\ntouch escaped.txt",
	])("does not execute shell control syntax: %s", async (command) => {
		const result = await runCommandTool({ command, repoRoot: repositoryRoot });

		expect(result.ok).toBe(false);
		await expect(
			fs.access(path.join(repositoryRoot, "escaped.txt")),
		).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("does not return secret file contents through command arguments", async () => {
		for (const command of [
			"cat .env",
			"rg fixture-secret .env",
			`cat ${JSON.stringify(path.join(repositoryRoot, ".env"))}`,
		]) {
			const result = await runCommandTool({
				command,
				repoRoot: repositoryRoot,
			});
			expect(result.ok).toBe(false);
			expect(result.payload.stdout).not.toContain("fixture-secret");
			expect(result.payload.stderr).not.toContain("fixture-secret");
		}

		const example = await runCommandTool({
			command: "cat .env.example",
			repoRoot: repositoryRoot,
		});
		expect(example.ok).toBe(true);
		expect(example.payload.stdout).toContain("example");
	});
});
