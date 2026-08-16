import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOpenApiRouter } from "../../api/lib/openapi";

const service = vi.hoisted(() => ({
	listRepositoryWorktrees: vi.fn(),
	createRepositoryWorktree: vi.fn(),
	readRepositoryWorktreeDiff: vi.fn(),
	removeRepositoryWorktree: vi.fn(),
	previewRepositoryWorktreePrune: vi.fn(),
	pruneRepositoryWorktrees: vi.fn(),
}));
vi.mock("../../api/modules/gitworktree/gitworktree.service", () => service);

import { gitworktreeRouter } from "../../api/modules/gitworktree/gitworktree.routes";

function app() {
	return createOpenApiRouter().route("/", gitworktreeRouter);
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("gitworktree routes", () => {
	it("preserves the repository worktree list endpoint", async () => {
		service.listRepositoryWorktrees.mockResolvedValue({
			git: { available: false, version: null, reason: "git_not_found" },
			repository: { available: false, commonDir: null, reason: null },
			worktrees: [],
			refreshedAt: "2026-07-10T00:00:00.000Z",
		});

		const response = await app().request("/repositories/repo-id/worktrees");

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			git: { available: false, reason: "git_not_found" },
			worktrees: [],
		});
		expect(service.listRepositoryWorktrees).toHaveBeenCalledWith("repo-id");
	});

	it("rejects malformed create input before invoking the domain service", async () => {
		const response = await app().request("/repositories/repo-id/worktrees", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ mode: "new_branch", branchName: "" }),
		});

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({
			error: { code: "INVALID_WORKTREE_REQUEST" },
		});
		expect(service.createRepositoryWorktree).not.toHaveBeenCalled();
	});

	it("passes an explicit discard request to worktree removal", async () => {
		service.removeRepositoryWorktree.mockResolvedValue({ removed: true });

		const response = await app().request("/repositories/repo-id/worktrees", {
			method: "DELETE",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				worktreeId: "worktree-id",
				expectedHead: "0123456789012345678901234567890123456789",
				discardChanges: true,
			}),
		});

		expect(response.status).toBe(200);
		expect(service.removeRepositoryWorktree).toHaveBeenCalledWith("repo-id", {
			worktreeId: "worktree-id",
			expectedHead: "0123456789012345678901234567890123456789",
			discardChanges: true,
		});
	});

	it("does not expose the removed LLM advice endpoint", async () => {
		const response = await app().request(
			"/repositories/repo-id/worktrees/advice",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ kind: "summarize" }),
			},
		);

		expect(response.status).toBe(404);
	});

	it("does not expose unexpected internal error details", async () => {
		service.listRepositoryWorktrees.mockRejectedValue(
			new Error("sensitive /private/repository/path"),
		);

		const response = await app().request("/repositories/repo-id/worktrees");

		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({
			error: {
				code: "INTERNAL_SERVER_ERROR",
				message: "An unexpected error occurred",
			},
		});
	});
});
