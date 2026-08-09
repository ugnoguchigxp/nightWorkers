import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createMergeRecordForCommittedRun,
	deferTaskRunMerge,
	executeTaskRunMerge,
	overrideTaskRunMergeTarget,
	previewTaskRunMerge,
	requestTaskRunRework,
} from "../api/modules/nightworkers/nightworkers.git-merge.service";

const mocks = vi.hoisted(() => {
	type CommandResult = { stdout?: string; reject?: unknown };
	const state = {
		selectQueue: [] as unknown[][],
		commandResults: new Map<string, CommandResult[]>(),
		updateCalls: [] as Array<{ table: unknown; data: unknown }>,
		commitRecord: null as Record<string, unknown> | null,
		worktrees: [] as Array<Record<string, unknown>>,
	};
	const execFileAsync = vi.fn(
		async (_command: string, args: string[]): Promise<{ stdout: string }> => {
			const queue = state.commandResults.get(JSON.stringify(args));
			const result = queue?.shift();
			if (result && "reject" in result) throw result.reject;
			if (result) return { stdout: result.stdout ?? "" };
			if (args[0] === "rev-parse" && args[1] === "HEAD")
				return { stdout: "target-sha\n" };
			if (args[0] === "rev-parse" && args[2]?.includes("source"))
				return { stdout: "source-sha\n" };
			if (args[0] === "rev-parse") return { stdout: "target-sha\n" };
			if (args[0] === "merge-base" && args[1] !== "--is-ancestor")
				return { stdout: "base-sha\n" };
			return { stdout: "" };
		},
	);
	const db = {
		select: vi.fn(() => ({
			from: vi.fn(() => ({
				where: vi.fn(() => Promise.resolve(state.selectQueue.shift() ?? [])),
			})),
		})),
		update: vi.fn((table: unknown) => ({
			set: vi.fn((data: unknown) => {
				state.updateCalls.push({ table, data });
				return { where: vi.fn(async () => undefined) };
			}),
		})),
	};
	const getMergeRecord = vi.fn();
	const createMergeRecord = vi.fn();
	const compareAndSet = vi.fn();
	const persistMerged = vi.fn();
	const admit = vi.fn();
	const consume = vi.fn();
	const listWorktrees = vi.fn();
	const mutationLock = vi.fn(
		async (
			_repositoryId: string,
			_operation: string,
			callback: () => unknown,
		) => callback(),
	);
	const getCommitRecord = vi.fn(async () => state.commitRecord);

	return {
		state,
		execFileAsync,
		db,
		getMergeRecord,
		createMergeRecord,
		compareAndSet,
		persistMerged,
		admit,
		consume,
		listWorktrees,
		mutationLock,
		getCommitRecord,
	};
});

vi.mock("node:child_process", () => ({ execFile: vi.fn() }));
vi.mock("node:util", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:util")>();
	return { ...actual, promisify: vi.fn(() => mocks.execFileAsync) };
});
vi.mock("../api/db/client", () => ({ db: mocks.db }));
vi.mock("../api/modules/gitCloseout/closeout-admission.service", () => ({
	admitCloseout: mocks.admit,
	consumeCloseoutAdmission: mocks.consume,
}));
vi.mock("../api/modules/gitworktree/gitworktree.service", () => ({
	listRepositoryWorktrees: mocks.listWorktrees,
}));
vi.mock("../api/modules/gitworktree/repository-git-mutation-lock", () => ({
	withRepositoryGitMutationLock: mocks.mutationLock,
}));
vi.mock(
	"../api/modules/nightworkers/nightworkers.git-merge.repository",
	() => ({
		getTaskRunMergeRecord: mocks.getMergeRecord,
		createTaskRunMergeRecord: mocks.createMergeRecord,
		compareAndSetTaskRunMergeRecord: mocks.compareAndSet,
		persistMergedLifecycle: mocks.persistMerged,
	}),
);
vi.mock("../api/modules/nightworkers/nightworkers.repository", () => ({
	getTaskRunCommitRecord: mocks.getCommitRecord,
}));

