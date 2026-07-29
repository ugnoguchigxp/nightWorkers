import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { repositoryMaterializationIntentSchema } from "../../../shared/schemas/git-integration.schema";
import { db } from "../../db/client";
import { repositories } from "../../db/schema";
import { AppError } from "../../lib/errors";
import { inspectProjectRepositoryIdentity } from "../../services/git/project-repository-identity";
import { importProjectTool } from "../../services/worker-tools/import-project";
import { runGitCommand } from "./gitworktree-cli";
import * as workspaceRepo from "./task-git-workspace.repository";

export async function materializeTaskGitWorkspaceRepository(taskId: string) {
	const workspace = await workspaceRepo.getTaskGitWorkspace(taskId);
	if (!workspace)
		throw new AppError(404, "workspace_not_found", "Task workspace not found");
	if (workspace.status !== "waiting_for_repository_initialization")
		return workspace;
	const intent = repositoryMaterializationIntentSchema.parse(
		workspace.materializationIntentJson,
	);
	if (intent.kind === "existing_git")
		throw new AppError(
			409,
			"materialization_intent_invalid",
			"Existing Git intent cannot bootstrap an empty repository",
		);
	const [repository] = await db
		.select()
		.from(repositories)
		.where(eq(repositories.id, workspace.repositoryId));
	if (!repository)
		throw new AppError(404, "repository_not_found", "Repository not found");
	const result = await importProjectTool({
		repoRoot: repository.localPath,
		targetPath: repository.localPath,
		source: intent.source,
		...(intent.kind === "starter_template"
			? {
					stack: intent.stack,
					variant: intent.variant,
					overlays: intent.overlays,
				}
			: {
					repoUrl: intent.repoUrl,
					ref: intent.ref,
					depth: intent.depth,
					stripGitDir: intent.stripGitDir,
				}),
		initialize: true,
	});
	if (!result.ok || !result.payload?.postImport)
		throw new AppError(
			409,
			"repository_materialization_failed",
			result.error?.message ?? "Repository materialization failed",
		);
	await alignMaterializedRepositoryBranch({
		repositoryPath: repository.localPath,
		targetBranch: repository.branch,
	});
	const identity = await inspectProjectRepositoryIdentity(repository.localPath);
	if (identity.status !== "ready") {
		throw new AppError(
			409,
			"repository_materialization_identity_invalid",
			"Materialized repository identity is not ready",
		);
	}
	const updated = await db.transaction(async (tx) => {
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
		return workspaceRepo.transitionTaskGitWorkspace(
			{
				id: workspace.id,
				expectedStatus: "waiting_for_repository_initialization",
				data: {
					status: "planned",
					bootstrapEvidenceJson: result.payload.postImport,
					repositoryIdentityRevision: nextRevision,
					repositoryIdentityDigest: identity.digest,
					baseWorktreeId: identity.baseWorktreeId,
					baseWorktreePathCanonical: identity.baseWorktreePathCanonical,
					gitCommonDirDigest: identity.gitCommonDirCanonical
						? digestPath(identity.gitCommonDirCanonical)
						: null,
				},
			},
			tx,
		);
	});
	if (!updated)
		throw new AppError(
			409,
			"repository_materialization_changed",
			"Repository materialization changed concurrently",
		);
	return updated;
}

function digestPath(value: string) {
	return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

async function alignMaterializedRepositoryBranch(input: {
	repositoryPath: string;
	targetBranch: string;
}) {
	const targetExists = await runGitCommand([
		"-C",
		input.repositoryPath,
		"rev-parse",
		"--verify",
		`${input.targetBranch}^{commit}`,
	])
		.then(() => true)
		.catch(() => false);
	if (targetExists) return;
	const currentBranch = (
		await runGitCommand([
			"-C",
			input.repositoryPath,
			"branch",
			"--show-current",
		])
	).stdout.trim();
	if (!currentBranch)
		throw new AppError(
			409,
			"repository_materialization_branch_missing",
			"Materialized repository branch is missing",
		);
	await runGitCommand([
		"-C",
		input.repositoryPath,
		"branch",
		"-M",
		input.targetBranch,
	]);
}
