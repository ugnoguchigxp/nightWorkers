import { execFileSync } from "node:child_process";

export function parseGitWorktreePaths(output) {
	return String(output)
		.split("\0")
		.filter((entry) => entry.startsWith("worktree "))
		.map((entry) => entry.slice("worktree ".length))
		.filter(Boolean)
		.sort();
}

export function readGitWorktreePaths(repositoryRoot, options = {}) {
	const execute = options.execFileSync ?? execFileSync;
	const output = execute(
		"git",
		[
			"-C",
			repositoryRoot,
			"worktree",
			"list",
			"--porcelain",
			"-z",
		],
		{ encoding: "utf8", timeout: 30_000, maxBuffer: 10 * 1024 * 1024 },
	);
	return parseGitWorktreePaths(output);
}

export function readNightWorkersBranchRefs(repositoryRoot, options = {}) {
	const execute = options.execFileSync ?? execFileSync;
	const output = execute(
		"git",
		[
			"-C",
			repositoryRoot,
			"for-each-ref",
			"--format=%(refname)",
			"refs/heads/nightworkers/",
		],
		{ encoding: "utf8", timeout: 30_000, maxBuffer: 10 * 1024 * 1024 },
	);
	return String(output)
		.split("\n")
		.map((entry) => entry.trim())
		.filter(Boolean)
		.sort();
}

export function findAddedGitEntries(before, after) {
	const baseline = new Set(before);
	return [...new Set(after)].filter((item) => !baseline.has(item)).sort();
}

export function findRemovedGitEntries(before, after) {
	return findAddedGitEntries(after, before);
}
