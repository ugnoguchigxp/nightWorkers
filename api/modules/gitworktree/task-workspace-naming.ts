import crypto from "node:crypto";
import path from "node:path";
import { branchSlug } from "./gitworktree-paths";

function titleSlug(title: string) {
	return branchSlug(title).slice(0, 48);
}

export function taskWorkspaceBranchName(input: {
	taskId: string;
	title: string;
	allocationId?: string;
}) {
	const base = `nightworkers/${input.taskId.slice(0, 8)}-${titleSlug(input.title)}`;
	return input.allocationId
		? `${base}-${input.allocationId.slice(0, 6)}`
		: base;
}

export function taskWorkspacePath(input: {
	repositoryPath: string;
	branch: string;
}) {
	return path.join(
		path.dirname(input.repositoryPath),
		`${path.basename(input.repositoryPath)}-worktrees`,
		branchSlug(input.branch),
	);
}

export function newWorkspaceId() {
	return crypto.randomUUID();
}
