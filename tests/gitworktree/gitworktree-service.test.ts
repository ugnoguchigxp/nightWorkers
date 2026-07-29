import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as gitworktreeRepo from "../../api/modules/gitworktree/gitworktree.repository";
import {
	createRepositoryWorktree,
	listRepositoryWorktrees,
	previewRepositoryWorktreePrune,
	removeRepositoryWorktree,
	resolveTaskExecutionRoot,
} from "../../api/modules/gitworktree/gitworktree.service";
import type { GitCommandRunner } from "../../api/modules/gitworktree/gitworktree-cli";
import { GitCliError } from "../../api/modules/gitworktree/gitworktree-cli";

vi.mock("../../api/modules/gitworktree/gitworktree.repository", () => ({
	getRepository: vi.fn(),
	readUsage: vi.fn(),
}));

const head = "0123456789012345678901234567890123456789";

function cleanRepositoryRunner(): GitCommandRunner {
	return vi.fn(async (args) => {
		if (args[0] === "--version")
			return { stdout: "git version 2.52.0\n", stderr: "", exitCode: 0 };
		if (args.includes("--show-toplevel"))
			return { stdout: "/repo\n", stderr: "", exitCode: 0 };
		if (args.includes("--git-common-dir"))
			return { stdout: "/repo/.git\n", stderr: "", exitCode: 0 };
		if (args.includes("list")) {
			return {
				stdout: [
					"worktree /repo",
					`HEAD ${head}`,
					"branch refs/heads/main",
					"",
				].join("\0"),
				stderr: "",
				exitCode: 0,
			};
		}
		if (args.includes("status")) {
			return {
				stdout: "# branch.head main\0",
				stderr: "",
				exitCode: 0,
			};
		}
		if (args.includes("log"))
			return { stdout: "Initial commit\n", stderr: "", exitCode: 0 };
		throw new Error(`Unexpected git args: ${args.join(" ")}`);
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(gitworktreeRepo.getRepository).mockResolvedValue({
		id: "repo-id",
		name: "Example",
		localPath: "/repo",
		branch: "main",
	} as Awaited<ReturnType<typeof gitworktreeRepo.getRepository>>);
	vi.mocked(gitworktreeRepo.readUsage).mockResolvedValue(new Map());
});

describe("gitworktree service boundary", () => {
	it("returns a verified base worktree from Git porcelain output", async () => {
		const result = await listRepositoryWorktrees("repo-id", {
			runner: cleanRepositoryRunner(),
		});

		expect(result.git.available).toBe(true);
		expect(result.repository.available).toBe(true);
		expect(result.worktrees).toHaveLength(1);
		expect(result.worktrees[0]).toMatchObject({
			path: "/repo",
			branch: "main",
			head,
			isBase: true,
			canRemove: false,
			removeBlockers: ["base_worktree_protected"],
		});
	});

	it("reports Git unavailable without invoking a fallback", async () => {
		const runner: GitCommandRunner = vi.fn(async () => {
			throw new GitCliError("git_not_found", "git not found");
		});

		const result = await listRepositoryWorktrees("repo-id", { runner });

		expect(result).toMatchObject({
			git: { available: false, reason: "git_not_found" },
			repository: { available: false },
			worktrees: [],
		});
		expect(runner).toHaveBeenCalledTimes(1);
	});

	it("reports repository probe failures separately from non-repositories", async () => {
		const runner: GitCommandRunner = vi.fn(async (args) => {
			if (args[0] === "--version")
				return { stdout: "git version 2.52.0\n", stderr: "", exitCode: 0 };
			throw new GitCliError("git_command_timed_out", "probe timed out");
		});

		const result = await listRepositoryWorktrees("repo-id", { runner });

		expect(result.repository).toMatchObject({
			available: false,
			reason: "repository_probe_failed",
		});
	});

	it("preserves timeout failures from the worktree list command", async () => {
		const baseRunner = cleanRepositoryRunner();
		const runner: GitCommandRunner = vi.fn(async (args, options) => {
			if (args.includes("list"))
				throw new GitCliError("git_command_timed_out", "list timed out");
			return baseRunner(args, options);
		});

		await expect(
			listRepositoryWorktrees("repo-id", { runner }),
		).rejects.toMatchObject({
			code: "git_command_timed_out",
			statusCode: 504,
		});
	});

	it("fails closed when a worktree status cannot be read", async () => {
		const runner: GitCommandRunner = vi.fn(async (args) => {
			if (args[0] === "--version")
				return { stdout: "git version 2.52.0\n", stderr: "", exitCode: 0 };
			if (args.includes("--show-toplevel"))
				return { stdout: "/repo\n", stderr: "", exitCode: 0 };
			if (args.includes("--git-common-dir"))
				return { stdout: "/repo/.git\n", stderr: "", exitCode: 0 };
			if (args.includes("list"))
				return {
					stdout: [
						"worktree /repo",
						`HEAD ${head}`,
						"branch refs/heads/main",
						"",
						"worktree /repo-worktrees/feature",
						`HEAD ${head}`,
						"branch refs/heads/feature",
						"",
					].join("\0"),
					stderr: "",
					exitCode: 0,
				};
			if (args.includes("status")) {
				if (args[1] === "/repo-worktrees/feature")
					throw new GitCliError("git_command_failed", "status failed");
				return { stdout: "# branch.head main\0", stderr: "", exitCode: 0 };
			}
			if (args.includes("log"))
				return { stdout: "Commit\n", stderr: "", exitCode: 0 };
			throw new Error(`Unexpected git args: ${args.join(" ")}`);
		});

		const result = await listRepositoryWorktrees("repo-id", { runner });
		const feature = result.worktrees.find((item) => item.branch === "feature");

		expect(feature).toMatchObject({
			canRemove: false,
			removeBlockers: ["worktree_status_unavailable"],
		});
	});

	it("preserves timeout failures from worktree creation", async () => {
		const baseRunner = cleanRepositoryRunner();
		const runner: GitCommandRunner = vi.fn(async (args, options) => {
			if (args[0] === "check-ref-format")
				return { stdout: "", stderr: "", exitCode: 0 };
			if (args.includes("--verify"))
				return { stdout: `${head}\n`, stderr: "", exitCode: 0 };
			if (args.includes("add"))
				throw new GitCliError("git_command_timed_out", "add timed out");
			return baseRunner(args, options);
		});

		await expect(
			createRepositoryWorktree(
				"repo-id",
				{
					mode: "new_branch",
					branchName: "feature",
					startPoint: "main",
				},
				{ runner },
			),
		).rejects.toMatchObject({
			code: "git_command_timed_out",
			statusCode: 504,
		});
	});

	it("rejects a prospective symlink path that overlaps an existing worktree", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "gitworktree-test-"));
		const repositoryPath = path.join(root, "repo");
		const linkedPath = path.join(root, "linked-repo");
		await fs.mkdir(repositoryPath);
		await fs.symlink(repositoryPath, linkedPath);
		vi.mocked(gitworktreeRepo.getRepository).mockResolvedValue({
			id: "repo-id",
			name: "Example",
			localPath: repositoryPath,
		} as Awaited<ReturnType<typeof gitworktreeRepo.getRepository>>);
		const runner: GitCommandRunner = vi.fn(async (args) => {
			if (args[0] === "--version")
				return { stdout: "git version 2.52.0\n", stderr: "", exitCode: 0 };
			if (args.includes("--show-toplevel"))
				return { stdout: `${repositoryPath}\n`, stderr: "", exitCode: 0 };
			if (args.includes("--git-common-dir"))
				return {
					stdout: `${path.join(repositoryPath, ".git")}\n`,
					stderr: "",
					exitCode: 0,
				};
			if (args.includes("list"))
				return {
					stdout: [
						`worktree ${repositoryPath}`,
						`HEAD ${head}`,
						"branch refs/heads/main",
						"",
					].join("\0"),
					stderr: "",
					exitCode: 0,
				};
			if (args.includes("status"))
				return { stdout: "# branch.head main\0", stderr: "", exitCode: 0 };
			if (args.includes("log"))
				return { stdout: "Commit\n", stderr: "", exitCode: 0 };
			if (args[0] === "check-ref-format" || args.includes("--verify"))
				return { stdout: `${head}\n`, stderr: "", exitCode: 0 };
			throw new Error(`Unexpected git args: ${args.join(" ")}`);
		});

		try {
			await expect(
				createRepositoryWorktree(
					"repo-id",
					{
						mode: "new_branch",
						branchName: "feature",
						startPoint: "main",
						path: path.join(linkedPath, "nested"),
					},
					{ runner },
				),
			).rejects.toMatchObject({ code: "path_conflict" });
			expect(
				vi.mocked(runner).mock.calls.some(([args]) => args.includes("add")),
			).toBe(false);
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	it("reads prune preview entries written to stderr", async () => {
		const baseRunner = cleanRepositoryRunner();
		const runner: GitCommandRunner = vi.fn(async (args, options) => {
			if (args.includes("prune"))
				return {
					stdout: "",
					stderr: "Removing worktrees/stale\n",
					exitCode: 0,
				};
			return baseRunner(args, options);
		});

		const result = await previewRepositoryWorktreePrune("repo-id", { runner });

		expect(result.entries).toEqual(["Removing worktrees/stale"]);
	});

	it("never removes the protected base worktree", async () => {
		const runner = cleanRepositoryRunner();
		const listed = await listRepositoryWorktrees("repo-id", { runner });

		await expect(
			removeRepositoryWorktree(
				"repo-id",
				{ worktreeId: listed.worktrees[0].id, expectedHead: head },
				{ runner },
			),
		).rejects.toMatchObject({ code: "base_worktree_protected" });
		expect(
			vi.mocked(runner).mock.calls.some(([args]) => args.includes("remove")),
		).toBe(false);
	});

	it("never removes the repository target branch from a linked worktree", async () => {
		const runner: GitCommandRunner = vi.fn(async (args) => {
			if (args[0] === "--version")
				return { stdout: "git version 2.52.0\n", stderr: "", exitCode: 0 };
			if (args.includes("--show-toplevel"))
				return { stdout: "/repo\n", stderr: "", exitCode: 0 };
			if (args.includes("--git-common-dir"))
				return { stdout: "/repo/.git\n", stderr: "", exitCode: 0 };
			if (args.includes("list"))
				return {
					stdout: [
						"worktree /repo",
						`HEAD ${head}`,
						"branch refs/heads/feature",
						"",
						"worktree /repo-worktrees/main",
						`HEAD ${head}`,
						"branch refs/heads/main",
						"",
					].join("\0"),
					stderr: "",
					exitCode: 0,
				};
			if (args.includes("status"))
				return {
					stdout:
						args[1] === "/repo-worktrees/main"
							? "# branch.head main\0"
							: "# branch.head feature\0",
					stderr: "",
					exitCode: 0,
				};
			if (args.includes("log"))
				return { stdout: "Commit\n", stderr: "", exitCode: 0 };
			throw new Error(`Unexpected git args: ${args.join(" ")}`);
		});
		const listed = await listRepositoryWorktrees("repo-id", { runner });
		const target = listed.worktrees.find((item) => item.branch === "main");

		expect(target).toMatchObject({
			isBase: false,
			canRemove: false,
			removeBlockers: ["target_branch_protected"],
		});
		await expect(
			removeRepositoryWorktree(
				"repo-id",
				{ worktreeId: target?.id || "", expectedHead: head },
				{ runner },
			),
		).rejects.toMatchObject({ code: "target_branch_protected" });
		expect(
			vi.mocked(runner).mock.calls.some(([args]) => args.includes("remove")),
		).toBe(false);
	});

	it("removes a dirty non-base worktree and its local branch only after explicit discard", async () => {
		let removed = false;
		const runner: GitCommandRunner = vi.fn(async (args) => {
			if (args[0] === "--version")
				return { stdout: "git version 2.52.0\n", stderr: "", exitCode: 0 };
			if (args.includes("--show-toplevel"))
				return { stdout: "/repo\n", stderr: "", exitCode: 0 };
			if (args.includes("--git-common-dir"))
				return { stdout: "/repo/.git\n", stderr: "", exitCode: 0 };
			if (args.includes("list"))
				return {
					stdout: [
						"worktree /repo",
						`HEAD ${head}`,
						"branch refs/heads/main",
						"",
						...(removed
							? []
							: [
									"worktree /repo-worktrees/feature",
									`HEAD ${head}`,
									"branch refs/heads/feature",
									"",
								]),
					].join("\0"),
					stderr: "",
					exitCode: 0,
				};
			if (args.includes("status"))
				return {
					stdout:
						args[1] === "/repo-worktrees/feature"
							? "# branch.head feature\0? untracked.txt\0"
							: "# branch.head main\0",
					stderr: "",
					exitCode: 0,
				};
			if (args.includes("log"))
				return { stdout: "Commit\n", stderr: "", exitCode: 0 };
			if (args.includes("remove")) {
				removed = true;
				return { stdout: "", stderr: "", exitCode: 0 };
			}
			if (args.includes("update-ref"))
				return { stdout: "", stderr: "", exitCode: 0 };
			throw new Error(`Unexpected git args: ${args.join(" ")}`);
		});
		const listed = await listRepositoryWorktrees("repo-id", { runner });
		const feature = listed.worktrees.find((item) => item.branch === "feature");
		expect(feature).toMatchObject({
			canRemove: false,
			removeBlockers: ["worktree_dirty"],
		});

		await expect(
			removeRepositoryWorktree(
				"repo-id",
				{ worktreeId: feature?.id || "", expectedHead: head },
				{ runner },
			),
		).rejects.toMatchObject({ code: "worktree_dirty" });

		await expect(
			removeRepositoryWorktree(
				"repo-id",
				{
					worktreeId: feature?.id || "",
					expectedHead: head,
					discardChanges: true,
				},
				{ runner },
			),
		).resolves.toMatchObject({ removed: true, branch: "feature" });
		expect(runner).toHaveBeenCalledWith(
			[
				"-C",
				"/repo",
				"worktree",
				"remove",
				"--force",
				"--",
				"/repo-worktrees/feature",
			],
			{ timeoutMs: 60_000 },
		);
		expect(runner).toHaveBeenCalledWith(
			["-C", "/repo", "update-ref", "-d", "refs/heads/feature", head],
			{ timeoutMs: 60_000 },
		);
	});

	it("does not fall back to the base repository when a task target is missing", async () => {
		await expect(
			resolveTaskExecutionRoot(
				{
					repositoryId: "repo-id",
					repositoryPath: "/repo",
					worktreePath: "/repo-worktrees/missing",
				},
				{ runner: cleanRepositoryRunner() },
			),
		).rejects.toMatchObject({ code: "worktree_unavailable" });
	});
});
