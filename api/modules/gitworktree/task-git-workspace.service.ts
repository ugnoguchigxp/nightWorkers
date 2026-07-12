import { and, eq, isNull, or } from "drizzle-orm";
import {
	defaultProjectGitIntegrationPolicy,
	projectGitIntegrationPolicySchema,
	type RepositoryMaterializationIntent,
} from "../../../shared/schemas/git-integration.schema";
import { db } from "../../db/client";
import {
	implementationQueueEntries,
	repositories,
	taskGitWorkspaces,
	tasks,
} from "../../db/schema";
import { AppError } from "../../lib/errors";
import {
	createRepositoryWorktree,
	listRepositoryWorktrees,
} from "./gitworktree.service";
import { withRepositoryGitMutationLock } from "./repository-git-mutation-lock";
import * as workspaceRepo from "./task-git-workspace.repository";
import {
	newWorkspaceId,
	taskWorkspaceBranchName,
	taskWorkspacePath,
} from "./task-workspace-naming";

function policyFor(value: unknown) {
	return (
		projectGitIntegrationPolicySchema.safeParse(value).data ??
		defaultProjectGitIntegrationPolicy
	);
}

export async function ensureTaskGitWorkspace(input: {
	taskId: string;
	planReviewId: string;
	admissionKey: string;
	materializationIntent?: RepositoryMaterializationIntent;
}) {
	const existing = await workspaceRepo.getTaskGitWorkspace(input.taskId);
	if (existing) return existing;
	return db.transaction(async (tx) => {
		const current = await workspaceRepo.getTaskGitWorkspace(input.taskId, tx);
		if (current) return current;
		const [task] = await tx
			.select()
			.from(tasks)
			.where(eq(tasks.id, input.taskId));
		if (!task) throw new AppError(404, "task_not_found", "Task not found");
		const [repository] = await tx
			.select()
			.from(repositories)
			.where(eq(repositories.id, task.repositoryId));
		if (!repository)
			throw new AppError(404, "repository_not_found", "Repository not found");
		const policy = policyFor(repository.gitIntegrationPolicyJson);
		const id = newWorkspaceId();
		const intent = input.materializationIntent ?? {
			kind: "existing_git" as const,
		};
		const baseSourceBranch = taskWorkspaceBranchName({
			taskId: task.id,
			title: task.title,
		});
		const reservedBranches = await tx
			.select({ sourceBranch: taskGitWorkspaces.sourceBranch })
			.from(taskGitWorkspaces)
			.where(eq(taskGitWorkspaces.repositoryId, repository.id));
		const sourceBranch = reservedBranches.some(
			(row) => row.sourceBranch === baseSourceBranch,
		)
			? taskWorkspaceBranchName({
					taskId: task.id,
					title: task.title,
					allocationId: id,
				})
			: baseSourceBranch;
		return workspaceRepo.createTaskGitWorkspace(
			{
				id,
				taskId: task.id,
				repositoryId: repository.id,
				planReviewId: input.planReviewId,
				admissionKey: input.admissionKey,
				status:
					intent.kind === "existing_git"
						? "planned"
						: "waiting_for_repository_initialization",
				materializationKind: intent.kind,
				materializationIntentJson: intent,
				integrationPolicySnapshotJson: policy,
				sourceBranch,
				targetBranch: repository.branch,
				allocationVersion: 1,
				provisionAttempt: 0,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
			tx,
		);
	});
}

async function provisionTaskGitWorkspaceUnlocked(taskId: string) {
	let workspace = await workspaceRepo.getTaskGitWorkspace(taskId);
	if (!workspace)
		throw new AppError(404, "workspace_not_found", "Task workspace not found");
	if (
		["ready", "active", "reviewing", "integration_pending", "merged"].includes(
			workspace.status,
		)
	)
		return workspace;
	if (workspace.status === "waiting_for_repository_initialization") {
		workspace = await (
			await import("./repository-materialization.service")
		).materializeTaskGitWorkspaceRepository(taskId);
	}
	if (workspace.status !== "planned")
		throw new AppError(
			409,
			"workspace_not_provisionable",
			"Workspace is awaiting repository initialization",
		);
	const [repository, task] = await Promise.all([
		db
			.select()
			.from(repositories)
			.where(eq(repositories.id, workspace.repositoryId))
			.then((rows) => rows[0]),
		db
			.select()
			.from(tasks)
			.where(eq(tasks.id, workspace.taskId))
			.then((rows) => rows[0]),
	]);
	if (!repository || !task)
		throw new AppError(
			404,
			"workspace_owner_missing",
			"Workspace owner is missing",
		);
	await workspaceRepo.transitionTaskGitWorkspace({
		id: workspace.id,
		expectedStatus: "planned",
		data: {
			status: "provisioning",
			provisionAttempt: workspace.provisionAttempt + 1,
		},
	});
	try {
		const targetBaseSha = await (await import("./gitworktree-cli"))
			.runGitCommand([
				"-C",
				repository.localPath,
				"rev-parse",
				"--verify",
				`${workspace.targetBranch}^{commit}`,
			])
			.then((result) => result.stdout.trim());
		const requestedPath = taskWorkspacePath({
			repositoryPath: repository.localPath,
			branch: workspace.sourceBranch,
		});
		const created = await createRepositoryWorktree(workspace.repositoryId, {
			mode: "new_branch",
			branchName: workspace.sourceBranch,
			startPoint: targetBaseSha,
			path: requestedPath,
		}).catch(async (error) => {
			const existing = await listRepositoryWorktrees(workspace.repositoryId);
			const adopted = existing.worktrees.find(
				(item) =>
					item.branch === workspace.sourceBranch &&
					item.head === targetBaseSha &&
					item.canonicalPath === requestedPath,
			);
			if (adopted) return adopted;
			throw error;
		});
		const ready = await db.transaction(async (tx) => {
			const [updated] = await tx
				.update(tasks)
				.set({ worktreePath: created.canonicalPath, updatedAt: new Date() })
				.where(
					and(
						eq(tasks.id, task.id),
						or(
							isNull(tasks.worktreePath),
							eq(tasks.worktreePath, created.canonicalPath),
						),
					),
				)
				.returning();
			if (!updated)
				throw new AppError(
					409,
					"workspace_task_projection_failed",
					"Task projection failed",
				);
			const result = await workspaceRepo.transitionTaskGitWorkspace(
				{
					id: workspace.id,
					expectedStatus: "provisioning",
					data: {
						status: "ready",
						targetBaseSha,
						worktreePath: created.canonicalPath,
						worktreeId: created.id,
						expectedHeadSha: created.head,
						lastVerifiedHead: created.head,
						provisionedAt: new Date(),
					},
				},
				tx,
			);
			if (result) return result;
			const concurrent = await workspaceRepo.getTaskGitWorkspaceById(
				workspace.id,
				tx,
			);
			if (
				concurrent?.status === "ready" &&
				concurrent.worktreePath === created.canonicalPath &&
				concurrent.expectedHeadSha === created.head
			)
				return concurrent;
			throw new AppError(
				409,
				"workspace_transition_lost",
				"Workspace provisioning changed concurrently",
			);
		});
		return ready;
	} catch (error) {
		await workspaceRepo.transitionTaskGitWorkspace({
			id: workspace.id,
			expectedStatus: "provisioning",
			data: {
				status: "provision_failed",
				lastErrorCode:
					error instanceof AppError ? error.code : "workspace_provision_failed",
				lastErrorMessage:
					error instanceof Error
						? error.message
						: "Workspace provisioning failed",
			},
		});
		throw error;
	}
}

export async function provisionTaskGitWorkspace(taskId: string) {
	const workspace = await workspaceRepo.getTaskGitWorkspace(taskId);
	if (!workspace)
		throw new AppError(404, "workspace_not_found", "Task workspace not found");
	return withRepositoryGitMutationLock(
		workspace.repositoryId,
		"workspace_provision",
		() => provisionTaskGitWorkspaceUnlocked(taskId),
	).catch(async (error) => {
		if (
			!(error instanceof AppError) ||
			error.code !== "repository_git_mutation_locked"
		)
			throw error;
		for (let attempt = 0; attempt < 100; attempt++) {
			await new Promise((resolve) => setTimeout(resolve, 50));
			const current = await workspaceRepo.getTaskGitWorkspace(taskId);
			if (current && ["ready", "active"].includes(current.status))
				return current;
			if (current?.status === "provision_failed") break;
			try {
				return await withRepositoryGitMutationLock(
					workspace.repositoryId,
					"workspace_provision",
					() => provisionTaskGitWorkspaceUnlocked(taskId),
				);
			} catch (retryError) {
				if (
					!(retryError instanceof AppError) ||
					retryError.code !== "repository_git_mutation_locked"
				)
					throw retryError;
			}
		}
		throw error;
	});
}

export async function releaseProvisionedTaskWorkspace(input: {
	entryId: string;
	workspaceId: string;
}) {
	return db.transaction(async (tx) => {
		const workspace = await workspaceRepo.getTaskGitWorkspaceById(
			input.workspaceId,
			tx,
		);
		if (!workspace || !["ready", "active"].includes(workspace.status))
			throw new AppError(
				409,
				"workspace_not_ready",
				"Dedicated workspace is not ready",
			);
		const [entry] = await tx
			.update(implementationQueueEntries)
			.set({
				workspaceId: workspace.id,
				workspaceRequired: true,
				claimReady: true,
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(implementationQueueEntries.id, input.entryId),
					eq(implementationQueueEntries.taskId, workspace.taskId),
					eq(implementationQueueEntries.repositoryId, workspace.repositoryId),
					eq(implementationQueueEntries.claimReady, false),
				),
			)
			.returning();
		if (!entry)
			throw new AppError(
				409,
				"workspace_queue_release_lost",
				"Queue entry changed before release",
			);
		return entry;
	});
}
