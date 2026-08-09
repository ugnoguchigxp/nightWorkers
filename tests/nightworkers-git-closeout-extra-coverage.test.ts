import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	commitRunGitCloseout,
	getRunGitCloseout,
	pushRunGitCloseout,
} from "../api/modules/nightworkers/nightworkers.git-closeout.service";

const mocks = vi.hoisted(() => {
	class StructuredError extends Error {}
	const state = {
		run: null as Record<string, unknown> | null,
		repository: null as Record<string, unknown> | null,
		commitRecord: null as Record<string, unknown> | null,
		commitRecordQueue: [] as Array<Record<string, unknown> | null>,
		mergeRecord: null as Record<string, unknown> | null,
		reviewSession: null as Record<string, unknown> | null,
		artifacts: [] as Array<Record<string, unknown>>,
		closeoutEvidence: null as Record<string, unknown> | null,
		gitState: null as Record<string, unknown> | null,
		gitStateQueue: [] as Array<Record<string, unknown>>,
		integrationOverride: null as Record<string, unknown> | null,
		taskWorkspace: null as Record<string, unknown> | null,
	};
	const getTaskRun = vi.fn(async () => state.run);
	const getTask = vi.fn(async () => ({
		id: "task-1",
		repositoryId: "repository-1",
		title: "Task title",
	}));
	const getRepository = vi.fn(async () => state.repository);
	const getCommitRecord = vi.fn(async () =>
		state.commitRecordQueue.length
			? state.commitRecordQueue.shift()
			: state.commitRecord,
	);
	const updateCommitRecord = vi.fn(async (_runId, update) => {
		state.commitRecord = { ...(state.commitRecord ?? {}), ...update };
		return state.commitRecord;
	});
	const createRunEvent = vi.fn(async () => undefined);
	const updateTask = vi.fn(async () => undefined);
	const getReviewSession = vi.fn(async () => state.reviewSession);
	const listArtifacts = vi.fn(async () => state.artifacts);
	const getMergeRecord = vi.fn(async () => state.mergeRecord);
	const resolveEvidence = vi.fn(async () => state.closeoutEvidence);
	const readGitState = vi.fn(async () =>
		state.gitStateQueue.length ? state.gitStateQueue.shift() : state.gitState,
	);
	const readOwnedDiff = vi.fn(async () => "diff --git a/src/a.ts b/src/a.ts");
	const git = vi.fn(async (_root, args) =>
		args[0] === "rev-parse" ? "commit-sha" : "src/a.ts\n",
	);
	const pushBlocked = vi.fn(() => false);
	const resolveIntegration = vi.fn(
		(_merge, decision) =>
			state.integrationOverride ?? {
				state: decision.state,
				canPush: decision.state === "push_ready",
				blockingReason: decision.reason,
			},
	);
	const evaluateAdmission = vi.fn(async () => ({ passed: true, reasons: [] }));
	const admitCloseout = vi.fn(async () => ({
		status: "admitted",
		id: "admission-1",
	}));
	const consumeAdmission = vi.fn(async () => ({ status: "consumed" }));
	const closeoutLock = vi.fn(async (_id, callback) => callback());
	const mutationLock = vi.fn(async (_id, _kind, callback) => callback());
	const completeQueue = vi.fn(async () => undefined);
	const mergeCommitted = vi.fn(async () => undefined);
	const pushMerged = vi.fn(async () => undefined);
	const getTaskWorkspace = vi.fn(async () => state.taskWorkspace);
	const execFileAsync = vi.fn(async () => ({ stdout: "", stderr: "" }));
	const structuredCall = vi.fn(async () => ({
		value: { message: "generated commit" },
	}));

	return {
		StructuredError,
		state,
		getTaskRun,
		getTask,
		getRepository,
		getCommitRecord,
		updateCommitRecord,
		createRunEvent,
		updateTask,
		getReviewSession,
		listArtifacts,
		getMergeRecord,
		resolveEvidence,
		readGitState,
		readOwnedDiff,
		git,
		pushBlocked,
		resolveIntegration,
		evaluateAdmission,
		admitCloseout,
		consumeAdmission,
		closeoutLock,
		mutationLock,
		completeQueue,
		mergeCommitted,
		pushMerged,
		getTaskWorkspace,
		execFileAsync,
		structuredCall,
	};
});

