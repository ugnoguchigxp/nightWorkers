import { execFile } from "node:child_process";
import crypto from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import app from "../api/app";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import {
	verificationChecklistItems,
	verificationDocuments,
	verificationEvidenceRuns,
} from "../api/db/verification-schema";
import * as repo from "../api/modules/nightworkers/nightworkers.repository";
import * as queueRepo from "../api/modules/queue/queue.repository";
import { reviewArtifacts } from "../api/modules/review/persistence/review-mode-schema";
import * as reviewRepo from "../api/modules/review/review-mode.repository";
import * as structuredLlm from "../api/services/structured-llm";

vi.mock("../api/services/structured-llm", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../api/services/structured-llm")>();
	const { createStructuredLlmResultMock } = await import(
		"./helpers/structured-llm-result-mock"
	);
	const callStructuredJsonLLM = vi.fn();
	return {
		...actual,
		callStructuredJsonLLM,
		callStructuredLlmResult: vi.fn(
			createStructuredLlmResultMock(callStructuredJsonLLM),
		),
	};
});

const closeoutAdmissionMocks = vi.hoisted(() => ({
	admitCloseout: vi.fn(async () => ({
		id: "test-closeout-admission",
		status: "admitted",
	})),
	consumeCloseoutAdmission: vi.fn(async () => ({ status: "consumed" })),
	evaluateCloseoutAdmission: vi.fn(async () => ({
		passed: true,
		reasons: [],
	})),
}));

vi.mock(
	"../api/modules/gitCloseout/closeout-admission.service",
	() => closeoutAdmissionMocks,
);

const execFileAsync = promisify(execFile);
const sameOriginHeaders = { Origin: "http://localhost:39174" };
const tempRoots: string[] = [];

beforeAll(async () => {
	await ensureNightWorkersSchema();
});

beforeEach(() => {
	closeoutAdmissionMocks.admitCloseout.mockClear();
	closeoutAdmissionMocks.consumeCloseoutAdmission.mockClear();
	closeoutAdmissionMocks.evaluateCloseoutAdmission.mockClear();
	vi.mocked(structuredLlm.callStructuredJsonLLM).mockReset();
	vi.mocked(structuredLlm.callStructuredJsonLLM).mockResolvedValue(
		JSON.stringify({ message: "Update owned closeout file" }),
	);
});

afterEach(async () => {
	await Promise.all(
		tempRoots
			.splice(0)
			.map((root) => rm(root, { recursive: true, force: true })),
	);
});

async function git(repoRoot: string, args: string[]) {
	const result = await execFileAsync("git", args, { cwd: repoRoot });
	return result.stdout.trim();
}

async function createGitRepo(
	input: { withRemote?: boolean; withWorktree?: boolean } = {},
) {
	const root = await mkdtemp(path.join(tmpdir(), "nightworkers-closeout-"));
	tempRoots.push(root);
	await git(root, ["init"]);
	await git(root, ["checkout", "-b", "main"]);
	await git(root, ["config", "user.name", "NightWorkers Test"]);
	await git(root, ["config", "user.email", "nightworkers-test@example.com"]);
	await writeFile(path.join(root, "owned.txt"), "before\n");
	await writeFile(path.join(root, "unowned.txt"), "before\n");
	await git(root, ["add", "owned.txt", "unowned.txt"]);
	await git(root, ["commit", "-m", "initial"]);
	let executionRoot = root;
	if (input.withWorktree) {
		executionRoot = await mkdtemp(
			path.join(tmpdir(), "nightworkers-closeout-worktree-"),
		);
		await rm(executionRoot, { recursive: true, force: true });
		tempRoots.push(executionRoot);
		await git(root, [
			"worktree",
			"add",
			"-b",
			`closeout-${crypto.randomUUID()}`,
			executionRoot,
		]);
	}
	let remoteRoot: string | null = null;
	if (input.withRemote) {
		remoteRoot = await mkdtemp(
			path.join(tmpdir(), "nightworkers-closeout-remote-"),
		);
		tempRoots.push(remoteRoot);
		await git(remoteRoot, ["init", "--bare"]);
		await git(root, ["remote", "add", "origin", remoteRoot]);
		await git(root, ["push", "-u", "origin", "main"]);
	}
	const baselineHead = await git(executionRoot, ["rev-parse", "HEAD"]);
	await writeFile(path.join(executionRoot, "owned.txt"), "after\n");
	return {
		root: executionRoot,
		repositoryRoot: root,
		baselineHead,
		remoteRoot,
	};
}

