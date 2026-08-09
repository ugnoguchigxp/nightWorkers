import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	canRetryTaskGitWorkspaceInitialization,
	initializeTaskGitWorkspace,
} from "../api/modules/gitworktree/task-git-workspace-initialization.service";

const mocks = vi.hoisted(() => {
	class BootstrapError extends Error {
		constructor(
			readonly code: string,
			message: string,
			readonly details: {
				stage: "detection" | "fingerprint" | "install" | "validation";
				adapterId?: string;
				componentRoot?: string;
				exitCode?: number | null;
				retryable: boolean;
			},
		) {
			super(message);
			this.name = "WorkspaceBootstrapError";
		}
	}
	return {
		BootstrapError,
		transition: vi.fn(),
		claim: vi.fn(),
		transitionClaimed: vi.fn(),
		getById: vi.fn(),
		renew: vi.fn(),
		bootstrap: vi.fn(),
	};
});

vi.mock("node:crypto", () => ({ randomUUID: vi.fn(() => "lease-owner-1") }));
vi.mock("../api/modules/gitworktree/task-git-workspace.repository", () => ({
	transitionTaskGitWorkspace: mocks.transition,
	claimTaskGitWorkspaceInitialization: mocks.claim,
	transitionClaimedTaskGitWorkspaceInitialization: mocks.transitionClaimed,
	getTaskGitWorkspaceById: mocks.getById,
	renewTaskGitWorkspaceInitializationLease: mocks.renew,
}));
vi.mock("../api/modules/gitworktree/workspace-bootstrap", () => ({
	runWorkspaceDependencyBootstrap: mocks.bootstrap,
	WorkspaceBootstrapError: mocks.BootstrapError,
}));

function workspace(overrides: Record<string, unknown> = {}) {
	return {
		id: "workspace-1",
		taskId: "task-1",
		repositoryId: "repository-1",
		status: "initializing",
		worktreePath: "/repo/worktree",
		initializationAttempt: 0,
		bootstrapEvidenceJson: null,
		leaseOwner: null,
		leaseExpiresAt: null,
		...overrides,
	};
}

