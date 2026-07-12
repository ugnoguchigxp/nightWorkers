import { execFile } from "node:child_process";
import crypto from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
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
import * as reviewRepo from "../api/modules/review/review-mode.repository";
import * as structuredLlm from "../api/services/structured-llm";

vi.mock("../api/services/structured-llm", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../api/services/structured-llm")>();
	return {
		...actual,
		callStructuredJsonLLM: vi.fn(),
	};
});

const execFileAsync = promisify(execFile);
const sameOriginHeaders = { Origin: "http://localhost:39174" };
const tempRoots: string[] = [];

beforeAll(async () => {
	await ensureNightWorkersSchema();
});

beforeEach(() => {
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

async function createGitRepo(input: { withRemote?: boolean } = {}) {
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
	const baselineHead = await git(root, ["rev-parse", "HEAD"]);
	await writeFile(path.join(root, "owned.txt"), "after\n");
	return { root, baselineHead, remoteRoot };
}

async function createCloseoutFixture(
	input: {
		withRemote?: boolean;
		safetyPolicy?: unknown;
		withTestCoverage?: boolean;
		withReviewRun?: boolean;
		reviewRunStatus?: "running" | "done" | "failed" | "needs_human";
		withSecurityEvidence?: boolean;
		withBlockingFinding?: boolean;
		withManagedTestEvidence?: boolean;
	} = {},
) {
	const gitRepo = await createGitRepo({ withRemote: input.withRemote });
	const project = await repo.createRepository({
		name: `TEST: Git Closeout ${crypto.randomUUID()}`,
		localPath: gitRepo.root,
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
	if (input.withManagedTestEvidence) {
		const [document] = await db
			.insert(verificationDocuments)
			.values({
				taskId: task.id,
				runId: run.id,
				sourceSpecPath: "spec/docs/test.md",
				status: "active",
				documentJson: {},
				generatedAt: new Date(),
			})
			.returning();
		if (!document) throw new Error("Verification document was not created");
		const [evidence] = await db
			.insert(verificationEvidenceRuns)
			.values({
				taskId: task.id,
				runId: run.id,
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
				startedAt: new Date(),
				finishedAt: new Date(),
			})
			.returning();
		if (!evidence) throw new Error("Verification evidence was not created");
		await db.insert(verificationChecklistItems).values({
			verificationDocumentId: document.id,
			taskId: task.id,
			conditionId: "condition-1",
			text: "Unit tests pass",
			required: true,
			status: "passed",
			evidenceIdsJson: [evidence.id],
		});
		await repo.createRunEvent({
			version: 1,
			runId: run.id,
			taskId: task.id,
			timestamp: new Date().toISOString(),
			type: "tool.call_finished",
			severity: "info",
			actor: "tool",
			message: "completion_check finished",
			data: {
				mcpTool: "completion_check",
				status: "completed",
				result: { ok: true },
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
				summary: "Test evidence checked.",
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
			},
			sourceEvidenceRefsJson: [],
		});
		if (reviewRunStatus === "done") {
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
	] as const)("does not treat ReviewRun status %s as completed evidence", async (reviewRunStatus) => {
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
			canCommit: false,
			state: "review_required",
			blockingCode:
				reviewRunStatus === "running"
					? "REVIEW_RUN_IN_PROGRESS"
					: "REVIEW_RUN_NOT_SUCCESSFUL",
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
			withManagedTestEvidence: true,
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

	it("blocks commit when required test evidence review is incomplete", async () => {
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
			canCommit: false,
			state: "review_required",
			blockingCode: "REVIEW_RUN_NOT_STARTED",
		});
	});

	it("blocks closeout when implementation Security Oracle evidence is missing", async () => {
		const fixture = await createCloseoutFixture({
			withSecurityEvidence: false,
		});
		const stateRes = await app.request(
			`http://localhost/api/runs/${fixture.run.id}/git/closeout`,
			{ headers: sameOriginHeaders },
		);
		const state = await stateRes.json();
		expect(state).toMatchObject({
			canCommit: false,
			blockingCode: "SECURITY_EVIDENCE_MISSING",
			evidence: { security: { source: "missing", status: "missing" } },
		});
	});

	it("blocks closeout while a blocking review finding is unresolved", async () => {
		const fixture = await createCloseoutFixture({ withBlockingFinding: true });
		const stateRes = await app.request(
			`http://localhost/api/runs/${fixture.run.id}/git/closeout`,
			{ headers: sameOriginHeaders },
		);
		const state = await stateRes.json();
		expect(state).toMatchObject({
			canCommit: false,
			blockingCode: "BLOCKING_FINDINGS_UNRESOLVED",
		});
		expect(state.evidence.findings.unresolvedBlockingIds).toHaveLength(1);
	});
});