const runId = "run-00000001";

function mergeRecord(overrides: Record<string, unknown> = {}) {
	return {
		id: "merge-1",
		runId,
		taskId: "task-12345678-more",
		repositoryId: "repository-1",
		workspaceId: "workspace-1",
		sourceBranch: "task/source",
		sourceCommitSha: "source-sha",
		planTargetBranch: "main",
		planTargetBaseSha: "base-sha",
		targetBranch: "main",
		targetSelectedSha: "base-sha",
		observedTargetSha: "target-sha",
		strategy: "merge_commit",
		ciStatus: "not_required",
		targetPushStatus: "not_required",
		status: "merge_ready",
		recordVersion: 1,
		previewEvidenceJson: {
			closeoutAdmissionId: "admission-1",
			closeoutAdmissionDigest: "digest-1",
		},
		...overrides,
	};
}

function repository(overrides: Record<string, unknown> = {}) {
	return { id: "repository-1", localPath: "/repo", ...overrides };
}

function workspace(overrides: Record<string, unknown> = {}) {
	return {
		id: "workspace-1",
		taskId: "task-12345678-more",
		repositoryId: "repository-1",
		sourceBranch: "task/source",
		targetBranch: "main",
		targetBaseSha: "base-sha",
		integrationPolicySnapshotJson: {},
		...overrides,
	};
}

function targetWorktree(overrides: Record<string, unknown> = {}) {
	return {
		branch: "main",
		canonicalPath: "/repo",
		bare: false,
		prunable: false,
		usage: {
			activeTaskCount: 0,
			activeRunCount: 0,
			pendingCloseoutCount: 0,
		},
		...overrides,
	};
}

function queueCommand(
	args: string[],
	...results: Array<string | { reject: unknown }>
) {
	mocks.state.commandResults.set(
		JSON.stringify(args),
		results.map((result) =>
			typeof result === "string" ? { stdout: result } : result,
		),
	);
}

async function expectCode(promise: Promise<unknown>, code: string) {
	await expect(promise).rejects.toMatchObject({ code });
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.state.selectQueue = [];
	mocks.state.commandResults.clear();
	mocks.state.updateCalls = [];
	mocks.state.commitRecord = { commitSha: "source-sha", pushStatus: "pushed" };
	mocks.state.worktrees = [targetWorktree()];
	mocks.getCommitRecord.mockImplementation(
		async () => mocks.state.commitRecord,
	);
	mocks.getMergeRecord.mockResolvedValue(mergeRecord());
	mocks.createMergeRecord.mockImplementation(async (input) => ({
		id: "merge-created",
		recordVersion: 0,
		...input,
	}));
	mocks.compareAndSet.mockImplementation(async (input) => ({
		...mergeRecord(),
		...input.data,
		recordVersion: input.expectedVersion + 1,
	}));
	mocks.persistMerged.mockResolvedValue(
		mergeRecord({ status: "merged", targetHeadAfter: "after-sha" }),
	);
	mocks.admit.mockResolvedValue({
		id: "admission-1",
		admissionDigest: "digest-1",
		status: "admitted",
	});
	mocks.consume.mockResolvedValue({ status: "consumed" });
	mocks.listWorktrees.mockImplementation(async () => ({
		worktrees: mocks.state.worktrees,
	}));
	mocks.mutationLock.mockImplementation(
		async (_repositoryId, _operation, callback) => callback(),
	);
	mocks.execFileAsync.mockImplementation(
		async (_command: string, args: string[]): Promise<{ stdout: string }> => {
			const queue = mocks.state.commandResults.get(JSON.stringify(args));
			const result = queue?.shift();
			if (result && "reject" in result) throw result.reject;
			if (result) return { stdout: result.stdout ?? "" };
			if (args[0] === "rev-parse" && args[1] === "HEAD")
				return { stdout: "target-sha\n" };
			if (args[0] === "rev-parse" && args[2]?.includes("source"))
				return { stdout: "source-sha\n" };
			if (args[0] === "rev-parse") return { stdout: "target-sha\n" };
			if (args[0] === "merge-base" && args[1] !== "--is-ancestor")
				return { stdout: "base-sha\n" };
			return { stdout: "" };
		},
	);
});

