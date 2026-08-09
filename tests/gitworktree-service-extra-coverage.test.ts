import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const deps = vi.hoisted(() => ({
	getRepository: vi.fn(),
	readUsage: vi.fn(),
	probeGit: vi.fn(),
	defaultRunner: vi.fn(),
	collectWorktrees: vi.fn(),
	canonicalize: vi.fn(),
	canonicalizeProspectivePath: vi.fn(),
	overlapsExisting: vi.fn(),
	branchSlug: vi.fn(),
	readdir: vi.fn(),
	gitDiffTool: vi.fn(),
}));

vi.mock("../api/modules/gitworktree/gitworktree.repository", () => ({
	getRepository: deps.getRepository,
	readUsage: deps.readUsage,
}));
vi.mock(
	"../api/modules/gitworktree/gitworktree-cli",
	async (importOriginal) => {
		const actual =
			await importOriginal<
				typeof import("../api/modules/gitworktree/gitworktree-cli")
			>();
		return {
			...actual,
			probeGit: deps.probeGit,
			runGitCommand: deps.defaultRunner,
		};
	},
);
vi.mock("../api/modules/gitworktree/gitworktree-list", () => ({
	collectWorktrees: deps.collectWorktrees,
}));
vi.mock("../api/modules/gitworktree/gitworktree-paths", () => ({
	branchSlug: deps.branchSlug,
	canonicalize: deps.canonicalize,
	canonicalizeProspectivePath: deps.canonicalizeProspectivePath,
	overlapsExisting: deps.overlapsExisting,
}));
vi.mock("node:fs/promises", () => ({ default: { readdir: deps.readdir } }));
vi.mock("../api/services/worker-tools/git", () => ({
	gitDiffTool: deps.gitDiffTool,
}));

import {
	assertGitworktreeAvailable,
	createRepositoryWorktree,
	listRepositoryWorktrees,
	previewRepositoryWorktreePrune,
	pruneRepositoryWorktrees,
	readRepositoryWorktreeDiff,
	removeRepositoryWorktree,
	resolveTaskExecutionRoot,
	resolveWorktreePath,
} from "../api/modules/gitworktree/gitworktree.service";
import {
	GitCliError,
	type GitCommandRunner,
} from "../api/modules/gitworktree/gitworktree-cli";

function repository(overrides: Record<string, unknown> = {}) {
	return {
		id: "repo-id",
		localPath: "/repo",
		branch: "main",
		...overrides,
	};
}

function worktree(overrides: Record<string, unknown> = {}) {
	return {
		id: "worktree-1",
		path: "/repo-worktrees/feature",
		canonicalPath: "/repo-worktrees/feature",
		isBase: false,
		head: "head-1",
		headSubject: "subject",
		branch: "feature",
		detached: false,
		bare: false,
		locked: false,
		lockReason: null,
		prunable: false,
		pruneReason: null,
		upstream: null,
		comparisonRef: null,
		comparisonSha: null,
		comparisonObservedAt: "2026-08-09T00:00:00.000Z",
		comparisonFreshness: "local_ref",
		ahead: 0,
		behind: 0,
		stagedCount: 0,
		modifiedCount: 0,
		untrackedCount: 0,
		conflictedCount: 0,
		usage: {
			taskIds: [],
			runIds: [],
			activeTaskCount: 0,
			activeRunCount: 0,
			pendingCloseoutCount: 0,
			workspaceBinding: null,
		},
		canRemove: true,
		removeBlockers: [],
		removeWarnings: [],
		...overrides,
	} as never;
}

function runner(
	override?: (args: string[], options?: Record<string, unknown>) => unknown,
): GitCommandRunner {
	return vi.fn(async (args, options) => {
		const result = override?.(args, options);
		if (result instanceof Error) throw result;
		if (result !== undefined) return result as never;
		if (args.includes("--show-toplevel"))
			return { stdout: "/repo\n", stderr: "", exitCode: 0 };
		if (args.includes("--git-common-dir"))
			return { stdout: "/repo/.git\n", stderr: "", exitCode: 0 };
		if (args.includes("list"))
			return { stdout: "porcelain", stderr: "", exitCode: 0 };
		if (args.includes("--verify") && args.includes("rev-parse"))
			return { stdout: "head-start\n", stderr: "", exitCode: 0 };
		return { stdout: "", stderr: "", exitCode: 0 };
	});
}