function retryableFailure(overrides: Record<string, unknown> = {}) {
	return {
		dependencyBootstrapFailure: {
			code: "DEPENDENCY_INSTALL_FAILED",
			stage: "install",
			retryable: true,
			...overrides,
		},
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

async function expectCode(promise: Promise<unknown>, code: string) {
	await expect(promise).rejects.toMatchObject({ code });
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.useRealTimers();
	mocks.transition.mockResolvedValue(null);
	mocks.claim.mockImplementation(async (input) =>
		workspace({
			leaseOwner: input.leaseOwner,
			leaseExpiresAt: input.leaseExpiresAt,
			initializationAttempt: 1,
		}),
	);
	mocks.transitionClaimed.mockImplementation(async (input) =>
		workspace({
			...input.data,
			leaseOwner: null,
			leaseExpiresAt: null,
		}),
	);
	mocks.getById.mockResolvedValue(null);
	mocks.renew.mockResolvedValue(true);
	mocks.bootstrap.mockResolvedValue({
		status: "ready",
		components: [],
	});
});

afterEach(() => {
	vi.useRealTimers();
});

describe("canRetryTaskGitWorkspaceInitialization", () => {
	it.each([
		["wrong status", { status: "initializing" }, false],
		["missing path", { worktreePath: null }, false],
		["exhausted", { initializationAttempt: 3 }, false],
		["missing attempt", { initializationAttempt: undefined }, false],
		["missing evidence", { bootstrapEvidenceJson: null }, false],
		["array evidence", { bootstrapEvidenceJson: [] }, false],
		[
			"empty failure",
			{ bootstrapEvidenceJson: { dependencyBootstrapFailure: {} } },
			false,
		],
		[
			"non-retryable",
			{
				bootstrapEvidenceJson: retryableFailure({ retryable: false }),
			},
			false,
		],
		["retryable", { bootstrapEvidenceJson: retryableFailure() }, true],
	] as const)("evaluates %s boundary", (_name, overrides, expected) => {
		expect(
			canRetryTaskGitWorkspaceInitialization(
				workspace({ status: "initialization_failed", ...overrides }),
			),
		).toBe(expected);
	});
});

describe("initializeTaskGitWorkspace state and retry boundaries", () => {
	it.each([
		"ready",
		"active",
	])("reuses an already %s workspace", async (status) => {
		const current = workspace({ status });
		await expect(initializeTaskGitWorkspace(current, {})).resolves.toBe(
			current,
		);
		expect(mocks.transition).not.toHaveBeenCalled();
		expect(mocks.claim).not.toHaveBeenCalled();
	});

	it.each([
		null,
		0,
		"invalid",
		[],
		{},
		{ dependencyBootstrapFailure: null },
		{ dependencyBootstrapFailure: [] },
		{ dependencyBootstrapFailure: { retryable: false } },
	])("rejects a structurally non-retryable failure: %j", async (evidence) => {
		await expect(
			initializeTaskGitWorkspace(
				workspace({
					status: "initialization_failed",
					bootstrapEvidenceJson: evidence,
				}),
				{},
			),
		).rejects.toMatchObject({
			code: "workspace_dependency_initialization_failed",
			statusCode: 422,
			details: {
				bootstrapCode: undefined,
				stage: undefined,
				retryable: false,
			},
		});
	});

	it("reports stored non-retryable failure metadata", async () => {
		await expect(
			initializeTaskGitWorkspace(
				workspace({
					status: "initialization_failed",
					bootstrapEvidenceJson: retryableFailure({
						code: "BOOTSTRAP_LOCK_REQUIRED",
						stage: "detection",
						retryable: false,
					}),
				}),
				{},
			),
		).rejects.toMatchObject({
			details: {
				bootstrapCode: "BOOTSTRAP_LOCK_REQUIRED",
				stage: "detection",
			},
		});
	});

	it("rejects an exhausted retry before repository transition", async () => {
		await expectCode(
			initializeTaskGitWorkspace(
				workspace({
					status: "initialization_failed",
					initializationAttempt: 3,
					bootstrapEvidenceJson: retryableFailure(),
				}),
				{},
			),
			"workspace_initialization_retry_exhausted",
		);
		expect(mocks.transition).not.toHaveBeenCalled();
	});

	it("resumes a retryable failed workspace and clears prior failure fields", async () => {
		const resumed = workspace({
			status: "initializing",
			initializationAttempt: 1,
			bootstrapEvidenceJson: retryableFailure(),
		});
		mocks.transition.mockResolvedValue(resumed);
		mocks.claim.mockResolvedValue(
			workspace({ ...resumed, initializationAttempt: 2 }),
		);

		await initializeTaskGitWorkspace(
			workspace({
				status: "initialization_failed",
				initializationAttempt: 1,
				bootstrapEvidenceJson: retryableFailure(),
			}),
			{},
		);

		expect(mocks.transition).toHaveBeenCalledWith({
			id: "workspace-1",
			expectedStatus: "initialization_failed",
			data: {
				status: "initializing",
				leaseOwner: null,
				leaseExpiresAt: null,
				lastErrorCode: null,
				lastErrorMessage: null,
			},
		});
	});

	it("rejects when retry transition is lost and old state is not initializable", async () => {
		mocks.transition.mockResolvedValue(null);
		await expectCode(
			initializeTaskGitWorkspace(
				workspace({
					status: "initialization_failed",
					bootstrapEvidenceJson: retryableFailure(),
				}),
				{},
			),
			"workspace_not_initializable",
		);
	});

	it.each([
		workspace({ status: "allocated" }),
		workspace({ status: "initializing", worktreePath: null }),
		workspace({ status: "initializing", worktreePath: "" }),
	])("rejects a non-initializable workspace: %#", async (candidate) => {
		await expectCode(
			initializeTaskGitWorkspace(candidate, {}),
			"workspace_not_initializable",
		);
	});
});

describe("lost initialization claim ownership", () => {
	beforeEach(() => {
		mocks.claim.mockResolvedValue(null);
	});

	it.each([
		"ready",
		"active",
	])("returns concurrently %s workspace", async (status) => {
		const concurrent = workspace({ status });
		mocks.getById.mockResolvedValue(concurrent);
		await expect(initializeTaskGitWorkspace(workspace(), {})).resolves.toBe(
			concurrent,
		);
	});

	it("reports a live lease as initialization in progress", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-08-01T00:00:00.000Z"));
		mocks.getById.mockResolvedValue(
			workspace({
				leaseOwner: "other-owner",
				leaseExpiresAt: new Date("2026-08-01T00:01:00.000Z"),
			}),
		);
		await expectCode(
			initializeTaskGitWorkspace(workspace(), {}),
			"workspace_initialization_in_progress",
		);
	});

	it.each([
		["owner missing", { leaseOwner: null }],
		["expiry missing", { leaseExpiresAt: null }],
		["expired", { leaseExpiresAt: new Date("2026-07-31T23:59:00.000Z") }],
		["current missing", null],
	])("uses generic in-progress fallback when %s", async (_name, overrides) => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-08-01T00:00:00.000Z"));
		mocks.getById.mockResolvedValue(
			overrides === null
				? null
				: workspace({
						leaseOwner: "other-owner",
						leaseExpiresAt: new Date("2026-08-01T00:01:00.000Z"),
						...overrides,
					}),
		);
		await expectCode(
			initializeTaskGitWorkspace(workspace(), {}),
			"workspace_initialization_in_progress",
		);
	});

	it("reports exhausted attempts even without a live lease", async () => {
		mocks.getById.mockResolvedValue(
			workspace({
				leaseOwner: null,
				leaseExpiresAt: null,
				initializationAttempt: 3,
			}),
		);
		await expectCode(
			initializeTaskGitWorkspace(workspace(), {}),
			"workspace_initialization_retry_exhausted",
		);
	});
});