vi.mock("node:child_process", () => ({ execFile: vi.fn() }));
vi.mock("node:util", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:util")>();
	return { ...actual, promisify: vi.fn(() => mocks.execFileAsync) };
});
vi.mock(
	"../api/services/structured-generation/structured-output-repair.service",
	() => ({ callStructuredOutputWithRepair: mocks.structuredCall }),
);
vi.mock("../api/services/structured-llm", () => ({
	createStructuredOutputContract: vi.fn((value) => value),
}));
vi.mock("../api/services/structured-llm/contract", () => ({
	StructuredLlmResponseError: mocks.StructuredError,
}));
vi.mock("../api/systemContexts/catalog", () => ({
	p: vi.fn(() => "system prompt"),
}));
vi.mock("../api/modules/gitCloseout/closeout-admission.service", () => ({
	admitCloseout: mocks.admitCloseout,
	consumeCloseoutAdmission: mocks.consumeAdmission,
	evaluateCloseoutAdmission: mocks.evaluateAdmission,
}));
vi.mock("../api/modules/gitworktree/repository-git-mutation-lock", () => ({
	withRepositoryGitMutationLock: mocks.mutationLock,
}));
vi.mock("../api/modules/queue/queue.repository", () => ({
	completeImplementationQueueEntryForRunId: mocks.completeQueue,
}));
vi.mock("../api/modules/review/review-closeout-evidence.service", () => ({
	resolveReviewCloseoutEvidence: mocks.resolveEvidence,
}));
vi.mock("../api/modules/review/review-mode.repository", () => ({
	getReviewSessionByRun: mocks.getReviewSession,
	listReviewArtifacts: mocks.listArtifacts,
}));
vi.mock("../api/modules/nightworkers/git-closeout-support", () => ({
	blocking: vi.fn((code, reason, state = "blocked") => ({
		code,
		reason,
		state,
	})),
	defaultCommitMessage: vi.fn(
		(input) =>
			input.message?.trim() || `Complete ${input.taskTitle || input.runId}`,
	),
	exclusions: vi.fn((value) =>
		Array.isArray(value)
			? value.filter((item) => typeof item === "string")
			: [],
	),
	git: mocks.git,
	list: vi.fn((value) =>
		Array.isArray(value)
			? value.filter((item) => typeof item === "string")
			: [],
	),
	normalizePushStatus: vi.fn((record) => record.pushStatus ?? "not_pushed"),
	pushBlockedByPolicy: mocks.pushBlocked,
	readGitState: mocks.readGitState,
	readOwnedDiff: mocks.readOwnedDiff,
	resolveGitIntegrationCloseout: mocks.resolveIntegration,
	withRepositoryCloseoutLock: mocks.closeoutLock,
}));
vi.mock(
	"../api/modules/nightworkers/nightworkers.git-merge.repository",
	() => ({
		getTaskRunMergeRecord: mocks.getMergeRecord,
	}),
);
vi.mock("../api/modules/nightworkers/nightworkers.git-merge.service", () => ({
	createMergeRecordForCommittedRun: mocks.mergeCommitted,
}));
vi.mock(
	"../api/modules/nightworkers/nightworkers.git-target-push.service",
	() => ({
		pushMergedTaskRunTarget: mocks.pushMerged,
	}),
);
vi.mock("../api/modules/nightworkers/nightworkers.repository", () => ({
	getTaskRun: mocks.getTaskRun,
	getTask: mocks.getTask,
	getRepository: mocks.getRepository,
	getTaskRunCommitRecord: mocks.getCommitRecord,
	updateTaskRunCommitRecord: mocks.updateCommitRecord,
	createRunEvent: mocks.createRunEvent,
	updateTask: mocks.updateTask,
}));
vi.mock("../api/modules/gitworktree/task-git-workspace.repository", () => ({
	getTaskGitWorkspace: mocks.getTaskWorkspace,
}));

