import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	type GitCliError,
	probeGit,
	runGitCommand,
} from "../../api/modules/gitworktree/gitworktree-cli";
import {
	parseWorktreeListPorcelain,
	parseWorktreeStatusPorcelain,
} from "../../api/modules/gitworktree/gitworktree-parser";

const cleanupPaths: string[] = [];

afterEach(async () => {
	await Promise.all(
		cleanupPaths
			.splice(0)
			.map((entry) => rm(entry, { recursive: true, force: true })),
	);
});

describe("git worktree CLI boundary", () => {
	it("classifies an unavailable git executable without a fallback", async () => {
		const result = await probeGit((args, options) =>
			runGitCommand(args, {
				...options,
				executable: "nightworkers-git-does-not-exist",
			}),
		);

		expect(result).toEqual({
			available: false,
			version: null,
			reason: "git_not_found",
		});
	});

	it("enforces bounded command output", async () => {
		await expect(
			runGitCommand(["-e", "process.stdout.write('abcdef')"], {
				executable: process.execPath,
				maxOutputBytes: 3,
			}),
		).rejects.toMatchObject<Partial<GitCliError>>({
			reason: "git_output_too_large",
		});
	});

	it("disables interactive Git credential prompts", async () => {
		const result = await runGitCommand(
			["-e", "process.stdout.write(process.env.GIT_TERMINAL_PROMPT || '')"],
			{ executable: process.execPath },
		);

		expect(result.stdout).toBe("0");
	});

	it("round-trips a real worktree path containing spaces", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "nightworkers-worktree-"));
		cleanupPaths.push(root);
		const repository = path.join(root, "project base");
		const worktree = path.join(root, "project worktrees", "feature one");
		await runGitCommand(["init", repository]);
		await runGitCommand(["-C", repository, "config", "user.name", "Test"]);
		await runGitCommand([
			"-C",
			repository,
			"config",
			"user.email",
			"test@example.com",
		]);
		await writeFile(path.join(repository, "README.md"), "base\n");
		await runGitCommand(["-C", repository, "add", "README.md"]);
		await runGitCommand(["-C", repository, "commit", "-m", "initial"]);
		await runGitCommand([
			"-C",
			repository,
			"worktree",
			"add",
			"-b",
			"feature/one",
			"--",
			worktree,
			"HEAD",
		]);

		const list = await runGitCommand([
			"-C",
			repository,
			"worktree",
			"list",
			"--porcelain",
			"-z",
		]);
		const records = parseWorktreeListPorcelain(list.stdout);
		expect(records).toHaveLength(2);
		expect(records).toContainEqual(
			expect.objectContaining({
				path: await realpath(worktree),
				branch: "feature/one",
				detached: false,
			}),
		);

		await writeFile(path.join(worktree, "new file.txt"), "untracked\n");
		const status = await runGitCommand([
			"-C",
			worktree,
			"status",
			"--porcelain=v2",
			"--branch",
			"-z",
		]);
		expect(parseWorktreeStatusPorcelain(status.stdout)).toMatchObject({
			untrackedCount: 1,
			conflictedCount: 0,
		});
	});
});

describe("git worktree porcelain parsers", () => {
	it("preserves locked, prunable, and detached metadata", () => {
		const records = parseWorktreeListPorcelain(
			[
				"worktree /tmp/base",
				"HEAD abc",
				"branch refs/heads/main",
				"",
				"worktree /tmp/stale",
				"HEAD def",
				"detached",
				"locked task is running",
				"prunable gitdir file points to non-existent location",
				"",
			].join("\0"),
		);

		expect(records[1]).toMatchObject({
			detached: true,
			locked: true,
			lockReason: "task is running",
			prunable: true,
			pruneReason: "gitdir file points to non-existent location",
		});
	});

	it("counts staged, modified, untracked, and conflicted entries", () => {
		const parsed = parseWorktreeStatusPorcelain(
			[
				"# branch.upstream origin/main",
				"# branch.ab +2 -3",
				"1 M. N... 100644 100644 100644 a b staged.ts",
				"1 .M N... 100644 100644 100644 a b modified.ts",
				"? untracked.ts",
				"u UU N... 100644 100644 100644 100644 a b c conflict.ts",
				"",
			].join("\0"),
		);

		expect(parsed).toEqual({
			upstream: "origin/main",
			ahead: 2,
			behind: 3,
			stagedCount: 1,
			modifiedCount: 1,
			untrackedCount: 1,
			conflictedCount: 1,
		});
	});
});
