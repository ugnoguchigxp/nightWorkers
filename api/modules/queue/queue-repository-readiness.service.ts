import { AppError } from "../../lib/errors";
import { findLatestFeaturePlanMaterialization } from "../agentsShare";
import { repositoryHasGitHead } from "../gitworktree/repository-state.service";
import * as workspaceRepo from "../gitworktree/task-git-workspace.repository";
import {
	ensureTaskGitWorkspace,
	provisionTaskGitWorkspace,
} from "../gitworktree/task-git-workspace.service";
import * as nightworkersRepo from "../nightworkers/nightworkers.repository";

export async function prepareImplementationQueueRepository(input: {
	task: { id: string; repositoryId: string };
	messages: Array<{ id: string; metadataJson?: unknown }>;
}) {
	const repository = await nightworkersRepo.getRepository(
		input.task.repositoryId,
	);
	if (!repository?.localPath) {
		throw new AppError(
			422,
			"IMPLEMENTATION_REPOSITORY_PATH_REQUIRED",
			"Implementation requires a registered Project path.",
		);
	}
	const [hasGitHead, existingWorkspace] = await Promise.all([
		repositoryHasGitHead(repository.localPath),
		workspaceRepo.getTaskGitWorkspace(input.task.id),
	]);
	if (
		existingWorkspace &&
		["ready", "active"].includes(existingWorkspace.status)
	) {
		return existingWorkspace;
	}
	const featurePlan = findLatestFeaturePlanMaterialization(input.messages);
	if (
		!hasGitHead &&
		(!featurePlan?.intent || featurePlan.intent.kind === "existing_git")
	) {
		throw new AppError(
			422,
			"REPOSITORY_MATERIALIZATION_INTENT_REQUIRED",
			"Git HEAD is missing. Complete Plan Mode with a structured repository materialization intent before entering the Implementation Queue.",
		);
	}
	const materializationIntent = hasGitHead
		? ({ kind: "existing_git" } as const)
		: featurePlan?.intent;
	if (!materializationIntent) {
		throw new AppError(
			422,
			"REPOSITORY_MATERIALIZATION_INTENT_REQUIRED",
			"Repository materialization evidence is missing.",
		);
	}
	await ensureTaskGitWorkspace({
		taskId: input.task.id,
		planReviewId: null,
		admissionKey:
			existingWorkspace?.admissionKey ??
			`implementation-queue:${input.task.id}:${featurePlan?.featurePlanMessageId ?? "existing-git"}`,
		materializationIntent,
	});
	const workspace = await provisionTaskGitWorkspace(input.task.id);
	if (!["ready", "active"].includes(workspace.status)) {
		throw new AppError(
			409,
			"IMPLEMENTATION_WORKSPACE_NOT_READY",
			"Repository materialization and workspace provisioning must finish before entering the Implementation Queue.",
		);
	}
	return workspace;
}
