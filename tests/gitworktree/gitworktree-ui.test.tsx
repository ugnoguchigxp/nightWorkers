import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorktreeListResponse } from "../../shared/schemas/gitworktree.schema";

const { useGitworktreeController } = vi.hoisted(() => ({
	useGitworktreeController: vi.fn(),
}));

vi.mock("../../src/modules/gitworktree/hooks/useGitworktreeController", () => ({
	useGitworktreeController,
}));
vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

function controller(data: WorktreeListResponse | null) {
	return {
		data,
		loading: false,
		error: "",
		selectedId: data?.worktrees[0]?.id || null,
		setSelectedId: vi.fn(),
		busy: null,
		showCreate: false,
		setShowCreate: vi.fn(),
		createDraft: { mode: "new_branch", branchName: "", startPoint: "HEAD" },
		setCreateDraft: vi.fn(),
		showTask: false,
		setShowTask: vi.fn(),
		taskTitle: "",
		setTaskTitle: vi.fn(),
		diff: null,
		setDiff: vi.fn(),
		advice: null,
		setAdvice: vi.fn(),
		load: vi.fn(),
		selected: data?.worktrees[0] || null,
		runningCount: 0,
		attentionCount: 0,
		runAction: vi.fn(),
	};
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("ProjectDetailWorktrees", () => {
	it("exposes no mutation actions when Git is unavailable", async () => {
		useGitworktreeController.mockReturnValue(
			controller({
				git: { available: false, version: null, reason: "git_not_found" },
				repository: { available: false, commonDir: null, reason: null },
				worktrees: [],
				refreshedAt: "2026-07-10T00:00:00.000Z",
			}),
		);
		const { ProjectDetailWorktrees } = await import(
			"../../src/modules/gitworktree/components/ProjectDetailWorktrees"
		);

		const markup = renderToStaticMarkup(
			<ProjectDetailWorktrees repositoryId="repo-id" onCreateTask={vi.fn()} />,
		);

		expect(markup).toContain("projectDetail.worktrees.gitMissingTitle");
		expect(markup).not.toContain("projectDetail.worktrees.create");
		expect(markup).not.toContain("projectDetail.worktrees.remove");
	});

	it("renders base and dirty safety state from the verified projection", async () => {
		const worktree = {
			id: "worktree-id",
			path: "/repo",
			canonicalPath: "/repo",
			isBase: true,
			head: "0123456789012345678901234567890123456789",
			headSubject: "Initial commit",
			branch: "main",
			detached: false,
			bare: false,
			locked: false,
			lockReason: null,
			prunable: false,
			pruneReason: null,
			upstream: null,
			ahead: 0,
			behind: 0,
			stagedCount: 0,
			modifiedCount: 1,
			untrackedCount: 0,
			conflictedCount: 0,
			usage: {
				taskIds: [],
				runIds: [],
				activeTaskCount: 0,
				activeRunCount: 0,
				pendingCloseoutCount: 0,
			},
			canRemove: false,
			removeBlockers: ["base_worktree_protected", "worktree_dirty"],
			removeWarnings: ["upstream_missing"],
		} as const;
		useGitworktreeController.mockReturnValue(
			controller({
				git: { available: true, version: "git version 2.52.0", reason: null },
				repository: { available: true, commonDir: "/repo/.git", reason: null },
				worktrees: [worktree],
				refreshedAt: "2026-07-10T00:00:00.000Z",
			}),
		);
		const { ProjectDetailWorktrees } = await import(
			"../../src/modules/gitworktree/components/ProjectDetailWorktrees"
		);

		const markup = renderToStaticMarkup(
			<ProjectDetailWorktrees repositoryId="repo-id" onCreateTask={vi.fn()} />,
		);

		expect(markup).toContain("main");
		expect(markup).toContain(
			"projectDetail.worktrees.blocker.base_worktree_protected",
		);
		expect(markup).toContain("projectDetail.worktrees.blocker.worktree_dirty");
		expect(markup).toContain("disabled");
	});
});