beforeEach(() => {
	vi.clearAllMocks();
	mocks.state.run = run();
	mocks.state.repository = repository();
	mocks.state.commitRecord = readyCommitRecord();
	mocks.state.commitRecordQueue = [];
	mocks.state.mergeRecord = null;
	mocks.state.reviewSession = null;
	mocks.state.artifacts = [];
	mocks.state.closeoutEvidence = null;
	mocks.state.gitState = gitState();
	mocks.state.gitStateQueue = [];
	mocks.state.integrationOverride = null;
	mocks.state.taskWorkspace = null;
	mocks.getTaskRun.mockImplementation(async () => mocks.state.run);
	mocks.getRepository.mockImplementation(async () => mocks.state.repository);
	mocks.getCommitRecord.mockImplementation(async () =>
		mocks.state.commitRecordQueue.length
			? mocks.state.commitRecordQueue.shift()
			: mocks.state.commitRecord,
	);
	mocks.updateCommitRecord.mockImplementation(async (_runId, update) => {
		mocks.state.commitRecord = {
			...(mocks.state.commitRecord ?? {}),
			...update,
		};
		return mocks.state.commitRecord;
	});
	mocks.getReviewSession.mockImplementation(
		async () => mocks.state.reviewSession,
	);
	mocks.listArtifacts.mockImplementation(async () => mocks.state.artifacts);
	mocks.getMergeRecord.mockImplementation(async () => mocks.state.mergeRecord);
	mocks.resolveEvidence.mockImplementation(
		async () => mocks.state.closeoutEvidence,
	);
	mocks.readGitState.mockImplementation(async () =>
		mocks.state.gitStateQueue.length
			? mocks.state.gitStateQueue.shift()
			: mocks.state.gitState,
	);
	mocks.resolveIntegration.mockImplementation(
		(_merge, decision) =>
			mocks.state.integrationOverride ?? {
				state: decision.state,
				canPush: decision.state === "push_ready",
				blockingReason: decision.reason,
			},
	);
	mocks.evaluateAdmission.mockResolvedValue({ passed: true, reasons: [] });
	mocks.admitCloseout.mockResolvedValue({
		status: "admitted",
		id: "admission-1",
	});
	mocks.consumeAdmission.mockResolvedValue({ status: "consumed" });
	mocks.pushBlocked.mockReturnValue(false);
	mocks.git.mockImplementation(async (_root, args) =>
		args[0] === "rev-parse" ? "commit-sha" : "src/a.ts\n",
	);
	mocks.execFileAsync.mockResolvedValue({ stdout: "", stderr: "" });
	mocks.structuredCall.mockResolvedValue({
		value: { message: "generated commit" },
	});
	mocks.getTaskWorkspace.mockImplementation(
		async () => mocks.state.taskWorkspace,
	);
	mocks.createRunEvent.mockResolvedValue(undefined);
	mocks.completeQueue.mockResolvedValue(undefined);
	mocks.mergeCommitted.mockResolvedValue(undefined);
	mocks.pushMerged.mockResolvedValue(undefined);
});