function unavailable(overrides: Record<string, unknown> = {}) {
	return {
		git: { available: true, version: "git 2", reason: null },
		repository: { available: true, commonDir: "/repo/.git", reason: null },
		worktrees: [],
		refreshedAt: "now",
		...overrides,
	} as never;
}

beforeEach(() => {
	for (const mock of Object.values(deps)) mock.mockReset();
	deps.getRepository.mockResolvedValue(repository());
	deps.readUsage.mockResolvedValue(new Map());
	deps.probeGit.mockResolvedValue({
		available: true,
		version: "git version 2.52.0",
		reason: null,
	});
	deps.defaultRunner.mockImplementation(runner());
	deps.collectWorktrees.mockResolvedValue([]);
	deps.canonicalize.mockImplementation(async (value: string) =>
		path.resolve(value),
	);
	deps.canonicalizeProspectivePath.mockImplementation(async (value: string) =>
		path.resolve(value),
	);
	deps.overlapsExisting.mockReturnValue(false);
	deps.branchSlug.mockReturnValue("feature");
	deps.readdir.mockResolvedValue([]);
	deps.gitDiffTool.mockResolvedValue({
		ok: true,
		payload: { diff: "", diffStat: "", hasChanges: false },
	});
});

describe("gitworktree service extra coverage", () => {
	it("rejects missing repositories and supports default runner selection", async () => {
		deps.getRepository.mockResolvedValueOnce(null);
		await expect(listRepositoryWorktrees("missing")).rejects.toMatchObject({
			statusCode: 404,
		});

		deps.collectWorktrees.mockResolvedValueOnce([worktree()]);
		const listed = await listRepositoryWorktrees("repo-id");
		expect(listed.worktrees).toHaveLength(1);
		expect(deps.defaultRunner).toHaveBeenCalled();
	});

	it("returns Git-unavailable and all repository probe failure classifications", async () => {
		deps.probeGit.mockResolvedValueOnce({
			available: false,
			version: null,
			reason: "git_not_found",
		});
		await expect(
			listRepositoryWorktrees("repo-id", { runner: runner() }),
		).resolves.toMatchObject({
			git: { available: false },
			repository: { available: false, reason: null },
			worktrees: [],
		});

		for (const [error, reason] of [
			[
				new GitCliError("git_command_failed", "not a repository"),
				"not_git_repository",
			],
			[
				new GitCliError("git_command_timed_out", "timeout"),
				"repository_probe_failed",
			],
			[new Error("probe crashed"), "repository_probe_failed"],
		] as const) {
			const failedRunner = runner((args) =>
				args.includes("--show-toplevel") ? error : undefined,
			);
			const result = await listRepositoryWorktrees("repo-id", {
				runner: failedRunner,
			});
			expect(result.repository).toMatchObject({ available: false, reason });
		}
	});

	it("maps worktree-list Git and non-Git failures to stable application errors", async () => {
		for (const [error, code, statusCode] of [
			[
				new GitCliError("git_command_timed_out", "timeout"),
				"git_command_timed_out",
				504,
			],
			[
				new GitCliError("git_output_too_large", "large"),
				"git_output_too_large",
				502,
			],
			[new GitCliError("git_not_found", "missing"), "git_not_found", 503],
			[new GitCliError("git_command_failed", "bad"), "git_command_failed", 409],
			[new GitCliError("git_command_failed", ""), "git_command_failed", 409],
			[new Error("raw"), "git_command_failed", 409],
		] as const) {
			const failed = runner((args) =>
				args.includes("list") ? error : undefined,
			);
			await expect(
				listRepositoryWorktrees("repo-id", { runner: failed }),
			).rejects.toMatchObject({ code, statusCode });
		}
	});

	it("asserts Git and repository availability with fallback reasons", () => {
		for (const [data, code] of [
			[
				unavailable({
					git: { available: false, version: null, reason: "git_not_found" },
				}),
				"git_not_found",
			],
			[
				unavailable({
					git: { available: false, version: null, reason: null },
				}),
				"git_probe_failed",
			],
			[
				unavailable({
					repository: { available: false, commonDir: null, reason: null },
				}),
				"not_git_repository",
			],
		] as const) {
			expect(() => assertGitworktreeAvailable(data)).toThrowError(
				expect.objectContaining({ code }),
			);
		}
		expect(() => assertGitworktreeAvailable(unavailable())).not.toThrow();
	});

	it("resolves worktree ids and repository-only execution roots", async () => {
		deps.collectWorktrees.mockResolvedValueOnce([worktree()]);
		await expect(
			resolveWorktreePath("repo-id", "worktree-1", { runner: runner() }),
		).resolves.toBe("/repo-worktrees/feature");

		deps.collectWorktrees.mockResolvedValueOnce([]);
		await expect(
			resolveWorktreePath("repo-id", "missing", { runner: runner() }),
		).rejects.toMatchObject({ code: "worktree_not_found" });

		await expect(
			resolveTaskExecutionRoot({
				repositoryId: "repo-id",
				repositoryPath: "/repo/../repo",
			}),
		).resolves.toBe("/repo");
	});

	it("validates execution worktree existence, canonical path, bare and prunable state", async () => {
		for (const [items, code] of [
			[[], "worktree_unavailable"],
			[
				[worktree({ canonicalPath: "/repo-worktrees/other" })],
				"worktree_unavailable",
			],
			[[worktree({ prunable: true })], "worktree_unavailable"],
			[[worktree({ bare: true })], "worktree_unavailable"],
		] as const) {
			deps.collectWorktrees.mockResolvedValueOnce(items);
			await expect(
				resolveTaskExecutionRoot(
					{
						repositoryId: "repo-id",
						repositoryPath: "/repo",
						worktreePath: "/repo-worktrees/feature",
					},
					{ runner: runner() },
				),
			).rejects.toMatchObject({ code });
		}

		deps.collectWorktrees.mockResolvedValueOnce([worktree()]);
		await expect(
			resolveTaskExecutionRoot(
				{
					repositoryId: "repo-id",
					repositoryPath: "/repo",
					worktreePath: "/repo-worktrees/feature",
				},
				{ runner: runner() },
			),
		).resolves.toBe("/repo-worktrees/feature");
	});

	it("rejects invalid branches, start points, duplicate branches, and missing existing branches", async () => {
		const cases = [
			{
				request: { mode: "new_branch", branchName: "bad", startPoint: "main" },
				errorAt: "check-ref-format",
				error: new GitCliError("git_command_failed", "invalid"),
				code: "branch_invalid",
				statusCode: 400,
			},
			{
				request: { mode: "new_branch", branchName: "bad", startPoint: "main" },
				errorAt: "check-ref-format",
				error: new GitCliError("git_command_timed_out", "timeout"),
				code: "git_command_timed_out",
				statusCode: 504,
			},
			{
				request: {
					mode: "new_branch",
					branchName: "feature",
					startPoint: "missing",
				},
				errorAt: "missing^{commit}",
				error: new GitCliError("git_command_failed", "missing"),
				code: "start_point_invalid",
				statusCode: 400,
			},
			{
				request: { mode: "existing_branch", branchName: "missing" },
				errorAt: "show-ref",
				error: new Error("missing"),
				code: "branch_invalid",
				statusCode: 400,
			},
		] as const;
		for (const item of cases) {
			deps.collectWorktrees.mockResolvedValueOnce([]);
			const commandRunner = runner((args) =>
				args.some((arg) => arg.includes(item.errorAt)) ? item.error : undefined,
			);
			await expect(
				createRepositoryWorktree("repo-id", item.request as never, {
					runner: commandRunner,
				}),
			).rejects.toMatchObject({ code: item.code, statusCode: item.statusCode });
		}

		deps.collectWorktrees.mockResolvedValueOnce([
			worktree({ branch: "feature" }),
		]);
		await expect(
			createRepositoryWorktree(
				"repo-id",
				{ mode: "new_branch", branchName: "feature", startPoint: "main" },
				{ runner: runner() },
			),
		).rejects.toMatchObject({ code: "branch_already_checked_out" });
	});

	it("rejects relative, overlapping, inaccessible, unexpected, and non-empty paths", async () => {
		const request = {
			mode: "new_branch" as const,
			branchName: "feature",
			startPoint: "main",
		};
		deps.collectWorktrees.mockResolvedValueOnce([]);
		await expect(
			createRepositoryWorktree(
				"repo-id",
				{ ...request, path: "relative" },
				{ runner: runner() },
			),
		).rejects.toMatchObject({ code: "path_conflict" });

		deps.collectWorktrees.mockResolvedValueOnce([
			worktree({ branch: "other" }),
		]);
		deps.overlapsExisting.mockReturnValueOnce(true);
		await expect(
			createRepositoryWorktree(
				"repo-id",
				{ ...request, path: "/overlap" },
				{ runner: runner() },
			),
		).rejects.toMatchObject({ code: "path_conflict" });

		for (const code of ["ENOTDIR", "EACCES"] as const) {
			deps.collectWorktrees.mockResolvedValueOnce([]);
			deps.readdir.mockRejectedValueOnce(
				Object.assign(new Error(code), { code }),
			);
			await expect(
				createRepositoryWorktree(
					"repo-id",
					{ ...request, path: "/blocked" },
					{ runner: runner() },
				),
			).rejects.toMatchObject({ code: "path_conflict" });
		}

		deps.collectWorktrees.mockResolvedValueOnce([]);
		const raw = Object.assign(new Error("io failed"), { code: "EIO" });
		deps.readdir.mockRejectedValueOnce(raw);
		await expect(
			createRepositoryWorktree(
				"repo-id",
				{ ...request, path: "/io" },
				{ runner: runner() },
			),
		).rejects.toBe(raw);

		deps.collectWorktrees.mockResolvedValueOnce([]);
		deps.readdir.mockResolvedValueOnce(["occupied"]);
		await expect(
			createRepositoryWorktree(
				"repo-id",
				{ ...request, path: "/full" },
				{ runner: runner() },
			),
		).rejects.toMatchObject({ code: "path_not_empty" });
	});

	it("creates new and existing branch worktrees and handles ENOENT targets", async () => {
		for (const request of [
			{ mode: "new_branch", branchName: "feature", startPoint: "main" },
			{ mode: "existing_branch", branchName: "feature", path: "/custom" },
		] as const) {
			const target = request.path ?? "/repo-worktrees/feature";
			const created = worktree({
				canonicalPath: target,
				path: target,
				head: "head-start",
			});
			deps.collectWorktrees
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([created]);
			if (request.mode === "new_branch") {
				deps.readdir.mockRejectedValueOnce(
					Object.assign(new Error("missing"), { code: "ENOENT" }),
				);
			}
			await expect(
				createRepositoryWorktree("repo-id", request, { runner: runner() }),
			).resolves.toBe(created);
		}
	});

	it("maps add failures and rejects missing or mismatched post-create verification", async () => {
		const request = {
			mode: "new_branch" as const,
			branchName: "feature",
			startPoint: "main",
		};
		deps.collectWorktrees.mockResolvedValueOnce([]);
		await expect(
			createRepositoryWorktree("repo-id", request, {
				runner: runner((args) =>
					args.includes("add") ? new Error("add failed") : undefined,
				),
			}),
		).rejects.toMatchObject({ code: "git_command_failed" });

		for (const after of [
			[],
			[worktree({ branch: "other", head: "head-start" })],
			[worktree({ branch: "feature", head: "different" })],
		]) {
			deps.collectWorktrees
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce(after);
			await expect(
				createRepositoryWorktree("repo-id", request, { runner: runner() }),
			).rejects.toMatchObject({ code: "created_but_unverified" });
		}
	});

	it("reads, truncates, and reports worktree diff failures", async () => {
		deps.collectWorktrees.mockResolvedValueOnce([worktree()]);
		deps.gitDiffTool.mockResolvedValueOnce({
			ok: true,
			payload: {
				diff: "x".repeat(200_001),
				diffStat: "1 file",
				hasChanges: true,
			},
		});
		const diff = await readRepositoryWorktreeDiff("repo-id", "worktree-1", {
			runner: runner(),
		});
		expect(diff.diff).toHaveLength(200_000);
		expect(diff.truncated).toBe(true);

		deps.collectWorktrees.mockResolvedValueOnce([worktree()]);
		deps.gitDiffTool.mockResolvedValueOnce({
			ok: false,
			payload: {},
			error: { code: "GIT", message: "diff failed" },
		});
		await expect(
			readRepositoryWorktreeDiff("repo-id", "worktree-1", { runner: runner() }),
		).rejects.toMatchObject({
			code: "git_command_failed",
			message: "diff failed",
		});

		deps.collectWorktrees.mockResolvedValueOnce([worktree()]);
		deps.gitDiffTool.mockResolvedValueOnce({ ok: false, payload: {} });
		await expect(
			readRepositoryWorktreeDiff("repo-id", "worktree-1", { runner: runner() }),
		).rejects.toMatchObject({ message: "Git diff failed" });
	});

	it("validates remove identity, blockers, discard behavior, and target branch", async () => {
		const request = { worktreeId: "worktree-1", expectedHead: "head-1" };
		for (const [items, expectedRequest, code] of [
			[[], request, "worktree_not_found"],
			[[worktree()], { ...request, expectedHead: "old" }, "worktree_changed"],
			[
				[
					worktree({
						removeBlockers: ["worktree_locked"],
						removeWarnings: ["upstream_missing"],
					}),
				],
				request,
				"worktree_locked",
			],
			[[worktree({ branch: "main" })], request, "target_branch_protected"],
		] as const) {
			deps.collectWorktrees.mockResolvedValueOnce(items);
			await expect(
				removeRepositoryWorktree("repo-id", expectedRequest as never, {
					runner: runner(),
				}),
			).rejects.toMatchObject({ code });
		}

		deps.collectWorktrees.mockResolvedValueOnce([
			worktree({ removeBlockers: ["worktree_dirty", "worktree_in_use"] }),
		]);
		await expect(
			removeRepositoryWorktree(
				"repo-id",
				{ ...request, discardChanges: true },
				{ runner: runner() },
			),
		).rejects.toMatchObject({ code: "worktree_in_use" });
	});

	it("maps remove and branch-delete errors including non-Error causes", async () => {
		const request = { worktreeId: "worktree-1", expectedHead: "head-1" };
		deps.collectWorktrees.mockResolvedValueOnce([worktree()]);
		await expect(
			removeRepositoryWorktree("repo-id", request, {
				runner: runner((args) =>
					args.includes("remove")
						? new GitCliError("git_output_too_large", "large")
						: undefined,
				),
			}),
		).rejects.toMatchObject({ code: "git_output_too_large" });

		for (const error of [new Error("delete failed"), "raw delete failure"]) {
			deps.collectWorktrees.mockResolvedValueOnce([worktree()]);
			const deleteRunner = vi.fn(async (args: string[]) => {
				if (args.includes("--show-toplevel"))
					return { stdout: "/repo\n", stderr: "", exitCode: 0 };
				if (args.includes("--git-common-dir"))
					return { stdout: "/repo/.git\n", stderr: "", exitCode: 0 };
				if (args.includes("list"))
					return { stdout: "porcelain", stderr: "", exitCode: 0 };
				if (args.includes("update-ref")) throw error;
				return { stdout: "", stderr: "", exitCode: 0 };
			});
			await expect(
				removeRepositoryWorktree("repo-id", request, { runner: deleteRunner }),
			).rejects.toMatchObject({
				code: "branch_delete_failed",
				details: expect.objectContaining({ worktreeRemoved: true }),
			});
		}
	});

	it("removes branchless worktrees, detects lingering worktrees, and deletes branches", async () => {
		const request = { worktreeId: "worktree-1", expectedHead: "head-1" };
		const branchless = worktree({ branch: null });
		deps.collectWorktrees
			.mockResolvedValueOnce([branchless])
			.mockResolvedValueOnce([]);
		await expect(
			removeRepositoryWorktree("repo-id", request, { runner: runner() }),
		).resolves.toEqual({
			removed: true,
			branch: null,
			branchDeleted: false,
			path: branchless.path,
		});

		deps.collectWorktrees
			.mockResolvedValueOnce([worktree()])
			.mockResolvedValueOnce([worktree()]);
		await expect(
			removeRepositoryWorktree("repo-id", request, { runner: runner() }),
		).rejects.toMatchObject({ code: "git_command_failed" });

		deps.collectWorktrees
			.mockResolvedValueOnce([worktree()])
			.mockResolvedValueOnce([]);
		await expect(
			removeRepositoryWorktree(
				"repo-id",
				{ ...request, discardChanges: true },
				{ runner: runner() },
			),
		).resolves.toMatchObject({ branch: "feature", branchDeleted: true });
	});

	it("previews, limits, skips, executes, and maps prune failures", async () => {
		deps.collectWorktrees.mockResolvedValue([]);
		const previewRunner = runner((args) =>
			args.includes("--dry-run")
				? {
						stdout: Array.from(
							{ length: 150 },
							(_, index) => `out-${index}`,
						).join("\n"),
						stderr: Array.from(
							{ length: 100 },
							(_, index) => `err-${index}`,
						).join("\n"),
						exitCode: 0,
					}
				: undefined,
		);
		const preview = await previewRepositoryWorktreePrune("repo-id", {
			runner: previewRunner,
		});
		expect(preview.entries).toHaveLength(200);

		const emptyRunner = runner((args) =>
			args.includes("--dry-run")
				? { stdout: "\n", stderr: "", exitCode: 0 }
				: undefined,
		);
		await expect(
			pruneRepositoryWorktrees("repo-id", { runner: emptyRunner }),
		).resolves.toEqual({ pruned: false, entries: [] });

		const successRunner = runner((args) =>
			args.includes("--dry-run")
				? { stdout: "stale\n", stderr: "", exitCode: 0 }
				: undefined,
		);
		await expect(
			pruneRepositoryWorktrees("repo-id", { runner: successRunner }),
		).resolves.toEqual({ pruned: true, entries: ["stale"] });

		const failedPreview = runner((args) =>
			args.includes("--dry-run") ? new Error("preview failed") : undefined,
		);
		await expect(
			previewRepositoryWorktreePrune("repo-id", { runner: failedPreview }),
		).rejects.toMatchObject({ code: "git_command_failed" });

		const failedPrune = runner((args) => {
			if (args.includes("--dry-run"))
				return { stdout: "stale", stderr: "", exitCode: 0 };
			if (args.includes("prune"))
				return new GitCliError("git_not_found", "gone");
			return undefined;
		});
		await expect(
			pruneRepositoryWorktrees("repo-id", { runner: failedPrune }),
		).rejects.toMatchObject({ code: "git_not_found" });
	});

	it("uses the default Git runner for create, remove, preview, and prune", async () => {
		const created = worktree({ head: "head-start" });
		deps.collectWorktrees
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([created]);
		await expect(
			createRepositoryWorktree("repo-id", {
				mode: "new_branch",
				branchName: "feature",
				startPoint: "main",
			}),
		).resolves.toBe(created);

		const branchless = worktree({ branch: null });
		deps.collectWorktrees
			.mockResolvedValueOnce([branchless])
			.mockResolvedValueOnce([]);
		await expect(
			removeRepositoryWorktree("repo-id", {
				worktreeId: "worktree-1",
				expectedHead: "head-1",
			}),
		).resolves.toMatchObject({ branchDeleted: false });

		deps.collectWorktrees.mockResolvedValueOnce([]);
		await expect(
			previewRepositoryWorktreePrune("repo-id"),
		).resolves.toMatchObject({ entries: [] });

		deps.collectWorktrees.mockResolvedValueOnce([]);
		await expect(pruneRepositoryWorktrees("repo-id")).resolves.toEqual({
			pruned: false,
			entries: [],
		});
		expect(deps.defaultRunner).toHaveBeenCalled();
	});
});
