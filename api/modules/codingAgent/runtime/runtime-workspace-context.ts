import type { AgentRunContext } from "./types";

export type RuntimeWorkspaceContext = {
	version: 1;
	registeredRepoRoot: string;
	executionRoot: string;
	worktreeActive: boolean;
	source: "registered_repository" | "task_worktree";
};

export function readRuntimeWorkspaceContext(
	context: AgentRunContext,
): RuntimeWorkspaceContext {
	const request = context.contextSnapshot.request;
	const requestRecord =
		request && typeof request === "object" && !Array.isArray(request)
			? (request as Record<string, unknown>)
			: {};
	const registeredRepoRoot =
		typeof requestRecord.registeredRepositoryPath === "string" &&
		requestRecord.registeredRepositoryPath.trim()
			? requestRecord.registeredRepositoryPath.trim()
			: context.repoRoot;
	// 実行時 context を authority とし、保存済み snapshot が tool を別 root へ
	// リダイレクトしないよう executionRoot には repoRoot を採用する。
	const executionRoot = context.repoRoot;
	const worktreeActive = executionRoot !== registeredRepoRoot;
	return {
		version: 1,
		registeredRepoRoot,
		executionRoot,
		worktreeActive,
		source: worktreeActive ? "task_worktree" : "registered_repository",
	};
}

export function formatRuntimeWorkspaceContextForPrompt(
	context: AgentRunContext,
) {
	const workspace = readRuntimeWorkspaceContext(context);
	return [
		"Workspace context:",
		`- registeredRepoRoot: ${workspace.registeredRepoRoot}`,
		`- executionRoot: ${workspace.executionRoot}`,
		`- workspaceSource: ${workspace.source}`,
		`- repoRoot: ${workspace.executionRoot} (executionRoot の互換別名)`,
		"- リポジトリの読み書き、native command、NightWorkers managed tool は executionRoot を基準にする。registeredRepoRoot と異なる場合、登録元で実装・検証しない。run_check の cwd は executionRoot 相対で指定し、root なら省略する。",
	];
}