describe("closeout context and commit decision", () => {
	it("rejects a missing run", async () => {
		mocks.state.run = null;
		await expect(getRunGitCloseout("missing")).rejects.toMatchObject({
			statusCode: 404,
			message: "Run not found",
		});
	});

	it("resolves repository id from the task and rejects missing repository identity", async () => {
		mocks.state.run = run({ repositoryId: null });
		mocks.getTask.mockResolvedValueOnce({ repositoryId: null });
		await expect(getRunGitCloseout("run-1")).rejects.toMatchObject({
			statusCode: 404,
			message: "Repository not found",
		});

		mocks.getTask.mockResolvedValueOnce({ repositoryId: "repository-1" });
		mocks.state.repository = { id: "repository-1", localPath: "" };
		await expect(getRunGitCloseout("run-1")).rejects.toMatchObject({
			statusCode: 404,
		});
	});

	it("uses run worktree, newest review artifact, and complete review evidence", async () => {
		mocks.state.run = run({
			worktreePath: "/worktree",
			finishedAt: null,
			endedAt: null,
		});
		mocks.state.reviewSession = { id: "review-1" };
		mocks.state.artifacts = [
			{ kind: "test_coverage", status: "done", updatedAt: "2026-01-01" },
			{ kind: "review_run", status: "running", updatedAt: "2026-01-01" },
			{ kind: "review_run", status: "done", updatedAt: "2026-02-01" },
		];
		mocks.state.closeoutEvidence = completeEvidence();
		const result = await getRunGitCloseout("run-1");
		expect(mocks.readGitState).toHaveBeenCalledWith("/worktree");
		expect(mocks.resolveEvidence).toHaveBeenCalledWith(
			expect.objectContaining({
				reviewSessionId: "review-1",
				implementationFinishedAt: expect.any(String),
			}),
		);
		expect(result.requiredReview).toEqual({
			reviewSessionId: "review-1",
			testCoverageStatus: "done",
			reviewRunStatus: "done",
			complete: true,
		});
	});

	it("uses endedAt before updatedAt for review evidence", async () => {
		const endedAt = "2026-02-02T00:00:00.000Z";
		mocks.state.run = run({ finishedAt: null, endedAt });
		mocks.state.reviewSession = { id: "review-1" };
		await getRunGitCloseout("run-1");
		expect(mocks.resolveEvidence).toHaveBeenCalledWith(
			expect.objectContaining({ implementationFinishedAt: endedAt }),
		);
	});

	it("blocks when ownership record is absent", async () => {
		mocks.state.commitRecord = null;
		const result = await getRunGitCloseout("run-1");
		expect(result).toMatchObject({
			canCommit: false,
			state: "blocked",
			blockingCode: "COMMIT_RECORD_MISSING",
			counts: { stageablePaths: 0, excludedPaths: 0 },
		});
	});

	it.each([
		[
			"head mismatch",
			committedRecord(),
			gitState({ head: "other" }),
			"PUSH_HEAD_MISMATCH",
			"needs_human",
		],
		[
			"pushed",
			committedRecord({ pushStatus: "pushed" }),
			gitState({ head: "commit-sha" }),
			null,
			"pushed",
		],
		[
			"pushing",
			committedRecord({ pushStatus: "pushing" }),
			gitState({ head: "commit-sha" }),
			null,
			"push_running",
		],
		[
			"push failed",
			committedRecord({ pushStatus: "failed", statusReason: "network" }),
			gitState({ head: "commit-sha" }),
			"GIT_COMMAND_FAILED",
			"failed",
		],
		[
			"push failed fallback",
			committedRecord({ pushStatus: "failed", statusReason: "" }),
			gitState({ head: "commit-sha" }),
			"GIT_COMMAND_FAILED",
			"failed",
		],
		[
			"policy blocked",
			committedRecord({ pushStatus: "blocked", statusReason: "policy" }),
			gitState({ head: "commit-sha" }),
			"PUSH_POLICY_BLOCKED",
			"committed",
		],
		[
			"policy fallback",
			committedRecord({ pushStatus: "blocked", statusReason: "" }),
			gitState({ head: "commit-sha" }),
			"PUSH_POLICY_BLOCKED",
			"committed",
		],
		[
			"missing upstream",
			committedRecord(),
			gitState({ head: "commit-sha", upstream: null }),
			"UPSTREAM_MISSING",
			"committed",
		],
		[
			"push ready",
			committedRecord(),
			gitState({ head: "commit-sha" }),
			null,
			"push_ready",
		],
	] as const)("maps committed record state: %s", async (_name, record, state, code, expectedState) => {
		mocks.state.commitRecord = record;
		mocks.state.gitState = state;
		const result = await getRunGitCloseout("run-1");
		expect(result.blockingCode).toBe(code);
		expect(result.state).toBe(expectedState);
	});

	it.each([
		[
			"failed reason",
			readyCommitRecord({ status: "failed", statusReason: "git failed" }),
			"GIT_COMMAND_FAILED",
		],
		[
			"failed fallback",
			readyCommitRecord({ status: "failed", statusReason: "" }),
			"GIT_COMMAND_FAILED",
		],
		[
			"pending reason",
			readyCommitRecord({ status: "pending", statusReason: "waiting" }),
			"COMMIT_RECORD_NOT_READY",
		],
		[
			"pending fallback",
			readyCommitRecord({ status: "pending", statusReason: "" }),
			"COMMIT_RECORD_NOT_READY",
		],
		[
			"no paths",
			readyCommitRecord({ stageableOwnedPathsJson: [] }),
			"NO_STAGEABLE_PATHS",
		],
		[
			"head moved",
			readyCommitRecord({ baselineHead: "baseline" }),
			"HEAD_MOVED",
		],
		["staged paths", readyCommitRecord(), "STAGED_PATHS_OUTSIDE_OWNERSHIP"],
		[
			"pre-existing dirty",
			readyCommitRecord({ preExistingDirtyPathsJson: ["old.ts"] }),
			"PRE_EXISTING_DIRTY_PATHS",
		],
		[
			"missing dirty",
			readyCommitRecord({ stageableOwnedPathsJson: ["missing.ts"] }),
			"DIRTY_PATHS_MISSING",
		],
	] as const)("blocks ready record boundary: %s", async (_name, record, code) => {
		mocks.state.commitRecord = record;
		if (_name === "head moved")
			mocks.state.gitState = gitState({ head: "other" });
		if (_name === "staged paths")
			mocks.state.gitState = gitState({ stagedPaths: ["other.ts"] });
		if (_name === "pre-existing dirty") {
			mocks.state.gitState = gitState({ dirtyPaths: ["src/a.ts", "old.ts"] });
		}
		const result = await getRunGitCloseout("run-1");
		expect(result).toMatchObject({ canCommit: false, blockingCode: code });
	});

	it("returns commit-ready counts and optional review defaults", async () => {
		mocks.state.commitRecord = readyCommitRecord({
			stageableOwnedPathsJson: ["src/a.ts", 7],
			excludedPathsJson: ["ignored.ts", null],
		});
		const result = await getRunGitCloseout("run-1");
		expect(result).toMatchObject({
			canCommit: true,
			state: "commit_ready",
			requiredReview: {
				reviewSessionId: null,
				testCoverageStatus: null,
				reviewRunStatus: null,
				complete: false,
			},
			counts: { stageablePaths: 1, excludedPaths: 1 },
		});
	});

	it("turns stale closeout evidence into review_required", async () => {
		mocks.evaluateAdmission.mockResolvedValueOnce({
			passed: false,
			reasons: ["review missing", "verification stale"],
		});
		const result = await getRunGitCloseout("run-1");
		expect(result).toMatchObject({
			canCommit: false,
			state: "review_required",
			blockingCode: "CLOSEOUT_EVIDENCE_STALE",
			blockingReason: expect.stringContaining(
				"review missing, verification stale",
			),
			nextAction: expect.stringContaining(
				"Current revision evidence is incomplete",
			),
		});
	});

	it.each([
		["review", completeEvidence({ review: { status: "running" } })],
		["verification", completeEvidence({ verification: { status: "failed" } })],
		["security", completeEvidence({ security: { status: "failed" } })],
		[
			"findings",
			completeEvidence({ findings: { unresolvedBlockingIds: ["finding-1"] } }),
		],
	] as const)("marks required review incomplete for %s boundary", async (_name, evidence) => {
		mocks.state.reviewSession = { id: "review-1" };
		mocks.state.closeoutEvidence = evidence;
		const result = await getRunGitCloseout("run-1");
		expect(result.requiredReview.complete).toBe(false);
	});
});

