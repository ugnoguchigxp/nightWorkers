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
		expect(markup).toContain("既定のマージ先");
		expect(markup).not.toContain("projectDetail.worktrees.createTask");
		expect(markup).toContain(
			"projectDetail.worktrees.blocker.base_worktree_protected",
		);
		expect(markup).toContain("projectDetail.worktrees.blocker.worktree_dirty");
		expect(markup).toContain("disabled");
	});

	it("offers explicit discard removal and renders a file-based diff dialog", async () => {
		const worktree = {
			id: "worktree-id",
			path: "/repo-worktrees/feature",
			canonicalPath: "/repo-worktrees/feature",
			isBase: false,
			head: "0123456789012345678901234567890123456789",
			headSubject: "Feature work",
			branch: "feature",
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
			removeBlockers: ["worktree_dirty"],
			removeWarnings: [],
		} as const;
		const state = controller({
			git: { available: true, version: "git version 2.52.0", reason: null },
			repository: { available: true, commonDir: "/repo/.git", reason: null },
			worktrees: [worktree],
			refreshedAt: "2026-07-13T00:00:00.000Z",
		});
		useGitworktreeController.mockReturnValue({
			...state,
			diff: {
				diff: [
					"diff --git a/file.ts b/file.ts",
					"--- a/file.ts",
					"+++ b/file.ts",
					"@@ -1 +1 @@",
					"-old value",
					"+new value",
					"diff --git a/new.ts b/new.ts",
					"new file mode 100644",
					"--- /dev/null",
					"+++ b/new.ts",
					"@@ -0,0 +1 @@",
					"+export {};",
				].join("\n"),
				diffStat: "2 files changed, 2 insertions(+), 1 deletion(-)",
				hasChanges: true,
				truncated: false,
			},
		});
		const { ProjectDetailWorktrees } = await import(
			"../../src/modules/gitworktree/components/ProjectDetailWorktrees"
		);

		const markup = renderToStaticMarkup(
			<ProjectDetailWorktrees repositoryId="repo-id" onCreateTask={vi.fn()} />,
		);

		expect(markup).toContain("projectDetail.worktrees.discardAndRemove");
		expect(markup).toContain('role="dialog"');
		expect(markup).toContain('data-worktree-diff-file="file.ts"');
		expect(markup).toContain('data-worktree-diff-file="new.ts"');
		expect(markup).toContain("+1");
		expect(markup).toContain("-1");
		expect(markup).toContain(
			'<span class="nightworkers-chip" style="color:var(--nw-danger)">projectDetail.worktrees.diff.deletedLines</span>',
		);
		expect(markup).toContain('<span style="color:var(--nw-danger)">-1</span>');
		expect(markup).toContain('<span style="color:var(--nw-danger)">-0</span>');
		expect(markup).toContain("nightworkers-code-block");
		expect(markup).toContain("diff --git a/file.ts b/file.ts");
		expect(markup).toContain("diff add");
		expect(markup).toContain("diff remove");
	});
});
