import crypto from "node:crypto";
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
import { inspectProjectRepositoryIdentity } from "../../services/git/project-repository-identity";
import {
	createRepositoryWorktree,
	listRepositoryWorktrees,
} from "./gitworktree.service";
import { withRepositoryGitMutationLock } from "./repository-git-mutation-lock";
import * as workspaceRepo from "./task-git-workspace.repository";
import {
	canRetryTaskGitWorkspaceInitialization,
	initializeTaskGitWorkspace,
} from "./task-git-workspace-initialization.service";
import {
	newWorkspaceId,
	taskWorkspaceBranchName,
	taskWorkspacePath,
} from "./task-workspace-naming";
import { attestTaskWorkspaceForRun } from "./workspace-attestation.service";

function policyFor(value: unknown) {
	return (
		projectGitIntegrationPolicySchema.safeParse(value).data ??
		defaultProjectGitIntegrationPolicy
	);
}

export async function ensureTaskGitWorkspace(input: {
	taskId: string;
	planReviewId: string | null;
	admissionKey: string;
	materializationIntent?: RepositoryMaterializationIntent;
}) {
	const existing = await workspaceRepo.getTaskGitWorkspace(input.taskId);
	if (existing) {
		if (
			existing.status === "waiting_for_repository_initialization" &&
			input.materializationIntent
		) {
			if (input.materializationIntent.kind === "existing_git") {
				return adoptExternallyMaterializedRepository(existing);
			}
			const initialized = await workspaceRepo.transitionTaskGitWorkspace({
				id: existing.id,
				expectedStatus: "waiting_for_repository_initialization",
				data: {
					status: "waiting_for_repository_initialization",
					materializationKind: input.materializationIntent.kind,
					materializationIntentJson: input.materializationIntent,
					lastErrorCode: null,
					lastErrorMessage: null,
				},
			});
			if (initialized) return initialized;
		}
		if (
			existing.status === "provision_failed" &&
			input.materializationIntent &&
			existing.provisionAttempt < 3
		) {
			const resumed = await workspaceRepo.transitionTaskGitWorkspace({
				id: existing.id,
				expectedStatus: "provision_failed",
				data: {
					status:
						input.materializationIntent.kind === "existing_git"
							? "planned"
							: "waiting_for_repository_initialization",
					materializationKind: input.materializationIntent.kind,
					materializationIntentJson: input.materializationIntent,
					lastErrorCode: null,
					lastErrorMessage: null,
				},
			});
			if (resumed) return resumed;
		}
		if (canRetryTaskGitWorkspaceInitialization(existing)) {
			const resumed = await workspaceRepo.transitionTaskGitWorkspace({
				id: existing.id,
				expectedStatus: "initialization_failed",
				data: {
					status: "initializing",
					leaseOwner: null,
					leaseExpiresAt: null,
					lastErrorCode: null,
					lastErrorMessage: null,
				},
			});
			if (resumed) return resumed;
		}
		return existing;
	}
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
				sourceRef: `refs/heads/${sourceBranch}`,
				targetRef: `refs/heads/${repository.branch}`,
				repositoryIdentityRevision: repository.repositoryIdentityRevision,
				repositoryIdentityDigest: repository.repositoryIdentityDigest,
				baseWorktreeId: repository.baseWorktreeId,
				baseWorktreePathCanonical: repository.baseWorktreePathCanonical,
				gitCommonDirDigest: repository.gitCommonDirCanonical
					? digestGitIdentityPath(repository.gitCommonDirCanonical)
					: null,
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
		[
			"initializing",
			"initialization_failed",
			"ready",
			"active",
			"reviewing",
			"integration_pending",
			"merged",
		].includes(workspace.status)
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
		const initializing = await db.transaction(async (tx) => {
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
						status: "initializing",
						leaseOwner: null,
						leaseExpiresAt: null,
						targetBaseSha,
						worktreePath: created.canonicalPath,
						taskWorktreePathCanonical: created.canonicalPath,
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
				concurrent?.status === "initializing" &&
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
		return initializing;
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

function digestGitIdentityPath(value: string) {
	return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

async function adoptExternallyMaterializedRepository(
	workspace: NonNullable<
		Awaited<ReturnType<typeof workspaceRepo.getTaskGitWorkspace>>
	>,
) {
	const [repository] = await db
		.select()
		.from(repositories)
		.where(eq(repositories.id, workspace.repositoryId));
	if (!repository)
		throw new AppError(404, "repository_not_found", "Repository not found");
	const identity = await inspectProjectRepositoryIdentity(repository.localPath);
	if (identity.status !== "ready") {
		throw new AppError(
			409,
			"repository_materialization_identity_invalid",
			"Materialized repository identity is not ready",
		);
	}
	return db.transaction(async (tx) => {
		const nextRevision = repository.repositoryIdentityRevision + 1;
		await tx
			.update(repositories)
			.set({
				localPath: identity.registeredRootCanonical,
				repositoryKind: identity.repositoryKind,
				repositoryIdentityStatus: identity.status,
				registeredRootCanonical: identity.registeredRootCanonical,
				gitCommonDirCanonical: identity.gitCommonDirCanonical,
				baseWorktreePathCanonical: identity.baseWorktreePathCanonical,
				baseWorktreeId: identity.baseWorktreeId,
				baseWorktreeBranch: identity.observedBranch,
				baseWorktreeHeadSha: identity.observedHeadSha,
				baseWorktreeDirty: identity.baseWorktreeDirty,
				repositoryIdentityDigest: identity.digest,
				repositoryIdentityRevision: nextRevision,
				repositoryIdentityVerifiedAt: new Date(identity.verifiedAt),
				updatedAt: new Date(),
			})
			.where(eq(repositories.id, repository.id));
		const adopted = await workspaceRepo.transitionTaskGitWorkspace(
			{
				id: workspace.id,
				expectedStatus: "waiting_for_repository_initialization",
				data: {
					status: "planned",
					materializationKind: "existing_git",
					materializationIntentJson: { kind: "existing_git" },
					repositoryIdentityRevision: nextRevision,
					repositoryIdentityDigest: identity.digest,
					baseWorktreeId: identity.baseWorktreeId,
					baseWorktreePathCanonical: identity.baseWorktreePathCanonical,
					gitCommonDirDigest: identity.gitCommonDirCanonical
						? digestGitIdentityPath(identity.gitCommonDirCanonical)
						: null,
					lastErrorCode: null,
					lastErrorMessage: null,
				},
			},
			tx,
		);
		if (!adopted) {
			throw new AppError(
				409,
				"repository_materialization_changed",
				"Repository materialization changed concurrently",
			);
		}
		return adopted;
	});
}

export async function provisionTaskGitWorkspace(
	taskId: string,
	options: { signal?: AbortSignal; timeoutMs?: number } = {},
) {
	const workspace = await workspaceRepo.getTaskGitWorkspace(taskId);
	if (!workspace)
		throw new AppError(404, "workspace_not_found", "Task workspace not found");
	const provisioned = await withRepositoryGitMutationLock(
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
			if (
				current &&
				["initializing", "initialization_failed"].includes(current.status)
			)
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
	const initialized = await initializeTaskGitWorkspace(provisioned, options);
	if (!["ready", "active"].includes(initialized.status)) return initialized;
	const attested = await attestTaskWorkspaceForRun({
		taskId: initialized.taskId,
		requireClean: true,
	});
	return attested.workspace;
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
		if (
			!workspace.lastAttestationId ||
			!workspace.lastAttestationDigest ||
			workspace.attestationRevision < 1
		) {
			throw new AppError(
				409,
				"workspace_attestation_required",
				"Dedicated workspace attestation is required",
			);
		}
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
