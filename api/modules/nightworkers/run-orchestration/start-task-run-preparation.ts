import fs from "node:fs/promises";
import { AppError } from "../../../lib/errors";
import { resolveTaskExecutionRoot } from "../../gitworktree/gitworktree.service";
import { runGitCommand } from "../../gitworktree/gitworktree-cli";
import { getTaskGitWorkspace } from "../../gitworktree/task-git-workspace.repository";
import { getProjectSecurityIntelligenceSettings } from "../../ontology";
import { getProjectExplorationCatalogSettings } from "../../ontology/exploration/project-exploration-settings.service";
import { getFreshProjectMeta } from "../../project-detail/project-meta.service";
import * as repo from "../nightworkers.repository";
import { readPromptImageAttachments } from "../prompt-image-attachments";
import {
	buildCompiledPromptText,
	findLatestImplementationHandoffMessage,
	resolveLatestJobTypeFromMessages,
} from "./runtime-routing";
import type { StartTaskRunOptions } from "./start-task-run-types";

export async function prepareTaskRunStart(input: {
	task: NonNullable<Awaited<ReturnType<typeof repo.getTask>>>;
	options: StartTaskRunOptions;
}) {
	const repoInfo = await repo.getRepository(input.task.repositoryId);
	if (!repoInfo?.localPath) {
		throw new AppError(
			422,
			"REPO_PATH_INVALID",
			"Repository path is not configured",
		);
	}
	const executionRoot = await resolveTaskExecutionRoot({
		repositoryId: input.task.repositoryId,
		repositoryPath: repoInfo.localPath,
		worktreePath: input.task.worktreePath,
	});
	let stat: Awaited<ReturnType<typeof fs.stat>>;
	try {
		stat = await fs.stat(executionRoot);
	} catch {
		throw new AppError(
			422,
			"REPO_PATH_INVALID",
			"Repository path does not exist",
		);
	}
	if (!stat.isDirectory()) {
		throw new AppError(
			422,
			"REPO_PATH_INVALID",
			"Repository path is not a directory",
		);
	}
	const [
		projectMeta,
		securityIntelligence,
		projectExplorationCatalogSettings,
		messages,
	] = await Promise.all([
		getFreshProjectMeta(repoInfo),
		getProjectSecurityIntelligenceSettings(repoInfo.id),
		getProjectExplorationCatalogSettings(repoInfo.id),
		repo.listTaskMessages(input.task.id),
	]);
	const lastUserMessage = [...messages]
		.reverse()
		.find((message) => message.role === "user");
	const jobType = resolveLatestJobTypeFromMessages(messages);
	const executionMode = "implementation" as const;
	if (
		executionMode === "implementation" &&
		input.options.missionPilotPhase !== "repository_bootstrap"
	) {
		const workspace = await getTaskGitWorkspace(input.task.id);
		if (workspace) {
			if (
				!input.task.worktreePath ||
				workspace.worktreePath !== executionRoot
			) {
				throw new AppError(
					409,
					"workspace_execution_root_mismatch",
					"実装は割り当て済みの Git workspace でのみ開始できます",
				);
			}
			if (!["ready", "active"].includes(workspace.status)) {
				throw new AppError(
					409,
					"workspace_not_ready",
					"割り当て済み Git workspace はまだ実行可能ではありません",
				);
			}
			const [branch, head] = await Promise.all([
				runGitCommand(["-C", executionRoot, "branch", "--show-current"]),
				runGitCommand(["-C", executionRoot, "rev-parse", "HEAD"]),
			]);
			if (
				branch.stdout.trim() !== workspace.sourceBranch ||
				(workspace.expectedHeadSha &&
					head.stdout.trim() !== workspace.expectedHeadSha)
			) {
				throw new AppError(
					409,
					"workspace_head_mismatch",
					"実行開始前に割り当て済み Git workspace の branch または HEAD が変化しました",
				);
			}
		}
	}
	const executionModeSource = "explicit" as const;
	const implementationHandoffMessage =
		findLatestImplementationHandoffMessage(messages);
	const compiledPromptText = buildCompiledPromptText({
		task: input.task,
		lastUserMessage,
		implementationHandoffMessage,
	});
	if (!compiledPromptText.trim()) {
		throw new AppError(
			400,
			"EMPTY_PROMPT",
			"No user message found to start a run",
		);
	}
	return {
		repoInfo,
		executionRoot,
		projectMeta,
		securityIntelligence,
		projectExplorationCatalogSettings,
		messages,
		lastUserMessage,
		runtimeImageAttachments: readPromptImageAttachments(
			lastUserMessage?.metadataJson,
		),
		llmRouteOverride: input.options.routeOverride ?? null,
		jobType,
		executionMode,
		executionModeSource,
		implementationHandoffMessage,
		compiledPromptText,
	};
}
