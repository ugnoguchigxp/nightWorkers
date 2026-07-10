import { beforeEach, describe, expect, it, vi } from "vitest";

const callStructuredJsonLLM = vi.hoisted(() => vi.fn());
const getRepository = vi.hoisted(() => vi.fn());
const listRepositoryWorktrees = vi.hoisted(() => vi.fn());
const assertGitworktreeAvailable = vi.hoisted(() => vi.fn());

vi.mock("../../api/services/structured-llm", () => ({ callStructuredJsonLLM }));
vi.mock("../../api/modules/gitworktree/gitworktree.repository", () => ({
	getRepository,
}));
vi.mock("../../api/modules/gitworktree/gitworktree.service", () => ({
	listRepositoryWorktrees,
	assertGitworktreeAvailable,
}));

import { adviseRepositoryWorktrees } from "../../api/modules/gitworktree/gitworktree-advice.service";

beforeEach(() => {
	vi.clearAllMocks();
	getRepository.mockResolvedValue({
		id: "repo-id",
		name: "Example",
		localPath: "/private/example",
	});
	listRepositoryWorktrees.mockResolvedValue({
		git: { available: true, version: "git version 2.52.0", reason: null },
		repository: { available: true, commonDir: "/private/example/.git" },
		worktrees: [
			{
				id: "worktree-id",
				path: "/private/example-worktrees/feature",
				canonicalPath: "/private/example-worktrees/feature",
				branch: "feature/refactor",
				detached: false,
				isBase: false,
				head: "0123456789012345678901234567890123456789",
				conflictedCount: 0,
				stagedCount: 0,
				modifiedCount: 0,
				untrackedCount: 0,
				ahead: 0,
				behind: 0,
				usage: {
					activeTaskCount: 0,
					activeRunCount: 0,
					pendingCloseoutCount: 0,
				},
				canRemove: true,
				removeBlockers: [],
				removeWarnings: [],
			},
		],
	});
	callStructuredJsonLLM.mockResolvedValue(
		JSON.stringify({
			summary: "整理は不要です。",
			suggestedBranchName: null,
			suggestedStartPoint: null,
			suggestedPathSlug: null,
			cleanupWorktreeIds: [],
		}),
	);
});

describe("gitworktree advice", () => {
	it("keeps advice read-only and excludes absolute paths from the prompt snapshot", async () => {
		const result = await adviseRepositoryWorktrees("repo-id", {
			kind: "summarize",
			selectedWorktreeId: "worktree-id",
		});

		expect(result.summary).toBe("整理は不要です。");
		expect(assertGitworktreeAvailable).toHaveBeenCalledTimes(1);
		const [systemPrompt, userPrompt] = callStructuredJsonLLM.mock.calls[0];
		expect(systemPrompt).toContain("読み取り専用アドバイザー");
		expect(systemPrompt).toContain("force 操作を提案しない");
		expect(userPrompt).toContain("feature/refactor");
		expect(userPrompt).not.toContain("/private/example");
		expect(userPrompt).not.toContain("diff");
	});

	it("drops cleanup ids that are not verified as removable", async () => {
		callStructuredJsonLLM.mockResolvedValue(
			JSON.stringify({
				summary: "候補があります。",
				suggestedBranchName: null,
				suggestedStartPoint: null,
				suggestedPathSlug: null,
				cleanupWorktreeIds: ["worktree-id", "invented-id"],
			}),
		);

		const result = await adviseRepositoryWorktrees("repo-id", {
			kind: "suggest_cleanup",
		});

		expect(result.cleanupWorktreeIds).toEqual(["worktree-id"]);
	});
});
