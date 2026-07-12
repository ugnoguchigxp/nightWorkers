import fs from "node:fs/promises";
import { AppError } from "../../../lib/errors";
import { deriveTodoVerificationPolicyFromPromptText } from "../../../services/todo-runtime";
import { resolveTaskExecutionRoot } from "../../gitworktree/gitworktree.service";
import { getProjectSecurityIntelligenceSettings } from "../../ontology";
import { getFreshProjectMeta } from "../../project-detail/project-meta.service";
import * as repo from "../nightworkers.repository";
import { readPromptImageAttachments } from "../prompt-image-attachments";
import {
	buildCompiledPromptText,
	findLatestImplementationHandoffMessage,
	resolveExecutionModeFromMessages,
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
	const [projectMeta, securityIntelligence, messages] = await Promise.all([
		getFreshProjectMeta(repoInfo),
		getProjectSecurityIntelligenceSettings(repoInfo.id),
		repo.listTaskMessages(input.task.id),
	]);
	const lastUserMessage = [...messages]
		.reverse()
		.find((message) => message.role === "user");
	const jobType = resolveLatestJobTypeFromMessages(messages);
	const executionMode =
		input.options.executionMode ?? resolveExecutionModeFromMessages(messages);
	const executionModeSource = input.options.executionMode
		? (input.options.executionModeSource ?? "explicit")
		: "message_history";
	const implementationHandoffMessage =
		executionMode === "implementation"
			? findLatestImplementationHandoffMessage(messages)
			: undefined;
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
		verificationPolicy:
			deriveTodoVerificationPolicyFromPromptText(compiledPromptText),
	};
}
