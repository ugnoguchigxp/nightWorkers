import { beforeEach, describe, expect, it, vi } from "vitest";

const deps = vi.hoisted(() => {
	const state = {
		selectResults: [] as unknown[],
		returningResults: [] as unknown[],
	};
	const dbMock: Record<string, unknown> = {};
	const select = vi.fn(() => {
		const result = state.selectResults.shift() ?? [];
		const chain = {
			from: vi.fn(),
			where: vi.fn(async () => result),
		};
		chain.from.mockReturnValue(chain);
		return chain;
	});
	const update = vi.fn(() => {
		const chain = Promise.resolve([]) as Promise<unknown[]> & {
			set: ReturnType<typeof vi.fn>;
			where: ReturnType<typeof vi.fn>;
			returning: ReturnType<typeof vi.fn>;
		};
		chain.set = vi.fn(() => chain);
		chain.where = vi.fn(() => chain);
		chain.returning = vi.fn(async () => state.returningResults.shift() ?? []);
		return chain;
	});
	Object.assign(dbMock, {
		select,
		update,
		transaction: vi.fn(async (callback: (tx: unknown) => unknown) =>
			callback(dbMock),
		),
	});
	return {
		state,
		dbMock,
		select,
		update,
		getTaskGitWorkspace: vi.fn(),
		getTaskGitWorkspaceById: vi.fn(),
		createTaskGitWorkspace: vi.fn(),
		transitionTaskGitWorkspace: vi.fn(),
		canRetryInitialization: vi.fn(),
		initializeTaskGitWorkspace: vi.fn(),
		createRepositoryWorktree: vi.fn(),
		listRepositoryWorktrees: vi.fn(),
		withLock: vi.fn(),
		inspectIdentity: vi.fn(),
		attestWorkspace: vi.fn(),
		materializeRepository: vi.fn(),
		runGitCommand: vi.fn(),
		newWorkspaceId: vi.fn(() => "workspace-new"),
		branchName: vi.fn((input: { allocationId?: string }) =>
			input.allocationId ? `branch-${input.allocationId}` : "branch-base",
		),
		workspacePath: vi.fn(() => "/repo/.worktrees/branch"),
	};
});

vi.mock("../api/db/client", () => ({ db: deps.dbMock }));
vi.mock("../api/modules/gitworktree/task-git-workspace.repository", () => ({
	getTaskGitWorkspace: deps.getTaskGitWorkspace,
	getTaskGitWorkspaceById: deps.getTaskGitWorkspaceById,
	createTaskGitWorkspace: deps.createTaskGitWorkspace,
	transitionTaskGitWorkspace: deps.transitionTaskGitWorkspace,
}));
vi.mock("../api/modules/gitworktree/gitworktree.service", () => ({
	createRepositoryWorktree: deps.createRepositoryWorktree,
	listRepositoryWorktrees: deps.listRepositoryWorktrees,
}));
vi.mock("../api/modules/gitworktree/repository-git-mutation-lock", () => ({
	withRepositoryGitMutationLock: deps.withLock,
}));
vi.mock(
	"../api/modules/gitworktree/task-git-workspace-initialization.service",
	() => ({
		canRetryTaskGitWorkspaceInitialization: deps.canRetryInitialization,
		initializeTaskGitWorkspace: deps.initializeTaskGitWorkspace,
	}),
);
vi.mock("../api/modules/gitworktree/task-workspace-naming", () => ({
	newWorkspaceId: deps.newWorkspaceId,
	taskWorkspaceBranchName: deps.branchName,
	taskWorkspacePath: deps.workspacePath,
}));
vi.mock("../api/modules/gitworktree/workspace-attestation.service", () => ({
	attestTaskWorkspaceForRun: deps.attestWorkspace,
}));
vi.mock("../api/services/git/project-repository-identity", () => ({
	inspectProjectRepositoryIdentity: deps.inspectIdentity,
}));
vi.mock(
	"../api/modules/gitworktree/repository-materialization.service",
	() => ({
		materializeTaskGitWorkspaceRepository: deps.materializeRepository,
	}),
);
vi.mock("../api/modules/gitworktree/gitworktree-cli", () => ({
	runGitCommand: deps.runGitCommand,
}));

