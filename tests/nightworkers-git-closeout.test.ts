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
		await reviewRepo.upsertReviewArtifact({
			reviewSessionId: session.id,
			runId: run.id,
			taskId: task.id,
			kind: "review_run",
			status: "running",
			artifactJson: {
				version: 1,
				kind: "review_run",
				status: "running",
				todos: [],
				target: { targetFiles: [{ path: "owned.txt" }] },
				warnings: [],
			},
			sourceEvidenceRefsJson: [],
		});
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

	it("allows commit readiness from ReviewRun evidence without the legacy test coverage section", async () => {
		const fixture = await createCloseoutFixture({
			withTestCoverage: false,
			withReviewRun: true,
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
			requiredReview: {
				testCoverageStatus: null,
				reviewRunStatus: "running",
				complete: true,
			},
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
			blockingCode: "REQUIRED_REVIEW_NOT_DONE",
		});
	});
});