describe("bootstrap success, caller cancellation, and transition races", () => {
	it("boots dependencies, merges object evidence, and transitions to ready", async () => {
		const previous = { materialization: { status: "ready" } };
		const evidence = { status: "ready", components: [{ id: "root" }] };
		mocks.claim.mockResolvedValue(
			workspace({ bootstrapEvidenceJson: previous, initializationAttempt: 1 }),
		);
		mocks.bootstrap.mockResolvedValue(evidence);

		const result = await initializeTaskGitWorkspace(workspace(), {
			timeoutMs: 12_345,
		});

		expect(result.status).toBe("ready");
		expect(mocks.claim).toHaveBeenCalledWith({
			id: "workspace-1",
			leaseOwner: "lease-owner-1",
			leaseExpiresAt: expect.any(Date),
			maxAttempts: 3,
		});
		expect(mocks.bootstrap).toHaveBeenCalledWith({
			workspaceId: "workspace-1",
			workspaceRoot: "/repo/worktree",
			previousEvidence: previous,
			signal: expect.any(AbortSignal),
			timeoutMs: 12_345,
		});
		expect(mocks.transitionClaimed).toHaveBeenCalledWith({
			id: "workspace-1",
			leaseOwner: "lease-owner-1",
			data: expect.objectContaining({
				status: "ready",
				bootstrapEvidenceJson: {
					materialization: { status: "ready" },
					dependencyBootstrap: evidence,
				},
				initializedAt: expect.any(Date),
			}),
		});
	});

	it.each([
		null,
		0,
		"invalid",
		[],
	])("replaces non-record prior evidence while preserving the raw bootstrap input: %j", async (bootstrapEvidenceJson) => {
		mocks.claim.mockResolvedValue(workspace({ bootstrapEvidenceJson }));
		await initializeTaskGitWorkspace(workspace(), {});
		expect(mocks.bootstrap).toHaveBeenCalledWith(
			expect.objectContaining({ previousEvidence: bootstrapEvidenceJson }),
		);
		expect(
			mocks.transitionClaimed.mock.calls[0]?.[0].data.bootstrapEvidenceJson,
		).toEqual({
			dependencyBootstrap: { status: "ready", components: [] },
		});
	});

	it("propagates an already-aborted caller signal to bootstrap", async () => {
		const controller = new AbortController();
		controller.abort();

		await initializeTaskGitWorkspace(workspace(), {
			signal: controller.signal,
		});

		expect(mocks.bootstrap.mock.calls[0]?.[0].signal.aborted).toBe(true);
	});

	it("registers and removes a caller abort listener", async () => {
		const controller = new AbortController();
		const add = vi.spyOn(controller.signal, "addEventListener");
		const remove = vi.spyOn(controller.signal, "removeEventListener");
		const pendingBootstrap = deferred<Record<string, unknown>>();
		mocks.bootstrap.mockReturnValue(pendingBootstrap.promise);
		const pending = initializeTaskGitWorkspace(workspace(), {
			signal: controller.signal,
		});
		await vi.waitFor(() => expect(mocks.bootstrap).toHaveBeenCalled());

		controller.abort();
		expect(mocks.bootstrap.mock.calls[0]?.[0].signal.aborted).toBe(true);
		pendingBootstrap.resolve({ status: "ready" });
		await pending;

		expect(add).toHaveBeenCalledWith("abort", expect.any(Function), {
			once: true,
		});
		expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
	});

	it.each([
		"ready",
		"active",
	])("returns a concurrently %s workspace after ready transition is lost", async (status) => {
		mocks.transitionClaimed.mockResolvedValueOnce(null);
		const concurrent = workspace({ status });
		mocks.getById.mockResolvedValue(concurrent);

		await expect(initializeTaskGitWorkspace(workspace(), {})).resolves.toBe(
			concurrent,
		);
	});

	it.each([
		null,
		workspace({ status: "initializing" }),
	])("persists failure when ready transition is lost and current is not reusable: %j", async (current) => {
		mocks.transitionClaimed
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(workspace({ status: "initialization_failed" }));
		mocks.getById.mockResolvedValue(current);

		await expectCode(
			initializeTaskGitWorkspace(workspace(), {}),
			"workspace_initialization_transition_lost",
		);
		expect(mocks.transitionClaimed).toHaveBeenLastCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					status: "initialization_failed",
					lastErrorCode: "DEPENDENCY_INSTALL_FAILED",
				}),
			}),
		);
	});
});