import { AppError } from "../api/lib/errors";
import {
	ensureTaskGitWorkspace,
	provisionTaskGitWorkspace,
	releaseProvisionedTaskWorkspace,
} from "../api/modules/gitworktree/task-git-workspace.service";

function workspace(overrides: Record<string, unknown> = {}) {
	return {
		id: "workspace-1",
		taskId: "task-1",
		repositoryId: "repository-1",
		status: "planned",
		provisionAttempt: 0,
		initializationAttempt: 0,
		sourceBranch: "branch-base",
		targetBranch: "main",
		worktreePath: null,
		expectedHeadSha: null,
		lastAttestationId: null,
		lastAttestationDigest: null,
		attestationRevision: 0,
		...overrides,
	} as never;
}

const task = {
	id: "task-1",
	repositoryId: "repository-1",
	title: "Implement feature",
	worktreePath: null,
};

function repository(overrides: Record<string, unknown> = {}) {
	return {
		id: "repository-1",
		localPath: "/repo",
		branch: "main",
		gitIntegrationPolicyJson: null,
		repositoryIdentityRevision: 2,
		repositoryIdentityDigest: "identity-old",
		baseWorktreeId: "base-1",
		baseWorktreePathCanonical: "/repo",
		gitCommonDirCanonical: "/repo/.git",
		...overrides,
	};
}

function identity(overrides: Record<string, unknown> = {}) {
	return {
		status: "ready",
		registeredRootCanonical: "/repo",
		repositoryKind: "worktree",
		gitCommonDirCanonical: "/repo/.git",
		baseWorktreePathCanonical: "/repo",
		baseWorktreeId: "base-new",
		observedBranch: "main",
		observedHeadSha: "head-main",
		baseWorktreeDirty: false,
		digest: "identity-new",
		verifiedAt: "2026-08-09T00:00:00.000Z",
		...overrides,
	};
}

function createdWorktree(overrides: Record<string, unknown> = {}) {
	return {
		id: "worktree-1",
		branch: "branch-base",
		head: "head-created",
		canonicalPath: "/repo/.worktrees/branch",
		...overrides,
	};
}

beforeEach(() => {
	deps.state.selectResults = [];
	deps.state.returningResults = [];
	for (const mock of [
		deps.select,
		deps.update,
		deps.getTaskGitWorkspace,
		deps.getTaskGitWorkspaceById,
		deps.createTaskGitWorkspace,
		deps.transitionTaskGitWorkspace,
		deps.canRetryInitialization,
		deps.initializeTaskGitWorkspace,
		deps.createRepositoryWorktree,
		deps.listRepositoryWorktrees,
		deps.withLock,
		deps.inspectIdentity,
		deps.attestWorkspace,
		deps.materializeRepository,
		deps.runGitCommand,
		deps.newWorkspaceId,
		deps.branchName,
		deps.workspacePath,
	]) {
		mock.mockClear();
	}
	deps.getTaskGitWorkspace.mockResolvedValue(null);
	deps.getTaskGitWorkspaceById.mockResolvedValue(null);
	deps.createTaskGitWorkspace.mockImplementation(async (value) => value);
	deps.transitionTaskGitWorkspace.mockResolvedValue(null);
	deps.canRetryInitialization.mockReturnValue(false);
	deps.initializeTaskGitWorkspace.mockImplementation(async (value) => value);
	deps.createRepositoryWorktree.mockResolvedValue(createdWorktree());
	deps.listRepositoryWorktrees.mockResolvedValue({ worktrees: [] });
	deps.withLock.mockImplementation(async (_repositoryId, _kind, callback) =>
		callback(),
	);
	deps.inspectIdentity.mockResolvedValue(identity());
	deps.attestWorkspace.mockImplementation(async ({ taskId }) => ({
		workspace: workspace({ taskId, status: "active" }),
	}));
	deps.materializeRepository.mockResolvedValue(workspace());
	deps.runGitCommand.mockResolvedValue({ stdout: " head-main\n", stderr: "" });
	deps.newWorkspaceId.mockReturnValue("workspace-new");
	deps.branchName.mockImplementation((input) =>
		input.allocationId ? `branch-${input.allocationId}` : "branch-base",
	);
	deps.workspacePath.mockReturnValue("/repo/.worktrees/branch");
});