describe("createMergeRecordForCommittedRun", () => {
	it("returns an existing merge record without database reads", async () => {
		const existing = mergeRecord();
		mocks.getMergeRecord.mockResolvedValue(existing);

		await expect(createMergeRecordForCommittedRun(runId)).resolves.toBe(
			existing,
		);
		expect(mocks.db.select).not.toHaveBeenCalled();
	});

	it("rejects a missing run", async () => {
		mocks.getMergeRecord.mockResolvedValue(null);
		mocks.state.selectQueue = [[]];
		await expect(createMergeRecordForCommittedRun(runId)).rejects.toMatchObject(
			{
				code: "NOT_FOUND",
				message: "Run not found",
			},
		);
	});

	it("rejects a missing committed SHA", async () => {
		mocks.getMergeRecord.mockResolvedValue(null);
		mocks.state.selectQueue = [[{ id: runId, taskId: "task-1" }]];
		mocks.state.commitRecord = null;
		await expectCode(
			createMergeRecordForCommittedRun(runId),
			"merge_source_missing",
		);
		mocks.state.commitRecord = { commitSha: null };
		mocks.state.selectQueue = [[{ id: runId, taskId: "task-1" }]];
		await expectCode(
			createMergeRecordForCommittedRun(runId),
			"merge_source_missing",
		);
	});

	it("rejects missing workspace provenance", async () => {
		mocks.getMergeRecord.mockResolvedValue(null);
		mocks.state.selectQueue = [[{ id: runId, taskId: "task-1" }], []];
		await expectCode(
			createMergeRecordForCommittedRun(runId),
			"workspace_provenance_missing",
		);

		mocks.state.selectQueue = [
			[{ id: runId, taskId: "task-1" }],
			[workspace({ targetBaseSha: null })],
		];
		await expectCode(
			createMergeRecordForCommittedRun(runId),
			"workspace_provenance_missing",
		);
	});

	it.each([
		[
			"defaults",
			{},
			{
				strategy: "merge_commit",
				ciStatus: "not_required",
				targetPushStatus: "not_required",
			},
		],
		[
			"external CI and after-merge push",
			{
				defaultMergeStrategy: "squash",
				ciGate: "external_ci_required",
				targetPushPolicy: "after_merge",
			},
			{
				strategy: "squash",
				ciStatus: "pending",
				targetPushStatus: "not_started",
			},
		],
		[
			"manual push",
			{ targetPushPolicy: "manual" },
			{ targetPushStatus: "not_started" },
		],
	] as const)("creates a record from %s policy", async (_name, policy, expected) => {
		mocks.getMergeRecord.mockResolvedValue(null);
		mocks.state.selectQueue = [
			[{ id: runId, taskId: "task-12345678-more" }],
			[workspace({ integrationPolicySnapshotJson: policy })],
		];

		const result = await createMergeRecordForCommittedRun(runId);

		expect(result).toMatchObject(expected);
		expect(mocks.createMergeRecord).toHaveBeenCalledWith(
			expect.objectContaining({
				sourceCommitSha: "source-sha",
				targetSelectedSha: "base-sha",
			}),
		);
		expect(mocks.state.updateCalls.at(-1)?.data).toMatchObject({
			status: "integration_pending",
			expectedHeadSha: "source-sha",
			lastVerifiedHead: "source-sha",
		});
	});
});