async function createCloseoutFixture(
	input: {
		withRemote?: boolean;
		withWorktree?: boolean;
		safetyPolicy?: unknown;
		withTestCoverage?: boolean;
		withReviewRun?: boolean;
		reviewRunStatus?: "running" | "done" | "failed" | "needs_human";
		withSecurityEvidence?: boolean;
		withBlockingFinding?: boolean;
		withManagedVerificationEvidence?: boolean;
		managedCompletionOk?: boolean;
		managedEvidenceRunMode?: "test" | "implementation";
		withReviewCompletionEvent?: boolean;
		withHistoricalFailedEvidence?: boolean;
		reviewFixesApplied?: boolean;
	} = {},
) {
	const gitRepo = await createGitRepo({
		withRemote: input.withRemote,
		withWorktree: input.withWorktree,
	});
	const project = await repo.createRepository({
		name: `TEST: Git Closeout ${crypto.randomUUID()}`,
		localPath: gitRepo.repositoryRoot,
		branch: "main",
		safetyPolicy: input.safetyPolicy,
	});
	const task = await repo.createTask({
		repositoryId: project.id,
		title: "Git closeout task",
		objective: "Commit owned paths",
		acceptanceCriteria: "Owned path is committed",
		status: "completed",
	});
	const run = await repo.createTaskRun({
		taskId: task.id,
		repositoryId: project.id,
		status: "needs_review",
		workerKind: "native-local",
		worktreePath: input.withWorktree ? gitRepo.root : null,
		summary: "Implementation done",
		finalReport: "Implementation done",
		startedAt: new Date(),
		endedAt: new Date(),
		finishedAt: new Date(),
	});
	await repo.createTaskRunCommitRecord({
		runId: run.id,
		repositoryId: project.id,
		status: "ready",
		baselineHead: gitRepo.baselineHead,
		preExistingDirtyPaths: [],
		ownedCandidatePaths: ["owned.txt"],
		stageableOwnedPaths: ["owned.txt"],
		excludedPaths: [],
		verificationStatus: "passed",
	});
	const recommendation = await reviewRepo.upsertReviewRecommendation({
		runId: run.id,
		taskId: task.id,
		repositoryId: project.id,
		level: "required",
		defaultAction: "require_review",
		reasonsJson: [],
	});
	const session = await reviewRepo.createOrStartReviewSession({
		runId: run.id,
		taskId: task.id,
		repositoryId: project.id,
		recommendationId: recommendation.id,
	});
	if (input.withManagedVerificationEvidence) {
		const testStartedAt = new Date(Date.now() + 1_000);
		const testRun = await repo.createTaskRun({
			taskId: task.id,
			repositoryId: project.id,
			status: "completed",
			workerKind: "native-local",
			contextSnapshot: { executionMode: "implementation" },
			summary: "Implementation verification completed",
			finalReport: "Managed implementation evidence completed.",
			startedAt: testStartedAt,
			endedAt: testStartedAt,
			finishedAt: testStartedAt,
		});
		const [document] = await db
			.insert(verificationDocuments)
			.values({
				taskId: task.id,
				runId: run.id,
				sourceSpecPath: "spec/docs/test.html",
				status: "active",
				documentJson: {},
				generatedAt: testStartedAt,
			})
			.returning();
		if (!document) throw new Error("Verification document was not created");
		const [evidence] = await db
			.insert(verificationEvidenceRuns)
			.values({
				taskId: task.id,
				runId:
					input.managedEvidenceRunMode === "implementation"
						? run.id
						: testRun.id,
				verificationDocumentId: document.id,
				checkKind: "unit",
				command: "bun run test",
				cwd: gitRepo.root,
				exitCode: 0,
				runner: "nightworkers",
				rawStdoutArtifactId: crypto.randomUUID(),
				rawStderrArtifactId: crypto.randomUUID(),
				summaryJson: {},
				commandLevelConditionIdsJson: ["condition-1"],
				startedAt: testStartedAt,
				finishedAt: testStartedAt,
			})
			.returning();
		if (!evidence) throw new Error("Verification evidence was not created");
		const [historicalEvidence] = input.withHistoricalFailedEvidence
			? await db
					.insert(verificationEvidenceRuns)
					.values({
						taskId: task.id,
						runId: testRun.id,
						verificationDocumentId: document.id,
						checkKind: "unit",
						command: "bun run test",
						cwd: gitRepo.root,
						exitCode: 1,
						runner: "nightworkers",
						rawStdoutArtifactId: crypto.randomUUID(),
						rawStderrArtifactId: crypto.randomUUID(),
						summaryJson: {},
						commandLevelConditionIdsJson: ["condition-1"],
						startedAt: new Date(testStartedAt.getTime() - 100),
						finishedAt: new Date(testStartedAt.getTime() - 100),
					})
					.returning()
			: [];
		await db.insert(verificationChecklistItems).values({
			verificationDocumentId: document.id,
			taskId: task.id,
			conditionId: "condition-1",
			text: "Unit tests pass",
			required: true,
			status: "passed",
			evidenceIdsJson: [
				...(historicalEvidence ? [historicalEvidence.id] : []),
				evidence.id,
			],
		});
		await repo.createRunEvent({
			version: 1,
			runId:
				input.managedEvidenceRunMode === "implementation" ? run.id : testRun.id,
			taskId: task.id,
			timestamp: testStartedAt.toISOString(),
			type: "tool.call_finished",
			severity: "info",
			actor: "tool",
			message: "completion_check finished",
			data: {
				mcpTool: "completion_check",
				ok: input.managedCompletionOk !== false,
				status: "completed",
				result: {
					ok: input.managedCompletionOk !== false,
					verificationDocumentId: document.id,
				},
			},
		});
	}
	if (input.withTestCoverage !== false) {
		await reviewRepo.upsertReviewArtifact({
			reviewSessionId: session.id,
			runId: run.id,
			taskId: task.id,
			kind: "test_coverage",
			status: "done",
			artifactJson: {
				version: 2,
				kind: "test_coverage",
				requirement: "required",
				summary: "Verification evidence checked.",
			},
			sourceEvidenceRefsJson: [],
		});
	}
	if (input.withReviewRun) {
		const reviewRunId = crypto.randomUUID();
		const reviewRunStatus = input.reviewRunStatus ?? "running";
		await reviewRepo.upsertReviewArtifact({
			reviewSessionId: session.id,
			runId: run.id,
			taskId: task.id,
			kind: "review_run",
			status: reviewRunStatus,
			artifactJson: {
				version: 1,
				kind: "review_run",
				status: reviewRunStatus,
				reviewRunId,
				todos: [],
				target: { targetFiles: [{ path: "owned.txt" }] },
				warnings: [],
				fixesApplied: input.reviewFixesApplied === true,
			},
			sourceEvidenceRefsJson: [],
		});
		if (input.reviewFixesApplied) {
			await db
				.update(reviewArtifacts)
				.set({ updatedAt: new Date(Date.now() + 2_000) })
				.where(eq(reviewArtifacts.reviewSessionId, session.id));
		}
		if (
			reviewRunStatus === "done" &&
			input.withReviewCompletionEvent !== false
		) {
			await repo.createRunEvent({
				version: 1,
				runId: run.id,
				taskId: task.id,
				timestamp: new Date().toISOString(),
				type: "review.run_completed",
				severity: "info",
				actor: "system",
				message: "Review Run finished with status: done.",
				data: {
					reviewSessionId: session.id,
					reviewRunId,
					reviewedRunId: run.id,
					status: "done",
				},
			});
		}
	}
	if (input.withSecurityEvidence !== false) {
		await repo.createRunEvent({
			version: 1,
			runId: run.id,
			taskId: task.id,
			timestamp: new Date().toISOString(),
			type: "system.info",
			severity: "info",
			actor: "system",
			message: "Security Oracle was skipped by policy.",
			data: {
				action: "security.oracle_gate_skipped",
				status: "skipped",
				reason: "project_policy_disabled",
			},
		});
	}
	if (input.withBlockingFinding) {
		await reviewRepo.createReviewFindings([
			{
				reviewSessionId: session.id,
				runId: run.id,
				taskId: task.id,
				severity: "blocking",
				title: "Blocking closeout finding",
				evidenceRefsJson: [],
				sourceSection: "review_run",
			},
		]);
	}
	const entry = await queueRepo.createImplementationQueueEntry({
		taskId: task.id,
		repositoryId: project.id,
	});
	await queueRepo.updateImplementationQueueEntry(entry.id, {
		status: "awaiting_commit_decision",
		activeRunId: run.id,
	});
	return { gitRepo, project, task, run, entry };
}