describe("commit closeout", () => {
	it.each([
		[
			"unsafe head",
			readyCommitRecord({ baselineHead: "baseline" }),
			gitState({ head: "other" }),
			true,
		],
		["missing record", null, gitState(), false],
	] as const)("returns blocked state and conditionally marks unsafe: %s", async (_name, record, state, marked) => {
		mocks.state.commitRecord = record;
		mocks.state.gitState = state;
		await commitRunGitCloseout("run-1");
		expect(mocks.updateCommitRecord.mock.calls.length > 0).toBe(marked);
		if (marked) {
			expect(mocks.updateCommitRecord).toHaveBeenCalledWith(
				"run-1",
				expect.objectContaining({ status: "needs_human" }),
			);
		}
	});

	it("rejects a consumed closeout admission", async () => {
		mocks.admitCloseout.mockResolvedValueOnce({
			status: "consumed",
			id: "admission-1",
		});
		await expect(commitRunGitCloseout("run-1")).rejects.toMatchObject({
			statusCode: 409,
			code: "closeout_admission_consumed",
		});
	});

	it("rejects a missing locked commit record after admission", async () => {
		mocks.state.commitRecordQueue = [
			readyCommitRecord(),
			null,
			readyCommitRecord(),
		];
		await expect(commitRunGitCloseout("run-1")).rejects.toMatchObject({
			statusCode: 409,
			code: "COMMIT_RECORD_MISSING",
		});
	});

	it("uses an explicit normalized commit message without provider access", async () => {
		await commitRunGitCloseout("run-1", { message: "  explicit subject  " });
		expect(mocks.readOwnedDiff).not.toHaveBeenCalled();
		expect(mocks.structuredCall).not.toHaveBeenCalled();
		expect(mocks.execFileAsync).toHaveBeenCalledWith(
			"git",
			["commit", "-m", "explicit subject"],
			expect.any(Object),
		);
	});

	it("generates a commit message from owned diff and prompt fallbacks", async () => {
		mocks.getTask.mockResolvedValueOnce({ id: "task-1", title: null });
		mocks.state.run = run({ summary: null, finalReport: null });
		mocks.readOwnedDiff.mockResolvedValueOnce("");
		await commitRunGitCloseout("run-1");
		expect(mocks.structuredCall).toHaveBeenCalledWith(
			expect.objectContaining({
				userPrompt: expect.stringContaining("Task title: (none)"),
				options: expect.objectContaining({
					role: "review",
					workingDirectory: "/repo",
					timeoutMs: 30_000,
				}),
			}),
		);
	});

	it("falls back from ordinary commit-message provider errors", async () => {
		mocks.structuredCall.mockRejectedValueOnce(new Error("provider offline"));
		await commitRunGitCloseout("run-1");
		expect(mocks.execFileAsync).toHaveBeenCalledWith(
			"git",
			["commit", "-m", "Complete Task title"],
			expect.any(Object),
		);
	});

	it("propagates structured response errors before git mutation", async () => {
		mocks.structuredCall.mockRejectedValueOnce(
			new mocks.StructuredError("invalid response"),
		);
		await expect(commitRunGitCloseout("run-1")).rejects.toThrow(
			"invalid response",
		);
		expect(mocks.execFileAsync).not.toHaveBeenCalled();
	});

	it("detects staged paths that appear after git add", async () => {
		mocks.git.mockResolvedValueOnce("src/a.ts\noutside.ts\n");
		const result = await commitRunGitCloseout("run-1");
		expect(mocks.updateCommitRecord).toHaveBeenCalledWith("run-1", {
			status: "needs_human",
			statusReason: "Staged paths include files outside run ownership.",
		});
		expect(result.canCommit).toBe(false);
	});

	it("rechecks staged paths from the locked context", async () => {
		mocks.state.gitStateQueue = [
			gitState(),
			gitState({ stagedPaths: ["foreign.ts"] }),
			gitState(),
		];
		await commitRunGitCloseout("run-1");
		expect(mocks.updateCommitRecord).toHaveBeenCalledWith("run-1", {
			status: "needs_human",
			statusReason: "The repository already has staged paths.",
		});
		expect(mocks.execFileAsync).not.toHaveBeenCalled();
	});

	it("commits, consumes admission, and completes a base-worktree queue entry", async () => {
		mocks.updateCommitRecord.mockImplementation(async (_runId, update) => {
			mocks.state.commitRecord = {
				...(mocks.state.commitRecord ?? {}),
				...update,
			};
			if (update.status === "committed") {
				mocks.state.gitState = gitState({
					head: update.commitSha,
					dirtyPaths: [],
				});
			}
			return mocks.state.commitRecord;
		});
		const result = await commitRunGitCloseout("run-1");
		expect(mocks.updateCommitRecord).toHaveBeenCalledWith(
			"run-1",
			expect.objectContaining({
				status: "committed",
				commitSha: "commit-sha",
				pushStatus: "not_pushed",
			}),
		);
		expect(mocks.consumeAdmission).toHaveBeenCalledWith("admission-1");
		expect(mocks.completeQueue).toHaveBeenCalledWith({
			runId: "run-1",
			runStatus: "completed",
		});
		expect(mocks.mergeCommitted).not.toHaveBeenCalled();
		expect(result.state).toBe("push_ready");
	});

	it("creates merge ownership and needs-review state for a task worktree", async () => {
		mocks.state.taskWorkspace = { id: "workspace-1" };
		await commitRunGitCloseout("run-1");
		expect(mocks.mergeCommitted).toHaveBeenCalledWith("run-1");
		expect(mocks.updateTask).toHaveBeenCalledWith("task-1", {
			status: "needs_review",
		});
	});

	it("records a pre-commit git failure and returns failed state", async () => {
		mocks.execFileAsync.mockRejectedValueOnce(new Error("git add failed"));
		const result = await commitRunGitCloseout("run-1");
		expect(mocks.updateCommitRecord).toHaveBeenCalledWith("run-1", {
			status: "failed",
			statusReason: "git add failed",
		});
		expect(mocks.createRunEvent).toHaveBeenCalledWith(
			expect.objectContaining({ type: "git.closeout_commit_failed" }),
		);
		expect(result.state).toBe("failed");
	});

	it("rethrows failures after the committed record is persisted", async () => {
		mocks.consumeAdmission.mockRejectedValueOnce(
			new Error("admission consume failed"),
		);
		await expect(commitRunGitCloseout("run-1")).rejects.toThrow(
			"admission consume failed",
		);
		expect(mocks.createRunEvent).not.toHaveBeenCalledWith(
			expect.objectContaining({ type: "git.closeout_commit_failed" }),
		);
	});
});