describe("previewTaskRunMerge", () => {
	function preparePreview(
		recordOverrides: Record<string, unknown> = {},
		workspaceRow: Record<string, unknown> | null = workspace(),
		commitRow: Record<string, unknown> | null = { pushStatus: "pushed" },
	) {
		mocks.getMergeRecord.mockResolvedValue(
			mergeRecord({
				status: "decision_required",
				recordVersion: 4,
				...recordOverrides,
			}),
		);
		mocks.state.selectQueue = [
			[repository()],
			workspaceRow ? [workspaceRow] : [],
			commitRow ? [commitRow] : [],
		];
	}

	it("rejects missing and stale records before admission", async () => {
		mocks.getMergeRecord.mockResolvedValueOnce(null);
		await expect(
			previewTaskRunMerge({ runId, expectedVersion: 4 }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });

		mocks.getMergeRecord.mockResolvedValueOnce(
			mergeRecord({ recordVersion: 3 }),
		);
		await expectCode(
			previewTaskRunMerge({ runId, expectedVersion: 4 }),
			"merge_record_changed",
		);
		expect(mocks.admit).not.toHaveBeenCalled();
	});

	it("rejects a consumed admission and missing repository", async () => {
		preparePreview();
		mocks.admit.mockResolvedValueOnce({ status: "consumed" });
		await expectCode(
			previewTaskRunMerge({ runId, expectedVersion: 4 }),
			"closeout_admission_consumed",
		);

		preparePreview();
		mocks.state.selectQueue = [[]];
		await expect(
			previewTaskRunMerge({ runId, expectedVersion: 4 }),
		).rejects.toMatchObject({
			code: "NOT_FOUND",
			message: "Repository not found",
		});
	});

	it("rejects source drift and identical branches", async () => {
		preparePreview();
		queueCommand(
			["rev-parse", "--verify", "task/source^{commit}"],
			"moved-sha",
		);
		await expectCode(
			previewTaskRunMerge({ runId, expectedVersion: 4 }),
			"merge_source_changed",
		);

		preparePreview({ targetBranch: "task/source" });
		queueCommand(
			["rev-parse", "--verify", "task/source^{commit}"],
			"source-sha",
			"target-sha",
		);
		await expectCode(
			previewTaskRunMerge({ runId, expectedVersion: 4 }),
			"merge_source_equals_target",
		);
	});

	it("blocks pending external CI before workspace reads", async () => {
		preparePreview({ ciStatus: "pending" });
		const result = await previewTaskRunMerge({ runId, expectedVersion: 4 });

		expect(result).toMatchObject({
			status: "merge_blocked",
			lastErrorCode: "external_ci_required",
		});
		expect(mocks.state.selectQueue).toHaveLength(2);
	});

	it("blocks a required source push when workspace or commit evidence is missing", async () => {
		preparePreview(
			{},
			workspace({
				integrationPolicySnapshotJson: {
					sourcePushPolicy: "required_before_merge",
				},
			}),
			null,
		);

		const result = await previewTaskRunMerge({ runId, expectedVersion: 4 });
		expect(result).toMatchObject({ lastErrorCode: "source_push_required" });
	});

	it("allows optional workspace policy and blocks unrelated history", async () => {
		preparePreview({}, null, null);
		queueCommand(["merge-base", "source-sha", "target-sha"], {
			reject: new Error("unrelated"),
		});

		const result = await previewTaskRunMerge({ runId, expectedVersion: 4 });
		expect(result).toMatchObject({ lastErrorCode: "unrelated_history" });
	});

	it("captures conflict paths with missing stdout/stderr fallbacks", async () => {
		preparePreview();
		queueCommand(["merge-tree", "--write-tree", "target-sha", "source-sha"], {
			reject: {
				stdout: "CONFLICT content in src/a.ts\nCONFLICT rename in src/b.ts\n",
			},
		});

		const result = await previewTaskRunMerge({ runId, expectedVersion: 4 });
		expect(result).toMatchObject({
			status: "merge_conflicted",
			conflictPathsJson: ["src/a.ts", "src/b.ts"],
		});

		preparePreview();
		queueCommand(["merge-tree", "--write-tree", "target-sha", "source-sha"], {
			reject: {},
		});
		const empty = await previewTaskRunMerge({ runId, expectedVersion: 4 });
		expect(empty).toMatchObject({ conflictPathsJson: [] });
	});

	it("blocks a diverged fast-forward-only preview", async () => {
		preparePreview({ strategy: "fast_forward_only" });
		queueCommand(["merge-base", "--is-ancestor", "source-sha", "target-sha"], {
			reject: new Error("not ancestor"),
		});
		queueCommand(["merge-base", "--is-ancestor", "target-sha", "source-sha"], {
			reject: new Error("not fast forward"),
		});

		const result = await previewTaskRunMerge({ runId, expectedVersion: 4 });
		expect(result).toMatchObject({ lastErrorCode: "fast_forward_required" });
	});

	it("allows a fast-forward-only preview when target is an ancestor", async () => {
		preparePreview({ strategy: "fast_forward_only" });
		queueCommand(["merge-base", "--is-ancestor", "source-sha", "target-sha"], {
			reject: new Error("not integrated"),
		});

		const result = await previewTaskRunMerge({ runId, expectedVersion: 4 });
		expect(result).toMatchObject({
			status: "merge_ready",
			previewEvidenceJson: {
				alreadyIntegrated: false,
				closeoutAdmissionId: "admission-1",
			},
		});
	});

	it("records an already-integrated ready preview", async () => {
		preparePreview();
		const result = await previewTaskRunMerge({ runId, expectedVersion: 4 });
		expect(result).toMatchObject({
			status: "merge_ready",
			previewEvidenceJson: { alreadyIntegrated: true },
		});
	});
});