describe("initialization heartbeat ownership", () => {
	it("aborts bootstrap when lease renewal loses ownership", async () => {
		vi.useFakeTimers();
		const pendingBootstrap = deferred<Record<string, unknown>>();
		mocks.bootstrap.mockReturnValue(pendingBootstrap.promise);
		mocks.renew.mockResolvedValue(false);
		const pending = initializeTaskGitWorkspace(workspace(), {});
		await vi.advanceTimersByTimeAsync(30_000);

		expect(mocks.renew).toHaveBeenCalledWith({
			id: "workspace-1",
			leaseOwner: "lease-owner-1",
			leaseExpiresAt: expect.any(Date),
		});
		expect(mocks.bootstrap.mock.calls[0]?.[0].signal.aborted).toBe(true);
		pendingBootstrap.resolve({ status: "ready" });
		await pending;
	});

	it("aborts after two consecutive renewal errors", async () => {
		vi.useFakeTimers();
		const pendingBootstrap = deferred<Record<string, unknown>>();
		mocks.bootstrap.mockReturnValue(pendingBootstrap.promise);
		mocks.renew.mockRejectedValue(new Error("database unavailable"));
		const pending = initializeTaskGitWorkspace(workspace(), {});
		await vi.advanceTimersByTimeAsync(60_000);

		expect(mocks.renew).toHaveBeenCalledTimes(2);
		expect(mocks.bootstrap.mock.calls[0]?.[0].signal.aborted).toBe(true);
		pendingBootstrap.resolve({ status: "ready" });
		await pending;
	});

	it("resets the renewal error counter after a successful heartbeat", async () => {
		vi.useFakeTimers();
		const pendingBootstrap = deferred<Record<string, unknown>>();
		mocks.bootstrap.mockReturnValue(pendingBootstrap.promise);
		mocks.renew
			.mockRejectedValueOnce(new Error("temporary"))
			.mockResolvedValueOnce(true)
			.mockRejectedValueOnce(new Error("temporary again"));
		const pending = initializeTaskGitWorkspace(workspace(), {});
		await vi.advanceTimersByTimeAsync(90_000);

		expect(mocks.renew).toHaveBeenCalledTimes(3);
		expect(mocks.bootstrap.mock.calls[0]?.[0].signal.aborted).toBe(false);
		pendingBootstrap.resolve({ status: "ready" });
		await pending;
	});

	it("skips overlapping renewal and stops heartbeats after caller abort", async () => {
		vi.useFakeTimers();
		const renewal = deferred<boolean>();
		const pendingBootstrap = deferred<Record<string, unknown>>();
		const caller = new AbortController();
		mocks.renew.mockReturnValue(renewal.promise);
		mocks.bootstrap.mockReturnValue(pendingBootstrap.promise);
		const pending = initializeTaskGitWorkspace(workspace(), {
			signal: caller.signal,
		});
		await vi.advanceTimersByTimeAsync(60_000);
		expect(mocks.renew).toHaveBeenCalledTimes(1);

		renewal.resolve(true);
		await vi.advanceTimersByTimeAsync(0);
		caller.abort();
		await vi.advanceTimersByTimeAsync(30_000);
		expect(mocks.renew).toHaveBeenCalledTimes(1);
		pendingBootstrap.resolve({ status: "ready" });
		await pending;
	});
});