describe("push closeout", () => {
	it("returns immediately when integration is not pushable", async () => {
		mocks.state.commitRecord = readyCommitRecord({ status: "failed" });
		const result = await pushRunGitCloseout("run-1");
		expect(result.canPush).toBe(false);
		expect(mocks.execFileAsync).not.toHaveBeenCalled();
	});

	it("delegates merged worktree pushes to the target push service", async () => {
		mocks.state.commitRecord = committedRecord();
		mocks.state.gitState = gitState({ head: "commit-sha" });
		mocks.state.mergeRecord = { status: "merged" };
		await pushRunGitCloseout("run-1");
		expect(mocks.pushMerged).toHaveBeenCalledWith("run-1");
		expect(mocks.execFileAsync).not.toHaveBeenCalled();
	});

	it("blocks push through repository safety policy", async () => {
		mocks.state.commitRecord = committedRecord();
		mocks.state.gitState = gitState({ head: "commit-sha" });
		mocks.pushBlocked.mockReturnValueOnce(true);
		const result = await pushRunGitCloseout("run-1");
		expect(mocks.updateCommitRecord).toHaveBeenCalledWith("run-1", {
			pushStatus: "blocked",
			statusReason: "Repository safety policy blocks git push.",
		});
		expect(result.state).toBe("committed");
	});

	it("returns the current state if upstream disappears after admission", async () => {
		mocks.state.commitRecord = committedRecord();
		mocks.state.gitStateQueue = [
			gitState({ head: "commit-sha" }),
			gitState({ head: "commit-sha", upstream: null }),
			gitState({ head: "commit-sha" }),
		];
		mocks.state.integrationOverride = {
			canPush: true,
			state: "push_ready",
			blockingReason: null,
		};
		const result = await pushRunGitCloseout("run-1");
		expect(result.state).toBe("push_ready");
		expect(mocks.execFileAsync).not.toHaveBeenCalled();
	});

	it.each([
		["remote branch", "origin/main", "origin", "main"],
		["local upstream", "main", null, "main"],
	] as const)("pushes %s and records remote/branch", async (_name, upstream, pushRemote, pushBranch) => {
		mocks.state.commitRecord = committedRecord();
		mocks.state.gitState = gitState({ head: "commit-sha", upstream });
		const result = await pushRunGitCloseout("run-1");
		expect(mocks.execFileAsync).toHaveBeenCalledWith("git", ["push"], {
			cwd: "/repo",
			maxBuffer: 1024 * 1024 * 8,
		});
		expect(mocks.updateCommitRecord).toHaveBeenCalledWith(
			"run-1",
			expect.objectContaining({
				pushStatus: "pushed",
				pushRemote,
				pushBranch,
			}),
		);
		expect(result.state).toBe("pushed");
	});

	it("records push failures and returns failed state", async () => {
		mocks.state.commitRecord = committedRecord();
		mocks.state.gitState = gitState({ head: "commit-sha" });
		mocks.execFileAsync.mockRejectedValueOnce(new Error("remote rejected"));
		const result = await pushRunGitCloseout("run-1");
		expect(mocks.updateCommitRecord).toHaveBeenCalledWith("run-1", {
			pushStatus: "failed",
			statusReason: "remote rejected",
		});
		expect(mocks.createRunEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "git.closeout_push_failed",
				data: { error: "remote rejected", upstream: "origin/main" },
			}),
		);
		expect(result.state).toBe("failed");
	});
});