describe("NightWorkers Git closeout API", () => {
	it("projects stale Evidence as a commit blocker", async () => {
		const fixture = await createCloseoutFixture();
		closeoutAdmissionMocks.evaluateCloseoutAdmission.mockResolvedValueOnce({
			passed: false,
			reasons: ["source_or_diff_stale"],
		});

		const response = await app.request(
			`http://localhost/api/runs/${fixture.run.id}/git/closeout`,
			{ headers: sameOriginHeaders },
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			canCommit: false,
			state: "review_required",
			blockingCode: "CLOSEOUT_EVIDENCE_STALE",
		});
	});

	it("reports commit readiness and commits only stageable owned paths", async () => {
		const fixture = await createCloseoutFixture();

		const stateRes = await app.request(
			`http://localhost/api/runs/${fixture.run.id}/git/closeout`,
			{ headers: sameOriginHeaders },
		);
		expect(stateRes.status).toBe(200);
		const state = await stateRes.json();
		if (!state.canCommit) {
			throw new Error(
				`Expected commit-ready closeout state: ${JSON.stringify({
					state: state.state,
					blockingCode: state.blockingCode,
					blockingReason: state.blockingReason,
					git: state.git,
					requiredReview: state.requiredReview,
					commitRecord: state.commitRecord,
				})}`,
			);
		}
		expect(state).toMatchObject({
			canCommit: true,
			state: "commit_ready",
			counts: { stageablePaths: 1, excludedPaths: 0 },
		});

		const commitRes = await app.request(
			`http://localhost/api/runs/${fixture.run.id}/git/commit`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json", ...sameOriginHeaders },
				body: JSON.stringify({ message: "Commit owned closeout" }),
			},
		);
		expect(commitRes.status).toBe(200);
		const committed = await commitRes.json();
		expect(committed.state).toBe("committed");
		expect(committed.commitRecord.commitMessage).toBe("Commit owned closeout");
		expect(committed.commitRecord.commitSha).toBeTruthy();
		expect(closeoutAdmissionMocks.admitCloseout).toHaveBeenCalledWith(
			fixture.run.id,
		);
		expect(
			closeoutAdmissionMocks.consumeCloseoutAdmission,
		).toHaveBeenCalledTimes(1);

		const committedOwned = await git(fixture.gitRepo.root, [
			"show",
			"HEAD:owned.txt",
		]);
		expect(committedOwned).toBe("after");
		const unownedStatus = await git(fixture.gitRepo.root, [
			"status",
			"--porcelain",
			"--",
			"unowned.txt",
		]);
		expect(unownedStatus).toBe("");
		const entry = await queueRepo.getImplementationQueueEntry(fixture.entry.id);
		expect(entry?.status).toBe("execution_completed");
	});

	it("does not relabel a successful Git commit as failed when receipt persistence fails", async () => {
		const fixture = await createCloseoutFixture();
		closeoutAdmissionMocks.consumeCloseoutAdmission.mockRejectedValueOnce(
			new Error("receipt unavailable"),
		);

		const response = await app.request(
			`http://localhost/api/runs/${fixture.run.id}/git/commit`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json", ...sameOriginHeaders },
				body: JSON.stringify({ message: "Commit before receipt failure" }),
			},
		);
		expect(response.status).toBe(500);
		expect((await repo.getTaskRunCommitRecord(fixture.run.id))?.status).toBe(
			"committed",
		);
	});

	it("commits in the run worktree without moving the registered repository HEAD", async () => {
		const fixture = await createCloseoutFixture({ withWorktree: true });
		const registeredHeadBefore = await git(fixture.gitRepo.repositoryRoot, [
			"rev-parse",
			"HEAD",
		]);

		const commitRes = await app.request(
			`http://localhost/api/runs/${fixture.run.id}/git/commit`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json", ...sameOriginHeaders },
				body: JSON.stringify({ message: "Commit from task worktree" }),
			},
		);
		expect(commitRes.status).toBe(200);
		const committed = await commitRes.json();
		expect(committed.state).toBe("committed");
		expect(await git(fixture.gitRepo.root, ["rev-parse", "HEAD"])).toBe(
			committed.commitRecord.commitSha,
		);
		expect(
			await git(fixture.gitRepo.repositoryRoot, ["rev-parse", "HEAD"]),
		).toBe(registeredHeadBefore);
	});

	it("serializes duplicate commit requests for the same repository", async () => {
		const fixture = await createCloseoutFixture();

		const responses = await Promise.all(
			[1, 2].map((index) =>
				app.request(`http://localhost/api/runs/${fixture.run.id}/git/commit`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						...sameOriginHeaders,
					},
					body: JSON.stringify({ message: `Concurrent closeout ${index}` }),
				}),
			),
		);
		expect(responses.map((response) => response.status)).toEqual([200, 200]);
		const states = await Promise.all(
			responses.map((response) => response.json()),
		);
		expect(states.every((state) => state.state === "committed")).toBe(true);
		const events = await repo.listTaskEventsForRun(fixture.run.id);
		expect(
			events.filter((event) => event.eventType === "git_closeout"),
		).toHaveLength(1);
		expect(
			await git(fixture.gitRepo.root, ["rev-list", "--count", "HEAD"]),
		).toBe("2");
	});

	it("generates a commit message with the LLM when no message is provided", async () => {
		const fixture = await createCloseoutFixture();

		const commitRes = await app.request(
			`http://localhost/api/runs/${fixture.run.id}/git/commit`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json", ...sameOriginHeaders },
				body: JSON.stringify({}),
			},
		);
		expect(commitRes.status).toBe(200);
		const committed = await commitRes.json();

		expect(structuredLlm.callStructuredJsonLLM).toHaveBeenCalledTimes(1);
		expect(committed.state).toBe("committed");
		expect(committed.commitRecord.commitMessage).toBe(
			"Update owned closeout file",
		);
	});

	it.each([
		"running",
		"needs_human",
		"failed",
	] as const)("keeps Git commit available while ReviewRun status is %s", async (reviewRunStatus) => {
		const fixture = await createCloseoutFixture({
			withTestCoverage: false,
			withReviewRun: true,
			reviewRunStatus,
		});

		const stateRes = await app.request(
			`http://localhost/api/runs/${fixture.run.id}/git/closeout`,
			{ headers: sameOriginHeaders },
		);
		expect(stateRes.status).toBe(200);
		const state = await stateRes.json();

		expect(state).toMatchObject({
			canCommit: true,
			state: "commit_ready",
			blockingCode: null,
			requiredReview: {
				testCoverageStatus: null,
				reviewRunStatus,
				complete: false,
			},
		});
	});

	it("accepts a terminal ReviewRun only when its completion event matches", async () => {
		const fixture = await createCloseoutFixture({
			withReviewRun: true,
			reviewRunStatus: "done",
			withManagedVerificationEvidence: true,
		});

		const stateRes = await app.request(
			`http://localhost/api/runs/${fixture.run.id}/git/closeout`,
			{ headers: sameOriginHeaders },
		);
		const state = await stateRes.json();

		expect(state).toMatchObject({
			canCommit: true,
			state: "commit_ready",
			evidence: { review: { source: "review_run", status: "done" } },
		});
	});

	it("reports invalid ReviewRun evidence without blocking Git commit", async () => {
		const fixture = await createCloseoutFixture({
			withReviewRun: true,
			reviewRunStatus: "done",
			withReviewCompletionEvent: false,
			withManagedVerificationEvidence: true,
		});
		const stateRes = await app.request(
			`http://localhost/api/runs/${fixture.run.id}/git/closeout`,
			{ headers: sameOriginHeaders },
		);
		expect(await stateRes.json()).toMatchObject({
			canCommit: true,
			blockingCode: null,
			evidence: { review: { status: "failed" } },
		});
	});

	it("reports a failed completion_check without blocking Git commit", async () => {
		const fixture = await createCloseoutFixture({
			withReviewRun: true,
			reviewRunStatus: "done",
			withManagedVerificationEvidence: true,
			managedCompletionOk: false,
		});
		const stateRes = await app.request(
			`http://localhost/api/runs/${fixture.run.id}/git/closeout`,
			{ headers: sameOriginHeaders },
		);
		expect(await stateRes.json()).toMatchObject({
			canCommit: true,
			blockingCode: null,
			evidence: {
				verification: {
					status: "incomplete",
					completionCheckEventId: null,
				},
			},
		});
	});

	it("reports implementation-run evidence without blocking Git commit", async () => {
		const fixture = await createCloseoutFixture({
			withReviewRun: true,
			reviewRunStatus: "done",
			withManagedVerificationEvidence: true,
			managedEvidenceRunMode: "implementation",
		});
		const stateRes = await app.request(
			`http://localhost/api/runs/${fixture.run.id}/git/closeout`,
			{ headers: sameOriginHeaders },
		);
		expect(await stateRes.json()).toMatchObject({
			canCommit: true,
			blockingCode: null,
			evidence: { verification: { status: "passed" } },
		});
	});

	it("allows a later passing managed check to supersede historical failure evidence", async () => {
		const fixture = await createCloseoutFixture({
			withReviewRun: true,
			reviewRunStatus: "done",
			withManagedVerificationEvidence: true,
			withHistoricalFailedEvidence: true,
			managedEvidenceRunMode: "implementation",
		});
		const stateRes = await app.request(
			`http://localhost/api/runs/${fixture.run.id}/git/closeout`,
			{ headers: sameOriginHeaders },
		);
		expect(await stateRes.json()).toMatchObject({
			canCommit: true,
			state: "commit_ready",
			evidence: { verification: { status: "passed" } },
		});
	});

	it("blocks Git commit when post-Review verification evidence is stale", async () => {
		const fixture = await createCloseoutFixture({
			withReviewRun: true,
			reviewRunStatus: "done",
			reviewFixesApplied: true,
			withManagedVerificationEvidence: true,
			managedEvidenceRunMode: "implementation",
		});
		closeoutAdmissionMocks.evaluateCloseoutAdmission.mockResolvedValueOnce({
			passed: false,
			reasons: ["verification_incomplete"],
		});
		const stateRes = await app.request(
			`http://localhost/api/runs/${fixture.run.id}/git/closeout`,
			{ headers: sameOriginHeaders },
		);
		expect(await stateRes.json()).toMatchObject({
			canCommit: false,
			blockingCode: "CLOSEOUT_EVIDENCE_STALE",
			evidence: { verification: { status: "stale" } },
		});
	});

	it("pushes the committed closeout to the configured upstream", async () => {
		const fixture = await createCloseoutFixture({ withRemote: true });

		const commitRes = await app.request(
			`http://localhost/api/runs/${fixture.run.id}/git/commit`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...sameOriginHeaders,
				},
				body: JSON.stringify({ message: "Commit pushable closeout" }),
			},
		);
		expect(commitRes.status).toBe(200);
		const commitState = await commitRes.json();
		expect(commitState).toMatchObject({
			canPush: true,
			state: "push_ready",
		});

		const pushRes = await app.request(
			`http://localhost/api/runs/${fixture.run.id}/git/push`,
			{
				method: "POST",
				headers: sameOriginHeaders,
			},
		);
		expect(pushRes.status).toBe(200);
		const pushed = await pushRes.json();
		expect(pushed).toMatchObject({
			canPush: false,
			state: "pushed",
			commitRecord: {
				pushStatus: "pushed",
				pushRemote: "origin",
				pushBranch: "main",
			},
		});
		expect(
			await git(fixture.gitRepo.root, ["ls-remote", "origin", "main"]),
		).toContain(pushed.commitRecord.commitSha);
	}, 15_000);

	it("honors repository command policy before pushing", async () => {
		const fixture = await createCloseoutFixture({
			withRemote: true,
			safetyPolicy: { blockedCommands: ["git"] },
		});

		const commitRes = await app.request(
			`http://localhost/api/runs/${fixture.run.id}/git/commit`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...sameOriginHeaders,
				},
				body: JSON.stringify({ message: "Commit blocked push closeout" }),
			},
		);
		expect(commitRes.status).toBe(200);

		const pushRes = await app.request(
			`http://localhost/api/runs/${fixture.run.id}/git/push`,
			{
				method: "POST",
				headers: sameOriginHeaders,
			},
		);
		expect(pushRes.status).toBe(200);
		const blocked = await pushRes.json();
		expect(blocked).toMatchObject({
			canPush: false,
			state: "committed",
			blockingCode: "PUSH_POLICY_BLOCKED",
			commitRecord: { pushStatus: "blocked" },
		});
	});

	it("keeps Git commit available while Review evidence is incomplete", async () => {
		const fixture = await createCloseoutFixture();
		await reviewRepo.upsertReviewArtifact({
			reviewSessionId: (await reviewRepo.getReviewSessionByRun(fixture.run.id))
				?.id as string,
			runId: fixture.run.id,
			taskId: fixture.task.id,
			kind: "test_coverage",
			status: "running",
			artifactJson: { version: 2, kind: "test_coverage" },
			sourceEvidenceRefsJson: [],
		});

		const stateRes = await app.request(
			`http://localhost/api/runs/${fixture.run.id}/git/closeout`,
			{ headers: sameOriginHeaders },
		);
		expect(stateRes.status).toBe(200);
		const state = await stateRes.json();
		expect(state).toMatchObject({
			canCommit: true,
			state: "commit_ready",
			blockingCode: null,
		});
	});

	it("reports missing Security evidence without blocking Git commit", async () => {
		const fixture = await createCloseoutFixture({
			withSecurityEvidence: false,
		});
		const stateRes = await app.request(
			`http://localhost/api/runs/${fixture.run.id}/git/closeout`,
			{ headers: sameOriginHeaders },
		);
		const state = await stateRes.json();
		expect(state).toMatchObject({
			canCommit: true,
			blockingCode: null,
			evidence: { security: { source: "missing", status: "missing" } },
		});
	});

	it("reports unresolved blocking findings without blocking Git commit", async () => {
		const fixture = await createCloseoutFixture({ withBlockingFinding: true });
		const stateRes = await app.request(
			`http://localhost/api/runs/${fixture.run.id}/git/closeout`,
			{ headers: sameOriginHeaders },
		);
		const state = await stateRes.json();
		expect(state).toMatchObject({
			canCommit: true,
			blockingCode: null,
		});
		expect(state.evidence.findings.unresolvedBlockingIds).toHaveLength(1);
	});

	it("reports a legacy dismissed finding without blocking Git commit", async () => {
		const fixture = await createCloseoutFixture({ withBlockingFinding: true });
		const session = await reviewRepo.getReviewSessionByRun(fixture.run.id);
		if (!session) throw new Error("Review session was not created");
		const [finding] = await reviewRepo.listReviewFindings(session.id);
		if (!finding) throw new Error("Review finding was not created");
		await reviewRepo.updateReviewFindingDisposition(finding.id, {
			disposition: "ignored",
			dispositionStatus: "dismissed",
			dispositionNote: null,
		});

		const stateRes = await app.request(
			`http://localhost/api/runs/${fixture.run.id}/git/closeout`,
			{ headers: sameOriginHeaders },
		);
		expect(await stateRes.json()).toMatchObject({
			canCommit: true,
			blockingCode: null,
		});
	});
});