describe("task git workspace extra coverage", () => {
	it("returns reusable existing workspaces without mutation", async () => {
		for (const status of ["planned", "ready", "active", "merged"]) {
			const existing = workspace({ status });
			deps.getTaskGitWorkspace.mockResolvedValueOnce(existing);
			await expect(
				ensureTaskGitWorkspace({
					taskId: "task-1",
					planReviewId: null,
					admissionKey: "admission",
				}),
			).resolves.toBe(existing);
		}
		expect(deps.transitionTaskGitWorkspace).not.toHaveBeenCalled();
	});

	it("updates waiting and failed materialization intents and tolerates lost transitions", async () => {
		const waiting = workspace({
			status: "waiting_for_repository_initialization",
		});
		const updated = workspace({
			status: "waiting_for_repository_initialization",
			materializationKind: "create_local_git",
		});
		deps.getTaskGitWorkspace.mockResolvedValueOnce(waiting);
		deps.transitionTaskGitWorkspace.mockResolvedValueOnce(updated);
		await expect(
			ensureTaskGitWorkspace({
				taskId: "task-1",
				planReviewId: null,
				admissionKey: "key",
				materializationIntent: { kind: "create_local_git" },
			}),
		).resolves.toBe(updated);

		const failed = workspace({
			status: "provision_failed",
			provisionAttempt: 2,
		});
		const resumed = workspace({ status: "planned", provisionAttempt: 2 });
		deps.getTaskGitWorkspace.mockResolvedValueOnce(failed);
		deps.transitionTaskGitWorkspace.mockResolvedValueOnce(resumed);
		await expect(
			ensureTaskGitWorkspace({
				taskId: "task-1",
				planReviewId: null,
				admissionKey: "key",
				materializationIntent: { kind: "existing_git" },
			}),
		).resolves.toBe(resumed);

		deps.getTaskGitWorkspace.mockResolvedValueOnce(failed);
		deps.transitionTaskGitWorkspace.mockResolvedValueOnce(null);
		await expect(
			ensureTaskGitWorkspace({
				taskId: "task-1",
				planReviewId: null,
				admissionKey: "key",
				materializationIntent: {
					kind: "clone_remote",
					remoteUrl: "https://example.test/repo.git",
				},
			}),
		).resolves.toBe(failed);

		const exhausted = workspace({
			status: "provision_failed",
			provisionAttempt: 3,
		});
		deps.getTaskGitWorkspace.mockResolvedValueOnce(exhausted);
		await expect(
			ensureTaskGitWorkspace({
				taskId: "task-1",
				planReviewId: null,
				admissionKey: "key",
				materializationIntent: { kind: "existing_git" },
			}),
		).resolves.toBe(exhausted);
	});

	it("retries initialization failures when allowed", async () => {
		const failed = workspace({ status: "initialization_failed" });
		const resumed = workspace({ status: "initializing" });
		deps.getTaskGitWorkspace.mockResolvedValueOnce(failed);
		deps.canRetryInitialization.mockReturnValueOnce(true);
		deps.transitionTaskGitWorkspace.mockResolvedValueOnce(resumed);
		await expect(
			ensureTaskGitWorkspace({
				taskId: "task-1",
				planReviewId: "plan-1",
				admissionKey: "key",
			}),
		).resolves.toBe(resumed);

		deps.getTaskGitWorkspace.mockResolvedValueOnce(failed);
		deps.canRetryInitialization.mockReturnValueOnce(true);
		deps.transitionTaskGitWorkspace.mockResolvedValueOnce(null);
		await expect(
			ensureTaskGitWorkspace({
				taskId: "task-1",
				planReviewId: "plan-1",
				admissionKey: "key",
			}),
		).resolves.toBe(failed);
	});

	it("creates a collision-safe allocation with normalized default policy", async () => {
		deps.getTaskGitWorkspace
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(null);
		deps.state.selectResults = [
			[task],
			[repository({ gitIntegrationPolicyJson: { invalid: true } })],
			[{ sourceBranch: "branch-base" }],
		];
		const result = await ensureTaskGitWorkspace({
			taskId: "task-1",
			planReviewId: "plan-1",
			admissionKey: "key",
		});
		expect(result).toMatchObject({
			id: "workspace-new",
			status: "planned",
			materializationKind: "existing_git",
			sourceBranch: "branch-workspace-new",
			targetBranch: "main",
			sourceRef: "refs/heads/branch-workspace-new",
			targetRef: "refs/heads/main",
			gitCommonDirDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
		});
		expect(result.integrationPolicySnapshotJson).toBeDefined();
	});

	it("creates a non-git materialization allocation without optional git identity", async () => {
		deps.getTaskGitWorkspace
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(null);
		deps.state.selectResults = [
			[task],
			[
				repository({
					gitCommonDirCanonical: null,
					gitIntegrationPolicyJson: { version: 1, mode: "manual" },
				}),
			],
			[],
		];
		const result = await ensureTaskGitWorkspace({
			taskId: "task-1",
			planReviewId: null,
			admissionKey: "key",
			materializationIntent: { kind: "create_local_git" },
		});
		expect(result).toMatchObject({
			status: "waiting_for_repository_initialization",
			materializationKind: "create_local_git",
			sourceBranch: "branch-base",
			gitCommonDirDigest: null,
		});
	});

	it("returns a concurrent allocation and rejects missing task or repository", async () => {
		const concurrent = workspace({ id: "concurrent" });
		deps.getTaskGitWorkspace
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(concurrent);
		await expect(
			ensureTaskGitWorkspace({
				taskId: "task-1",
				planReviewId: null,
				admissionKey: "key",
			}),
		).resolves.toBe(concurrent);

		deps.getTaskGitWorkspace
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(null);
		deps.state.selectResults = [[]];
		await expect(
			ensureTaskGitWorkspace({
				taskId: "missing",
				planReviewId: null,
				admissionKey: "key",
			}),
		).rejects.toMatchObject({ code: "task_not_found" });

		deps.getTaskGitWorkspace
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(null);
		deps.state.selectResults = [[task], []];
		await expect(
			ensureTaskGitWorkspace({
				taskId: "task-1",
				planReviewId: null,
				admissionKey: "key",
			}),
		).rejects.toMatchObject({ code: "repository_not_found" });
	});

	it("adopts an externally materialized repository and validates identity", async () => {
		const waiting = workspace({
			status: "waiting_for_repository_initialization",
		});
		const adopted = workspace({ status: "planned" });
		deps.getTaskGitWorkspace.mockResolvedValueOnce(waiting);
		deps.state.selectResults = [[repository()]];
		deps.transitionTaskGitWorkspace.mockResolvedValueOnce(adopted);
		await expect(
			ensureTaskGitWorkspace({
				taskId: "task-1",
				planReviewId: null,
				admissionKey: "key",
				materializationIntent: { kind: "existing_git" },
			}),
		).resolves.toBe(adopted);
		expect(deps.transitionTaskGitWorkspace).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					repositoryIdentityRevision: 3,
					repositoryIdentityDigest: "identity-new",
					gitCommonDirDigest: expect.stringMatching(/^sha256:/),
				}),
			}),
			expect.anything(),
		);

		deps.getTaskGitWorkspace.mockResolvedValueOnce(waiting);
		deps.state.selectResults = [[]];
		await expect(
			ensureTaskGitWorkspace({
				taskId: "task-1",
				planReviewId: null,
				admissionKey: "key",
				materializationIntent: { kind: "existing_git" },
			}),
		).rejects.toMatchObject({ code: "repository_not_found" });

		deps.getTaskGitWorkspace.mockResolvedValueOnce(waiting);
		deps.state.selectResults = [[repository()]];
		deps.inspectIdentity.mockResolvedValueOnce(identity({ status: "invalid" }));
		await expect(
			ensureTaskGitWorkspace({
				taskId: "task-1",
				planReviewId: null,
				admissionKey: "key",
				materializationIntent: { kind: "existing_git" },
			}),
		).rejects.toMatchObject({
			code: "repository_materialization_identity_invalid",
		});
	});

	it("rejects a lost external adoption and supports absent git common dir", async () => {
		const waiting = workspace({
			status: "waiting_for_repository_initialization",
		});
		deps.getTaskGitWorkspace.mockResolvedValueOnce(waiting);
		deps.state.selectResults = [[repository()]];
		deps.inspectIdentity.mockResolvedValueOnce(
			identity({ gitCommonDirCanonical: null }),
		);
		deps.transitionTaskGitWorkspace.mockResolvedValueOnce(null);
		await expect(
			ensureTaskGitWorkspace({
				taskId: "task-1",
				planReviewId: null,
				admissionKey: "key",
				materializationIntent: { kind: "existing_git" },
			}),
		).rejects.toMatchObject({ code: "repository_materialization_changed" });
	});

	it("returns early provision states and materializes waiting repositories", async () => {
		for (const status of [
			"initializing",
			"initialization_failed",
			"ready",
			"active",
			"reviewing",
			"integration_pending",
			"merged",
		]) {
			const current = workspace({ status });
			deps.getTaskGitWorkspace
				.mockResolvedValueOnce(current)
				.mockResolvedValueOnce(current);
			deps.initializeTaskGitWorkspace.mockResolvedValueOnce(current);
			if (status === "ready" || status === "active") {
				deps.attestWorkspace.mockResolvedValueOnce({ workspace: current });
			}
			await expect(provisionTaskGitWorkspace("task-1")).resolves.toBe(current);
		}

		const waiting = workspace({
			status: "waiting_for_repository_initialization",
		});
		const blocked = workspace({
			status: "waiting_for_repository_initialization",
		});
		deps.getTaskGitWorkspace
			.mockResolvedValueOnce(waiting)
			.mockResolvedValueOnce(waiting);
		deps.materializeRepository.mockResolvedValueOnce(blocked);
		await expect(provisionTaskGitWorkspace("task-1")).rejects.toMatchObject({
			code: "workspace_not_provisionable",
		});
	});

	it("rejects missing workspace and missing owners during provisioning", async () => {
		deps.getTaskGitWorkspace.mockResolvedValueOnce(null);
		await expect(provisionTaskGitWorkspace("missing")).rejects.toMatchObject({
			code: "workspace_not_found",
		});

		const planned = workspace();
		deps.getTaskGitWorkspace
			.mockResolvedValueOnce(planned)
			.mockResolvedValueOnce(null);
		await expect(provisionTaskGitWorkspace("task-1")).rejects.toMatchObject({
			code: "workspace_not_found",
		});

		for (const rows of [
			[[], [task]],
			[[repository()], []],
		]) {
			deps.getTaskGitWorkspace
				.mockResolvedValueOnce(planned)
				.mockResolvedValueOnce(planned);
			deps.state.selectResults = rows;
			await expect(provisionTaskGitWorkspace("task-1")).rejects.toMatchObject({
				code: "workspace_owner_missing",
			});
		}
	});

	it("provisions, initializes, and attests a newly created worktree", async () => {
		const planned = workspace();
		const initializing = workspace({
			status: "initializing",
			worktreePath: "/repo/.worktrees/branch",
			expectedHeadSha: "head-created",
		});
		const ready = workspace({ ...initializing, status: "ready" });
		deps.getTaskGitWorkspace
			.mockResolvedValueOnce(planned)
			.mockResolvedValueOnce(planned);
		deps.state.selectResults = [[repository()], [task]];
		deps.state.returningResults = [
			[{ ...task, worktreePath: initializing.worktreePath }],
		];
		deps.transitionTaskGitWorkspace
			.mockResolvedValueOnce(workspace({ status: "provisioning" }))
			.mockResolvedValueOnce(initializing);
		deps.initializeTaskGitWorkspace.mockResolvedValueOnce(ready);
		const active = workspace({ ...ready, status: "active" });
		deps.attestWorkspace.mockResolvedValueOnce({ workspace: active });

		await expect(
			provisionTaskGitWorkspace("task-1", { timeoutMs: 500 }),
		).resolves.toBe(active);
		expect(deps.runGitCommand).toHaveBeenCalledWith([
			"-C",
			"/repo",
			"rev-parse",
			"--verify",
			"main^{commit}",
		]);
		expect(deps.createRepositoryWorktree).toHaveBeenCalledWith(
			"repository-1",
			expect.objectContaining({
				mode: "new_branch",
				branchName: "branch-base",
				startPoint: "head-main",
			}),
		);
		expect(deps.attestWorkspace).toHaveBeenCalledWith({
			taskId: "task-1",
			requireClean: true,
		});
	});

	it("adopts a matching worktree after create races", async () => {
		const planned = workspace();
		const created = createdWorktree({ head: "head-main" });
		deps.getTaskGitWorkspace
			.mockResolvedValueOnce(planned)
			.mockResolvedValueOnce(planned);
		deps.state.selectResults = [[repository()], [task]];
		deps.state.returningResults = [[task]];
		deps.transitionTaskGitWorkspace
			.mockResolvedValueOnce(workspace({ status: "provisioning" }))
			.mockResolvedValueOnce(workspace({ status: "initializing" }));
		deps.createRepositoryWorktree.mockRejectedValueOnce(new Error("exists"));
		deps.listRepositoryWorktrees.mockResolvedValueOnce({
			worktrees: [
				createdWorktree({ branch: "other" }),
				createdWorktree({ head: "other" }),
				createdWorktree({ canonicalPath: "/other" }),
				created,
			],
		});
		const result = await provisionTaskGitWorkspace("task-1");
		expect(result.status).toBe("initializing");
	});

	it("uses a concurrent matching transition and rejects lost projections", async () => {
		const planned = workspace();
		const concurrent = workspace({
			status: "initializing",
			worktreePath: "/repo/.worktrees/branch",
			expectedHeadSha: "head-created",
		});
		deps.getTaskGitWorkspace
			.mockResolvedValueOnce(planned)
			.mockResolvedValueOnce(planned);
		deps.state.selectResults = [[repository()], [task]];
		deps.state.returningResults = [[task]];
		deps.transitionTaskGitWorkspace
			.mockResolvedValueOnce(workspace({ status: "provisioning" }))
			.mockResolvedValueOnce(null);
		deps.getTaskGitWorkspaceById.mockResolvedValueOnce(concurrent);
		await expect(provisionTaskGitWorkspace("task-1")).resolves.toBe(concurrent);

		deps.getTaskGitWorkspace
			.mockResolvedValueOnce(planned)
			.mockResolvedValueOnce(planned);
		deps.state.selectResults = [[repository()], [task]];
		deps.state.returningResults = [[]];
		deps.transitionTaskGitWorkspace.mockResolvedValueOnce(
			workspace({ status: "provisioning" }),
		);
		await expect(provisionTaskGitWorkspace("task-1")).rejects.toMatchObject({
			code: "workspace_task_projection_failed",
		});
		expect(deps.transitionTaskGitWorkspace).toHaveBeenLastCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					status: "provision_failed",
					lastErrorCode: "workspace_task_projection_failed",
				}),
			}),
		);

		deps.getTaskGitWorkspace
			.mockResolvedValueOnce(planned)
			.mockResolvedValueOnce(planned);
		deps.state.selectResults = [[repository()], [task]];
		deps.state.returningResults = [[task]];
		deps.transitionTaskGitWorkspace
			.mockResolvedValueOnce(workspace({ status: "provisioning" }))
			.mockResolvedValueOnce(null);
		deps.getTaskGitWorkspaceById.mockResolvedValueOnce(
			workspace({ status: "active", expectedHeadSha: "different" }),
		);
		await expect(provisionTaskGitWorkspace("task-1")).rejects.toMatchObject({
			code: "workspace_transition_lost",
		});
	});

	it("records provision failures and rethrows create errors", async () => {
		const planned = workspace();
		deps.getTaskGitWorkspace
			.mockResolvedValueOnce(planned)
			.mockResolvedValueOnce(planned);
		deps.state.selectResults = [[repository()], [task]];
		deps.transitionTaskGitWorkspace.mockResolvedValueOnce(
			workspace({ status: "provisioning" }),
		);
		deps.createRepositoryWorktree.mockRejectedValueOnce("raw failure");
		deps.listRepositoryWorktrees.mockResolvedValueOnce({ worktrees: [] });
		await expect(provisionTaskGitWorkspace("task-1")).rejects.toBe(
			"raw failure",
		);
		expect(deps.transitionTaskGitWorkspace).toHaveBeenLastCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					status: "provision_failed",
					lastErrorCode: "workspace_provision_failed",
					lastErrorMessage: "Workspace provisioning failed",
				}),
			}),
		);
	});

	it("waits through a git mutation lock and accepts concurrent ready state", async () => {
		const planned = workspace();
		const ready = workspace({ status: "ready" });
		deps.getTaskGitWorkspace
			.mockResolvedValueOnce(planned)
			.mockResolvedValueOnce(ready);
		deps.withLock.mockRejectedValueOnce(
			new AppError(409, "repository_git_mutation_locked", "locked"),
		);
		deps.initializeTaskGitWorkspace.mockResolvedValueOnce(ready);
		deps.attestWorkspace.mockResolvedValueOnce({ workspace: ready });
		await expect(provisionTaskGitWorkspace("task-1")).resolves.toBe(ready);
	});

	it("handles initializing, failed, successful retry, and retry-error lock states", async () => {
		const planned = workspace();
		const initializing = workspace({ status: "initialization_failed" });
		deps.getTaskGitWorkspace
			.mockResolvedValueOnce(planned)
			.mockResolvedValueOnce(initializing);
		deps.withLock.mockRejectedValueOnce(
			new AppError(409, "repository_git_mutation_locked", "locked"),
		);
		deps.initializeTaskGitWorkspace.mockResolvedValueOnce(initializing);
		await expect(provisionTaskGitWorkspace("task-1")).resolves.toBe(
			initializing,
		);

		deps.getTaskGitWorkspace
			.mockResolvedValueOnce(planned)
			.mockResolvedValueOnce(workspace({ status: "provision_failed" }));
		deps.withLock.mockReset();
		deps.withLock.mockRejectedValueOnce(
			new AppError(409, "repository_git_mutation_locked", "still locked"),
		);
		await expect(provisionTaskGitWorkspace("task-1")).rejects.toMatchObject({
			code: "repository_git_mutation_locked",
		});

		const retried = workspace({ status: "initializing" });
		deps.getTaskGitWorkspace
			.mockResolvedValueOnce(planned)
			.mockResolvedValueOnce(null);
		deps.withLock.mockReset();
		deps.withLock
			.mockRejectedValueOnce(
				new AppError(409, "repository_git_mutation_locked", "locked"),
			)
			.mockResolvedValueOnce(retried);
		deps.initializeTaskGitWorkspace.mockResolvedValueOnce(retried);
		await expect(provisionTaskGitWorkspace("task-1")).resolves.toBe(retried);

		deps.getTaskGitWorkspace
			.mockResolvedValueOnce(planned)
			.mockResolvedValueOnce(null);
		deps.withLock.mockReset();
		deps.withLock
			.mockRejectedValueOnce(
				new AppError(409, "repository_git_mutation_locked", "locked"),
			)
			.mockRejectedValueOnce(new Error("retry backend failed"));
		await expect(provisionTaskGitWorkspace("task-1")).rejects.toThrow(
			"retry backend failed",
		);
	});

	it("does not retry unrelated lock errors", async () => {
		const planned = workspace();
		deps.getTaskGitWorkspace.mockResolvedValueOnce(planned);
		deps.withLock.mockRejectedValueOnce(new Error("lock backend failed"));
		await expect(provisionTaskGitWorkspace("task-1")).rejects.toThrow(
			"lock backend failed",
		);
	});

	it("releases only attested ready workspaces to matching queue entries", async () => {
		for (const invalid of [
			null,
			workspace({ status: "planned" }),
			workspace({ status: "ready" }),
			workspace({
				status: "ready",
				lastAttestationId: "attestation",
			}),
			workspace({
				status: "ready",
				lastAttestationId: "attestation",
				lastAttestationDigest: "digest",
				attestationRevision: 0,
			}),
		]) {
			deps.getTaskGitWorkspaceById.mockResolvedValueOnce(invalid);
			await expect(
				releaseProvisionedTaskWorkspace({
					entryId: "entry-1",
					workspaceId: "workspace-1",
				}),
			).rejects.toMatchObject({
				code:
					!invalid || invalid.status === "planned"
						? "workspace_not_ready"
						: "workspace_attestation_required",
			});
		}

		const ready = workspace({
			status: "active",
			lastAttestationId: "attestation",
			lastAttestationDigest: "digest",
			attestationRevision: 1,
		});
		deps.getTaskGitWorkspaceById.mockResolvedValueOnce(ready);
		deps.state.returningResults = [[]];
		await expect(
			releaseProvisionedTaskWorkspace({
				entryId: "entry-1",
				workspaceId: "workspace-1",
			}),
		).rejects.toMatchObject({ code: "workspace_queue_release_lost" });

		deps.getTaskGitWorkspaceById.mockResolvedValueOnce(ready);
		const entry = { id: "entry-1", workspaceId: "workspace-1" };
		deps.state.returningResults = [[entry]];
		await expect(
			releaseProvisionedTaskWorkspace({
				entryId: "entry-1",
				workspaceId: "workspace-1",
			}),
		).resolves.toBe(entry);
	});
});
