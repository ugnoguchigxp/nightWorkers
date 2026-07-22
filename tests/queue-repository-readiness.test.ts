import { beforeEach, describe, expect, it, vi } from "vitest";
import * as agentsShare from "../api/modules/agentsShare";
import { repositoryHasGitHead } from "../api/modules/gitworktree/repository-state.service";
import * as workspaceRepo from "../api/modules/gitworktree/task-git-workspace.repository";
import {
	ensureTaskGitWorkspace,
	provisionTaskGitWorkspace,
} from "../api/modules/gitworktree/task-git-workspace.service";
import * as nightworkersRepo from "../api/modules/nightworkers/nightworkers.repository";
import { prepareImplementationQueueRepository } from "../api/modules/queue/queue-repository-readiness.service";

vi.mock("../api/modules/agentsShare", () => ({
	findLatestFeaturePlanMaterialization: vi.fn(),
}));
vi.mock("../api/modules/gitworktree/repository-state.service", () => ({
	repositoryHasGitHead: vi.fn(),
}));
vi.mock("../api/modules/gitworktree/task-git-workspace.repository", () => ({
	getTaskGitWorkspace: vi.fn(),
}));
vi.mock("../api/modules/gitworktree/task-git-workspace.service", () => ({
	ensureTaskGitWorkspace: vi.fn(),
	provisionTaskGitWorkspace: vi.fn(),
}));
vi.mock("../api/modules/nightworkers/nightworkers.repository", () => ({
	getRepository: vi.fn(),
}));

const task = { id: "task-1", repositoryId: "repository-1" };
const messages = [{ id: "feature-plan-1", metadataJson: {} }];

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(nightworkersRepo.getRepository).mockResolvedValue({
		id: task.repositoryId,
		localPath: "/project",
	} as never);
	vi.mocked(workspaceRepo.getTaskGitWorkspace).mockResolvedValue(null);
	vi.mocked(agentsShare.findLatestFeaturePlanMaterialization).mockReturnValue(
		null,
	);
	vi.mocked(ensureTaskGitWorkspace).mockResolvedValue({
		id: "workspace-1",
	} as never);
	vi.mocked(provisionTaskGitWorkspace).mockResolvedValue({
		id: "workspace-1",
		status: "ready",
	} as never);
});

describe("Implementation Queue repository readiness", () => {
	it("provisions a dedicated worktree for an existing Git repository", async () => {
		vi.mocked(repositoryHasGitHead).mockResolvedValue(true);

		await expect(
			prepareImplementationQueueRepository({ task, messages }),
		).resolves.toMatchObject({ id: "workspace-1", status: "ready" });
		expect(ensureTaskGitWorkspace).toHaveBeenCalledWith({
			taskId: task.id,
			planReviewId: null,
			admissionKey: "implementation-queue:task-1:existing-git",
			materializationIntent: { kind: "existing_git" },
		});
		expect(provisionTaskGitWorkspace).toHaveBeenCalledWith(task.id);
	});

	it("rejects an empty Project before Queue creation when Plan evidence has no intent", async () => {
		vi.mocked(repositoryHasGitHead).mockResolvedValue(false);

		await expect(
			prepareImplementationQueueRepository({ task, messages }),
		).rejects.toMatchObject({
			code: "REPOSITORY_MATERIALIZATION_INTENT_REQUIRED",
		});
		expect(ensureTaskGitWorkspace).not.toHaveBeenCalled();
		expect(provisionTaskGitWorkspace).not.toHaveBeenCalled();
	});

	it("finishes template materialization and workspace provisioning before Queue admission", async () => {
		vi.mocked(repositoryHasGitHead).mockResolvedValue(false);
		vi.mocked(agentsShare.findLatestFeaturePlanMaterialization).mockReturnValue(
			{
				featurePlanMessageId: "feature-plan-1",
				intent: {
					kind: "starter_template",
					source: "starter",
					stack: "hono",
					initialize: true,
				},
			},
		);
		vi.mocked(ensureTaskGitWorkspace).mockResolvedValue({
			id: "workspace-1",
		} as never);
		vi.mocked(provisionTaskGitWorkspace).mockResolvedValue({
			id: "workspace-1",
			status: "ready",
		} as never);

		await expect(
			prepareImplementationQueueRepository({ task, messages }),
		).resolves.toMatchObject({ id: "workspace-1", status: "ready" });
		expect(ensureTaskGitWorkspace).toHaveBeenCalledWith({
			taskId: task.id,
			planReviewId: null,
			admissionKey: "implementation-queue:task-1:feature-plan-1",
			materializationIntent: {
				kind: "starter_template",
				source: "starter",
				stack: "hono",
				initialize: true,
			},
		});
		expect(provisionTaskGitWorkspace).toHaveBeenCalledWith(task.id);
	});
});
