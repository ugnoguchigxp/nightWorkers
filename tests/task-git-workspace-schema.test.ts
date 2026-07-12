import { describe, expect, it } from "vitest";
import {
	defaultProjectGitIntegrationPolicy,
	taskGitWorkspaceSchema,
} from "../shared/schemas/git-integration.schema";

const base = {
	id: "11111111-1111-4111-8111-111111111111",
	taskId: "22222222-2222-4222-8222-222222222222",
	repositoryId: "33333333-3333-4333-8333-333333333333",
	status: "planned" as const,
	materializationKind: "existing_git" as const,
	integrationPolicySnapshotJson: defaultProjectGitIntegrationPolicy,
	sourceBranch: "nightworkers/task",
	targetBranch: "main",
	allocationVersion: 1,
};

describe("taskGitWorkspaceSchema", () => {
	it("allows planned rows before Git provisioning", () => {
		expect(taskGitWorkspaceSchema.safeParse(base).success).toBe(true);
	});

	it("requires path, worktree id, base SHA, and expected HEAD once ready", () => {
		expect(
			taskGitWorkspaceSchema.safeParse({ ...base, status: "ready" }).success,
		).toBe(false);
		expect(
			taskGitWorkspaceSchema.safeParse({
				...base,
				status: "ready",
				targetBaseSha: "a".repeat(40),
				worktreePath: "/repo-worktrees/task",
				worktreeId: "worktree-id",
				expectedHeadSha: "a".repeat(40),
			}).success,
		).toBe(true);
	});
});
