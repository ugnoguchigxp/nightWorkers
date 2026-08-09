import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export type DedicatedTestWorkspace = {
	worktreePath: string;
	repositoryRoot: string | null;
	repositoryLocalPath: string;
	sourceBranch: string;
	sourceRef: string | null;
	targetBranch: string;
};

type GitWorktreeRecord = {
	path: string;
	branchRef: string | null;
};

export function removeDedicatedTestWorkspace(
	workspace: DedicatedTestWorkspace,
	options: { authorizedRoot?: string | null } = {},
) {
	const repositoryRoot =
		workspace.repositoryRoot?.trim() || workspace.repositoryLocalPath.trim();
	if (!repositoryRoot) {
		throw new Error("Dedicated test workspace repository root is required");
	}
	if (!workspace.worktreePath.trim()) {
		throw new Error("Dedicated test workspace path is required");
	}
	let canonicalRoot: string;
	try {
		canonicalRoot = fs.realpathSync(repositoryRoot);
	} catch (error) {
		if (isMissingPathError(error)) return;
		throw error;
	}
	const expectedRef = assertDedicatedTestBranchMetadata(workspace);
	const recordedWorktree = canonicalizePotentialPath(workspace.worktreePath);
	if (options.authorizedRoot) {
		const authorizedRoot = fs.realpathSync(options.authorizedRoot);
		assertPathInside(authorizedRoot, canonicalRoot, "repository root");
		assertPathInside(authorizedRoot, recordedWorktree, "worktree");
	}
	if (recordedWorktree === canonicalRoot) return;

	let records = readRegisteredWorktrees(canonicalRoot);
	const registeredWorktree = records.find(
		(candidate) =>
			canonicalizePotentialPath(candidate.path) === recordedWorktree,
	);
	if (registeredWorktree) {
		if (registeredWorktree.branchRef !== expectedRef) {
			throw new Error(
				"Dedicated test workspace path belongs to a different Git branch",
			);
		}
		execFileSync(
			"git",
			[
				"-C",
				canonicalRoot,
				"worktree",
				"remove",
				"--force",
				"--",
				registeredWorktree.path,
			],
			{ stdio: "ignore", timeout: 30_000 },
		);
	}

	if (workspace.sourceBranch === workspace.targetBranch) return;
	records = readRegisteredWorktrees(canonicalRoot);
	const otherBranchOwner = records.find(
		(candidate) => candidate.branchRef === expectedRef,
	);
	if (otherBranchOwner) {
		throw new Error(
			"Dedicated test workspace branch belongs to a different Git worktree",
		);
	}
	removeDedicatedTestBranch(canonicalRoot, workspace.sourceBranch, expectedRef);
}

function readRegisteredWorktrees(repositoryRoot: string): GitWorktreeRecord[] {
	const output = execFileSync(
		"git",
		["-C", repositoryRoot, "worktree", "list", "--porcelain", "-z"],
		{ encoding: "utf8", timeout: 30_000 },
	);
	const records: GitWorktreeRecord[] = [];
	let current: GitWorktreeRecord | null = null;
	for (const field of output.split("\0")) {
		if (field.startsWith("worktree ")) {
			if (current) records.push(current);
			current = {
				path: field.slice("worktree ".length),
				branchRef: null,
			};
			continue;
		}
		if (current && field.startsWith("branch ")) {
			current.branchRef = field.slice("branch ".length);
		}
	}
	if (current) records.push(current);
	return records;
}

function assertDedicatedTestBranchMetadata(
	workspace: Pick<
		DedicatedTestWorkspace,
		"sourceBranch" | "sourceRef" | "targetBranch"
	>,
) {
	if (!workspace.sourceBranch.startsWith("nightworkers/")) {
		throw new Error(
			"Dedicated test workspace branch is not NightWorkers-owned",
		);
	}
	const expectedRef = `refs/heads/${workspace.sourceBranch}`;
	if (workspace.sourceRef !== expectedRef) {
		throw new Error("Dedicated test workspace source ref is inconsistent");
	}
	return expectedRef;
}

function removeDedicatedTestBranch(
	repositoryRoot: string,
	sourceBranch: string,
	expectedRef: string,
) {
	try {
		execFileSync(
			"git",
			["-C", repositoryRoot, "branch", "-D", "--", sourceBranch],
			{ stdio: "ignore", timeout: 30_000 },
		);
	} catch (error) {
		if (!gitRefExists(repositoryRoot, expectedRef)) return;
		throw error;
	}
}

function gitRefExists(repositoryRoot: string, expectedRef: string) {
	try {
		execFileSync(
			"git",
			["-C", repositoryRoot, "show-ref", "--verify", "--quiet", expectedRef],
			{ stdio: "ignore", timeout: 30_000 },
		);
		return true;
	} catch (error) {
		if (gitRefMissing(error)) return false;
		throw error;
	}
}

function canonicalizePotentialPath(candidate: string) {
	let cursor = path.resolve(candidate);
	const missingSegments: string[] = [];
	while (true) {
		try {
			return path.join(fs.realpathSync(cursor), ...missingSegments);
		} catch (error) {
			if (!isMissingPathError(error)) throw error;
			const parent = path.dirname(cursor);
			if (parent === cursor) throw error;
			missingSegments.unshift(path.basename(cursor));
			cursor = parent;
		}
	}
}

function assertPathInside(root: string, candidate: string, label: string) {
	const relative = path.relative(root, candidate);
	if (
		!relative ||
		relative === ".." ||
		relative.startsWith(`..${path.sep}`) ||
		path.isAbsolute(relative)
	) {
		throw new Error(
			`Dedicated test workspace ${label} is outside its run root`,
		);
	}
}

function gitRefMissing(error: unknown) {
	return (
		typeof error === "object" &&
		error !== null &&
		"status" in error &&
		error.status === 1
	);
}

function isMissingPathError(error: unknown) {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		error.code === "ENOENT"
	);
}