describe("merge decisions and target override", () => {
	it.each([
		["defer", deferTaskRunMerge],
		["rework", requestTaskRunRework],
	] as const)("rejects missing %s records", async (_name, action) => {
		mocks.getMergeRecord.mockResolvedValue(null);
		await expect(action({ runId, expectedVersion: 1 })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});

	it.each([
		["defer", deferTaskRunMerge],
		["rework", requestTaskRunRework],
	] as const)("rejects stale %s decisions", async (_name, action) => {
		mocks.compareAndSet.mockResolvedValue(null);
		await expectCode(
			action({ runId, expectedVersion: 1 }),
			"merge_record_changed",
		);
	});

	it("persists defer and rework task/workspace transitions", async () => {
		await expect(
			deferTaskRunMerge({ runId, expectedVersion: 1 }),
		).resolves.toMatchObject({ decision: "defer", status: "deferred" });
		expect(mocks.state.updateCalls.at(-1)?.data).toMatchObject({
			status: "integration_pending",
		});

		await expect(
			requestTaskRunRework({ runId, expectedVersion: 1 }),
		).resolves.toMatchObject({
			decision: "rework",
			status: "rework_requested",
		});
		expect(mocks.state.updateCalls.slice(-2).map((call) => call.data)).toEqual([
			expect.objectContaining({ status: "active" }),
			expect.objectContaining({ status: "needs_review" }),
		]);
	});

	it("rejects override with a missing record or integration context", async () => {
		mocks.getMergeRecord.mockResolvedValueOnce(null);
		await expect(
			overrideTaskRunMergeTarget({
				runId,
				targetBranch: "release",
				expectedVersion: 1,
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });

		mocks.state.selectQueue = [[], [workspace()]];
		await expect(
			overrideTaskRunMergeTarget({
				runId,
				targetBranch: "release",
				expectedVersion: 1,
			}),
		).rejects.toMatchObject({
			code: "NOT_FOUND",
			message: "Git integration context not found",
		});

		mocks.state.selectQueue = [[repository()], []];
		await expect(
			overrideTaskRunMergeTarget({
				runId,
				targetBranch: "release",
				expectedVersion: 1,
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("rejects invalid syntax and nonexistent target branches", async () => {
		mocks.state.selectQueue = [[repository()], [workspace()]];
		queueCommand(["check-ref-format", "--branch", "bad branch"], {
			reject: new Error("invalid"),
		});
		await expectCode(
			overrideTaskRunMergeTarget({
				runId,
				targetBranch: "bad branch",
				expectedVersion: 1,
			}),
			"merge_target_invalid",
		);

		mocks.state.selectQueue = [[repository()], [workspace()]];
		queueCommand(["rev-parse", "--verify", "missing^{commit}"], {
			reject: new Error("missing"),
		});
		await expectCode(
			overrideTaskRunMergeTarget({
				runId,
				targetBranch: "missing",
				expectedVersion: 1,
			}),
			"merge_target_invalid",
		);
	});

	it.each([
		["external", "external_ci_required", "pending"],
		["none", "none", "not_required"],
	] as const)("overrides target with %s CI policy", async (_name, ciGate, ciStatus) => {
		mocks.state.selectQueue = [
			[repository()],
			[workspace({ integrationPolicySnapshotJson: { ciGate } })],
		];
		queueCommand(["rev-parse", "--verify", "release^{commit}"], "release-sha");

		const result = await overrideTaskRunMergeTarget({
			runId,
			targetBranch: "release",
			expectedVersion: 1,
		});
		expect(result).toMatchObject({
			targetBranch: "release",
			targetSelectedSha: "release-sha",
			ciStatus,
			previewEvidenceJson: null,
		});
	});

	it("rejects a concurrent target override", async () => {
		mocks.state.selectQueue = [[repository()], [workspace()]];
		mocks.compareAndSet.mockResolvedValue(null);
		await expectCode(
			overrideTaskRunMergeTarget({
				runId,
				targetBranch: "release",
				expectedVersion: 1,
			}),
			"merge_record_changed",
		);
	});
});

describe("executeTaskRunMerge", () => {
	function prepareExecution(
		recordOverrides: Record<string, unknown> = {},
		workspaceRow: Record<string, unknown> | undefined = workspace(),
	) {
		const record = mergeRecord(recordOverrides);
		mocks.getMergeRecord.mockResolvedValue(record);
		mocks.state.selectQueue = [
			[repository()],
			...(workspaceRow ? [[workspaceRow]] : [[]]),
		];
		mocks.state.worktrees = [targetWorktree()];
		return record;
	}

	it("rejects an absent outer record without taking a lock", async () => {
		mocks.getMergeRecord.mockResolvedValue(null);
		await expect(
			executeTaskRunMerge({ runId, expectedVersion: 1 }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(mocks.mutationLock).not.toHaveBeenCalled();
	});

	it("uses the repository mutation lock and rejects a missing locked record", async () => {
		mocks.getMergeRecord
			.mockResolvedValueOnce(mergeRecord())
			.mockResolvedValueOnce(null);
		await expect(
			executeTaskRunMerge({ runId, expectedVersion: 1 }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(mocks.mutationLock).toHaveBeenCalledWith(
			"repository-1",
			"merge",
			expect.any(Function),
		);
	});

	it.each([
		[{ recordVersion: 2 }, 1],
		[{ status: "decision_required" }, 1],
	] as const)("rejects a stale preview %#", async (overrides, expectedVersion) => {
		prepareExecution(overrides);
		await expectCode(
			executeTaskRunMerge({ runId, expectedVersion }),
			"merge_preview_stale",
		);
	});

	it("rejects a consumed admission", async () => {
		prepareExecution();
		mocks.admit.mockResolvedValue({ status: "consumed" });
		await expectCode(
			executeTaskRunMerge({ runId, expectedVersion: 1 }),
			"closeout_admission_consumed",
		);
	});

	it.each([
		null,
		"bad",
		[],
		{},
		{
			closeoutAdmissionId: "other",
			closeoutAdmissionDigest: "digest-1",
		},
		{
			closeoutAdmissionId: "admission-1",
			closeoutAdmissionDigest: "other",
		},
	])("rejects stale or invalid preview evidence: %j", async (previewEvidenceJson) => {
		prepareExecution({ previewEvidenceJson });
		await expectCode(
			executeTaskRunMerge({ runId, expectedVersion: 1 }),
			"merge_preview_stale",
		);
	});

	it("rejects a missing repository and source drift", async () => {
		prepareExecution();
		mocks.state.selectQueue = [[]];
		await expect(
			executeTaskRunMerge({ runId, expectedVersion: 1 }),
		).rejects.toMatchObject({
			code: "NOT_FOUND",
			message: "Repository not found",
		});

		prepareExecution();
		queueCommand(
			["rev-parse", "--verify", "task/source^{commit}"],
			"moved-sha",
		);
		await expectCode(
			executeTaskRunMerge({ runId, expectedVersion: 1 }),
			"merge_source_changed",
		);
	});

	it.each([
		["missing", []],
		["bare", [targetWorktree({ bare: true })]],
		["prunable", [targetWorktree({ prunable: true })]],
	] as const)("rejects a %s target worktree", async (_name, worktrees) => {
		prepareExecution();
		mocks.state.worktrees = [...worktrees];
		await expectCode(
			executeTaskRunMerge({ runId, expectedVersion: 1 }),
			"merge_target_worktree_unavailable",
		);
	});

	it.each([
		{ activeTaskCount: 1, activeRunCount: 0, pendingCloseoutCount: 0 },
		{ activeTaskCount: 0, activeRunCount: 1, pendingCloseoutCount: 0 },
		{ activeTaskCount: 0, activeRunCount: 0, pendingCloseoutCount: 1 },
	])("rejects target worktree ownership usage: %j", async (usage) => {
		prepareExecution();
		mocks.state.worktrees = [targetWorktree({ usage })];
		await expectCode(
			executeTaskRunMerge({ runId, expectedVersion: 1 }),
			"merge_target_in_use",
		);
	});

	it("rejects target drift and dirty status", async () => {
		prepareExecution();
		queueCommand(["rev-parse", "HEAD"], "advanced-sha");
		await expectCode(
			executeTaskRunMerge({ runId, expectedVersion: 1 }),
			"merge_target_changed",
		);

		prepareExecution();
		queueCommand(["status", "--porcelain"], " M dirty.ts\n");
		await expectCode(
			executeTaskRunMerge({ runId, expectedVersion: 1 }),
			"merge_target_dirty",
		);
	});

	it.each([
		["merge_commit", ["merge", "--no-ff", "--no-edit", "source-sha"]],
		["fast_forward_only", ["merge", "--ff-only", "source-sha"]],
	] as const)("executes %s and returns latest persisted record", async (strategy, args) => {
		prepareExecution({ strategy });
		queueCommand(["rev-parse", "HEAD"], "target-sha", "after-sha");
		const latest = mergeRecord({
			status: "merged",
			targetHeadAfter: "after-sha",
		});
		mocks.getMergeRecord
			.mockResolvedValueOnce(mergeRecord({ strategy }))
			.mockResolvedValueOnce(mergeRecord({ strategy }))
			.mockResolvedValueOnce(latest);

		await expect(
			executeTaskRunMerge({ runId, expectedVersion: 1 }),
		).resolves.toBe(latest);
		expect(mocks.execFileAsync).toHaveBeenCalledWith(
			"git",
			args,
			expect.objectContaining({ cwd: "/repo" }),
		);
		expect(mocks.persistMerged).toHaveBeenCalledWith(
			expect.objectContaining({
				mergeOrigin: "already_ancestor",
				targetHeadAfter: "after-sha",
			}),
		);
		expect(mocks.consume).toHaveBeenCalledWith("admission-1");
	});

	it("executes squash, creates a commit, and falls back to persisted update", async () => {
		prepareExecution({ strategy: "squash" }, undefined);
		queueCommand(["merge-base", "--is-ancestor", "source-sha", "target-sha"], {
			reject: new Error("not integrated"),
		});
		queueCommand(["rev-parse", "HEAD"], "target-sha", "squash-sha");
		mocks.getMergeRecord
			.mockResolvedValueOnce(mergeRecord({ strategy: "squash" }))
			.mockResolvedValueOnce(mergeRecord({ strategy: "squash" }))
			.mockResolvedValueOnce(null);

		const result = await executeTaskRunMerge({ runId, expectedVersion: 1 });

		expect(result).toMatchObject({ status: "merged" });
		expect(mocks.execFileAsync).toHaveBeenCalledWith(
			"git",
			["commit", "-m", "Merge reviewed task task-123"],
			expect.any(Object),
		);
		expect(mocks.persistMerged).toHaveBeenCalledWith(
			expect.objectContaining({ mergeOrigin: "local" }),
		);
	});

	it("blocks configured automatic push when remote is missing", async () => {
		prepareExecution(
			{},
			workspace({
				integrationPolicySnapshotJson: {
					targetPushPolicy: "after_merge",
					remoteName: null,
				},
			}),
		);
		queueCommand(["rev-parse", "HEAD"], "target-sha", "after-sha");

		await executeTaskRunMerge({ runId, expectedVersion: 1 });

		expect(mocks.state.updateCalls.at(-1)?.data).toMatchObject({
			targetPushStatus: "blocked",
			lastErrorCode: "target_push_policy_blocked",
		});
	});

	it("automatically pushes and records success", async () => {
		prepareExecution(
			{},
			workspace({
				integrationPolicySnapshotJson: {
					targetPushPolicy: "after_merge",
					remoteName: "origin",
				},
			}),
		);
		queueCommand(["rev-parse", "HEAD"], "target-sha", "after-sha");

		await executeTaskRunMerge({ runId, expectedVersion: 1 });

		expect(mocks.execFileAsync).toHaveBeenCalledWith(
			"git",
			["push", "origin", "main"],
			expect.any(Object),
		);
		expect(mocks.state.updateCalls.map((call) => call.data)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ targetPushStatus: "pushing" }),
				expect.objectContaining({ targetPushStatus: "pushed" }),
			]),
		);
	});

	it.each([
		[new Error("network down"), "network down"],
		[{ reason: "offline" }, "Target push failed"],
	] as const)("records automatic push failure %#", async (pushError, message) => {
		prepareExecution(
			{},
			workspace({
				integrationPolicySnapshotJson: {
					targetPushPolicy: "after_merge",
					remoteName: "origin",
				},
			}),
		);
		queueCommand(["rev-parse", "HEAD"], "target-sha", "after-sha");
		queueCommand(["push", "origin", "main"], { reject: pushError });

		await executeTaskRunMerge({ runId, expectedVersion: 1 });

		expect(mocks.state.updateCalls.at(-1)?.data).toMatchObject({
			targetPushStatus: "failed",
			lastErrorCode: "target_push_failed",
			lastErrorMessage: message,
		});
	});

	it("records merge conflict details and attempts both cleanup commands", async () => {
		prepareExecution();
		queueCommand(["merge", "--no-ff", "--no-edit", "source-sha"], {
			reject: new Error("merge exploded"),
		});
		queueCommand(["diff", "--name-only", "--diff-filter=U"], "a.ts\n\nb.ts\n");
		queueCommand(["merge", "--abort"], { reject: new Error("abort failed") });
		queueCommand(["reset", "--merge", "target-sha"], {
			reject: new Error("reset failed"),
		});

		await expect(
			executeTaskRunMerge({ runId, expectedVersion: 1 }),
		).rejects.toThrow("merge exploded");
		expect(mocks.compareAndSet).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					status: "merge_conflicted",
					lastErrorMessage: "merge exploded",
					conflictPathsJson: ["a.ts", "b.ts"],
				}),
			}),
		);
	});

	it("uses conflict and error fallbacks for non-Error merge failures", async () => {
		prepareExecution();
		queueCommand(["merge", "--no-ff", "--no-edit", "source-sha"], {
			reject: { failure: true },
		});
		queueCommand(["diff", "--name-only", "--diff-filter=U"], {
			reject: new Error("diff failed"),
		});

		await expect(
			executeTaskRunMerge({ runId, expectedVersion: 1 }),
		).rejects.toEqual({ failure: true });
		expect(mocks.compareAndSet).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					lastErrorMessage: "Merge failed",
					conflictPathsJson: [],
				}),
			}),
		);
	});
});
