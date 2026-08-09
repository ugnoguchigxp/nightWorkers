import { describe, expect, it, vi } from "vitest";
import {
	findAddedGitEntries,
	findRemovedGitEntries,
	parseGitWorktreePaths,
	readGitWorktreePaths,
	readNightWorkersBranchRefs,
} from "../scripts/git-worktree-leak-guard.mjs";

describe("Git worktree leak guard", () => {
	it("parses NUL-delimited worktree paths without treating metadata as paths", () => {
		expect(
			parseGitWorktreePaths(
				[
					"worktree /repo",
					"HEAD abc",
					"branch refs/heads/main",
					"",
					"worktree /tmp/repo worktree",
					"HEAD def",
					"branch refs/heads/test",
					"",
				].join("\0"),
			),
		).toEqual(["/repo", "/tmp/repo worktree"]);
	});

	it("reports only paths added after the baseline", () => {
		expect(
			findAddedGitEntries(
				["/repo", "/tmp/existing"],
				["/tmp/new", "/repo", "/tmp/new", "/tmp/existing"],
			),
		).toEqual(["/tmp/new"]);
	});

	it("reports baseline paths removed by the test run", () => {
		expect(
			findRemovedGitEntries(["/repo", "/tmp/existing"], ["/repo", "/tmp/new"]),
		).toEqual(["/tmp/existing"]);
	});

	it("reads worktrees through the injected Git command", () => {
		const execute = vi.fn(() => "worktree /repo\0HEAD abc\0\0");
		expect(readGitWorktreePaths("/repo", { execFileSync: execute })).toEqual([
			"/repo",
		]);
		expect(execute).toHaveBeenCalledWith(
			"git",
			["-C", "/repo", "worktree", "list", "--porcelain", "-z"],
			{ encoding: "utf8", timeout: 30_000, maxBuffer: 10 * 1024 * 1024 },
		);
	});

	it("reads only NightWorkers-owned branch refs", () => {
		const execute = vi.fn(
			() => "refs/heads/nightworkers/a\nrefs/heads/nightworkers/b\n",
		);
		expect(
			readNightWorkersBranchRefs("/repo", { execFileSync: execute }),
		).toEqual(["refs/heads/nightworkers/a", "refs/heads/nightworkers/b"]);
		expect(execute).toHaveBeenCalledWith(
			"git",
			[
				"-C",
				"/repo",
				"for-each-ref",
				"--format=%(refname)",
				"refs/heads/nightworkers/",
			],
			{ encoding: "utf8", timeout: 30_000, maxBuffer: 10 * 1024 * 1024 },
		);
	});
});