function run(overrides: Record<string, unknown> = {}) {
	return {
		id: "run-1",
		taskId: "task-1",
		repositoryId: "repository-1",
		worktreePath: null,
		summary: "Run summary",
		finalReport: "Final report",
		finishedAt: "2026-03-01T00:00:00.000Z",
		endedAt: "2026-02-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		...overrides,
	};
}

function repository(overrides: Record<string, unknown> = {}) {
	return {
		id: "repository-1",
		localPath: "/repo",
		safetyPolicy: null,
		...overrides,
	};
}

function readyCommitRecord(overrides: Record<string, unknown> = {}) {
	return {
		runId: "run-1",
		status: "ready",
		statusReason: null,
		baselineHead: "baseline-sha",
		stageableOwnedPathsJson: ["src/a.ts"],
		excludedPathsJson: [],
		preExistingDirtyPathsJson: [],
		commitSha: null,
		pushStatus: "not_pushed",
		...overrides,
	};
}

function committedRecord(overrides: Record<string, unknown> = {}) {
	return readyCommitRecord({
		status: "committed",
		commitSha: "commit-sha",
		pushStatus: "not_pushed",
		...overrides,
	});
}

function gitState(overrides: Record<string, unknown> = {}) {
	return {
		head: "baseline-sha",
		upstream: "origin/main",
		dirtyPaths: ["src/a.ts"],
		stagedPaths: [],
		...overrides,
	};
}

function completeEvidence(overrides: Record<string, unknown> = {}) {
	return {
		review: { status: "done" },
		verification: { status: "passed" },
		security: { status: "skipped" },
		findings: { unresolvedBlockingIds: [] },
		...overrides,
	};
}