describe("bootstrap error persistence and mapping", () => {
	it.each([
		[true, 503],
		[false, 422],
	] as const)("maps bootstrap retryable=%s to HTTP %s", async (retryable, statusCode) => {
		const error = new mocks.BootstrapError(
			"BOOTSTRAP_LOCK_MISMATCH",
			"Lockfile mismatch",
			{
				stage: "validation",
				adapterId: "node-pnpm",
				componentRoot: "packages/app",
				exitCode: 2,
				retryable,
			},
		);
		mocks.bootstrap.mockRejectedValue(error);

		await expect(
			initializeTaskGitWorkspace(workspace(), {}),
		).rejects.toMatchObject({
			code: "workspace_dependency_initialization_failed",
			statusCode,
			message: "Lockfile mismatch",
			details: {
				bootstrapCode: "BOOTSTRAP_LOCK_MISMATCH",
				stage: "validation",
				retryable,
				adapterId: "node-pnpm",
				componentRoot: "packages/app",
			},
		});
		const failure = mocks.transitionClaimed.mock.calls[0]?.[0].data;
		expect(failure).toMatchObject({
			status: "initialization_failed",
			lastErrorCode: "BOOTSTRAP_LOCK_MISMATCH",
			lastErrorMessage: "Lockfile mismatch",
			bootstrapEvidenceJson: {
				dependencyBootstrapFailure: {
					code: "BOOTSTRAP_LOCK_MISMATCH",
					message: "Lockfile mismatch",
					stage: "validation",
					retryable,
				},
			},
		});
	});

	it("preserves prior record evidence when persisting bootstrap failure", async () => {
		mocks.claim.mockResolvedValue(
			workspace({ bootstrapEvidenceJson: { allocation: { status: "ready" } } }),
		);
		mocks.bootstrap.mockRejectedValue(
			new mocks.BootstrapError("DEPENDENCY_INSTALL_TIMEOUT", "Timed out", {
				stage: "install",
				retryable: true,
			}),
		);

		await expect(
			initializeTaskGitWorkspace(workspace(), {}),
		).rejects.toMatchObject({ statusCode: 503 });
		expect(
			mocks.transitionClaimed.mock.calls[0]?.[0].data.bootstrapEvidenceJson,
		).toMatchObject({
			allocation: { status: "ready" },
			dependencyBootstrapFailure: {
				code: "DEPENDENCY_INSTALL_TIMEOUT",
			},
		});
	});

	it.each([
		[new Error("unexpected"), "throws Error unchanged"],
		[{ unexpected: true }, "throws raw value unchanged"],
	] as const)("persists a generic retryable failure and %s", async (error) => {
		mocks.bootstrap.mockRejectedValue(error);

		await expect(initializeTaskGitWorkspace(workspace(), {})).rejects.toBe(
			error,
		);
		expect(mocks.transitionClaimed).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					status: "initialization_failed",
					lastErrorCode: "DEPENDENCY_INSTALL_FAILED",
					lastErrorMessage: "Workspace dependency initialization failed.",
					bootstrapEvidenceJson: {
						dependencyBootstrapFailure: {
							code: "DEPENDENCY_INSTALL_FAILED",
							message: "Workspace dependency initialization failed.",
							stage: "install",
							retryable: true,
						},
					},
				}),
			}),
		);
	});

	it("surfaces repository rollback persistence failure", async () => {
		const bootstrapError = new Error("bootstrap failed");
		const persistenceError = new Error("database failed");
		mocks.bootstrap.mockRejectedValue(bootstrapError);
		mocks.transitionClaimed.mockRejectedValue(persistenceError);

		await expect(initializeTaskGitWorkspace(workspace(), {})).rejects.toBe(
			persistenceError,
		);
	});
});
