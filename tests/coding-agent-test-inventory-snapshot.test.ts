import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { captureWorkspaceSourceSnapshot } from "../api/modules/codingAgent/verification/workspace-source-snapshot";

const directories: string[] = [];

afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((directory) => fs.rm(directory, { recursive: true, force: true })),
	);
});

describe("workspace test evidence snapshot", () => {
	it("changes for source files but ignores Git-ignored build output", async () => {
		const directory = await fs.mkdtemp(
			path.join(os.tmpdir(), "nightworkers-test-inventory-"),
		);
		directories.push(directory);
		await fs.writeFile(path.join(directory, ".gitignore"), "dist/\n", "utf8");
		await fs.writeFile(
			path.join(directory, "source.ts"),
			"export const value = 1;\n",
			"utf8",
		);
		execFileSync("git", ["init"], { cwd: directory, stdio: "ignore" });
		execFileSync("git", ["add", "."], { cwd: directory, stdio: "ignore" });
		execFileSync(
			"git",
			[
				"-c",
				"user.email=test@example.test",
				"-c",
				"user.name=Test",
				"commit",
				"-m",
				"fixture",
			],
			{ cwd: directory, stdio: "ignore" },
		);

		const before = await captureWorkspaceSourceSnapshot(directory);
		await fs.mkdir(path.join(directory, "dist"));
		await fs.writeFile(
			path.join(directory, "dist", "bundle.js"),
			"generated",
			"utf8",
		);
		const afterIgnoredOutput = await captureWorkspaceSourceSnapshot(directory);
		expect(afterIgnoredOutput.sourceStateHash).toBe(before.sourceStateHash);

		await fs.writeFile(
			path.join(directory, "source.ts"),
			"export const value = 2;\n",
			"utf8",
		);
		const afterSourceChange = await captureWorkspaceSourceSnapshot(directory);
		expect(afterSourceChange.sourceStateHash).not.toBe(before.sourceStateHash);
	});
});
