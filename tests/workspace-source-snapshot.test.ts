import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
	captureWorkspaceSourceSnapshot,
	workspaceHasSourceChanges,
} from "../api/modules/codingAgent/verification/workspace-source-snapshot";

const execFileAsync = promisify(execFile);

describe("workspace source snapshot", () => {
	it("detects tracked and untracked source changes but ignores ignored output", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "source-changes-"));
		try {
			await execFileAsync("git", ["init"], { cwd: root });
			await fs.writeFile(path.join(root, ".gitignore"), "ignored.log\n");
			await fs.writeFile(path.join(root, "tracked.txt"), "initial\n");
			await execFileAsync("git", ["add", ".gitignore", "tracked.txt"], {
				cwd: root,
			});
			await execFileAsync(
				"git",
				[
					"-c",
					"user.name=NightWorkers Test",
					"-c",
					"user.email=test@nightworkers.invalid",
					"commit",
					"-m",
					"fixture",
				],
				{ cwd: root },
			);

			expect(await workspaceHasSourceChanges(root)).toBe(false);
			await fs.writeFile(path.join(root, "ignored.log"), "ignored\n");
			expect(await workspaceHasSourceChanges(root)).toBe(false);
			await fs.writeFile(path.join(root, "untracked.txt"), "new\n");
			expect(await workspaceHasSourceChanges(root)).toBe(true);
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	it("distinguishes a deleted tracked file from a file containing the deletion marker text", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "source-snapshot-"));
		try {
			await execFileAsync("git", ["init"], { cwd: root });
			const target = path.join(root, "tracked.txt");
			await fs.writeFile(target, "<deleted>");
			await execFileAsync("git", ["add", "tracked.txt"], { cwd: root });
			const present = await captureWorkspaceSourceSnapshot(root);

			await fs.unlink(target);
			const deleted = await captureWorkspaceSourceSnapshot(root);
			const deletedAgain = await captureWorkspaceSourceSnapshot(root);

			expect(deleted.sourceStateHash).not.toBe(present.sourceStateHash);
			expect(deletedAgain.sourceStateHash).toBe(deleted.sourceStateHash);
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});
});
