import {
	p as defaultP,
	type SystemContextP,
} from "../../../systemContexts/catalog";
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
	p: SystemContextP = defaultP,
) {
	const workspace = readRuntimeWorkspaceContext(context);
	return p("codingAgent.workspace-context", {
		registeredRepoRoot: workspace.registeredRepoRoot,
		executionRoot: workspace.executionRoot,
		workspaceSource: workspace.source,
	})
		.trimEnd()
		.split("\n");
}
