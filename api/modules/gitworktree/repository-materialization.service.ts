import { eq } from "drizzle-orm";
import { repositoryMaterializationIntentSchema } from "../../../shared/schemas/git-integration.schema";
import { db } from "../../db/client";
import { repositories } from "../../db/schema";
import { AppError } from "../../lib/errors";
import { importProjectTool } from "../../services/worker-tools/import-project";
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
	const updated = await workspaceRepo.transitionTaskGitWorkspace({
		id: workspace.id,
		expectedStatus: "waiting_for_repository_initialization",
		data: {
			status: "planned",
			bootstrapEvidenceJson: result.payload.postImport,
		},
	});
	if (!updated)
		throw new AppError(
			409,
			"repository_materialization_changed",
			"Repository materialization changed concurrently",
		);
	return updated;
}
