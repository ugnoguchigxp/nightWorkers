import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { buildChildProcessEnvironment } from "../api/services/execution/child-process-environment";
import { prepareWorkspaceConstrainedShell } from "../api/services/execution/workspace-process-confinement";

const execFileAsync = promisify(execFile);
const temporaryRoots: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryRoots
			.splice(0)
			.map((root) => fs.rm(root, { recursive: true, force: true })),
	);
});

describe("workspace process confinement", () => {
	it.runIf(process.platform === "darwin")(
		"allows Task worktree writes but blocks reads from an unrelated temporary directory",
		async () => {
			const root = await fs.mkdtemp(path.join(os.tmpdir(), "nw-sandbox-"));
			temporaryRoots.push(root);
			const repositoryRoot = path.join(root, "repository");
			const worktreeRoot = path.join(root, "task-worktree");
			const externalRoot = await fs.mkdtemp(
				path.join(os.tmpdir(), "nw-sandbox-external-"),
			);
			temporaryRoots.push(externalRoot);
			await fs.mkdir(repositoryRoot);
			await execFileAsync("git", ["init", repositoryRoot]);
			await execFileAsync("git", [
				"-C",
				repositoryRoot,
				"config",
				"user.email",
				"test@example.invalid",
			]);
			await execFileAsync("git", [
				"-C",
				repositoryRoot,
				"config",
				"user.name",
				"NightWorkers Test",
			]);
			await fs.writeFile(path.join(repositoryRoot, "README.md"), "base\n");
			await execFileAsync("git", ["-C", repositoryRoot, "add", "README.md"]);
			await execFileAsync("git", [
				"-C",
				repositoryRoot,
				"commit",
				"-m",
				"base",
			]);
			await execFileAsync("git", [
				"-C",
				repositoryRoot,
				"worktree",
				"add",
				"-b",
				"task/test",
				worktreeRoot,
			]);
			const externalSecret = path.join(externalRoot, "secret.txt");
			await fs.writeFile(externalSecret, "outside-workspace\n");
			const environment = buildChildProcessEnvironment({
				purpose: "workspace_command",
				overrides: {
					HOME: path.join(worktreeRoot, ".nightworkers-home"),
					TMPDIR: path.join(worktreeRoot, ".nightworkers-tmp"),
				},
			});
			await fs.mkdir(environment.HOME ?? "", { recursive: true });
			await fs.mkdir(environment.TMPDIR ?? "", { recursive: true });
			const constrained = await prepareWorkspaceConstrainedShell({
				command: `printf allowed > workspace.txt; cat ${JSON.stringify(externalSecret)}`,
				workspaceRoot: worktreeRoot,
				environment,
			});

			const exitCode = await new Promise<number | null>((resolve, reject) => {
				const child = spawn(constrained.executable, constrained.args, {
					cwd: worktreeRoot,
					env: environment,
					stdio: "ignore",
				});
				child.once("error", reject);
				child.once("exit", resolve);
			});

			expect(exitCode).not.toBe(0);
			await expect(
				fs.readFile(path.join(worktreeRoot, "workspace.txt"), "utf8"),
			).resolves.toBe("allowed");
		},
	);
});
