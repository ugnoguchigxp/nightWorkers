import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { AppError, NotFoundError } from "../../lib/errors";
import { callStructuredJsonLLM } from "../../services/structured-llm";
import { parseRepairedJsonWithSchema } from "../../services/structured-llm/json";
import * as queueRepo from "../queue/queue.repository";
import {
	type ReviewCloseoutEvidence,
	resolveReviewCloseoutEvidence,
} from "../review/review-closeout-evidence.service";
import * as reviewRepo from "../review/review-mode.repository";
import * as repo from "./nightworkers.repository";
import { toErrorMessage } from "./run-orchestration/utils";

const execFileAsync = promisify(execFile);
const repositoryCloseoutLocks = new Map<string, Promise<void>>();

type CommitRecord = NonNullable<
	Awaited<ReturnType<typeof repo.getTaskRunCommitRecord>>
>;
type GitCloseoutBlockingCode =
	| "RUN_NOT_FOUND"
	| "REPOSITORY_NOT_FOUND"
	| "REVIEW_SESSION_MISSING"
	| "REQUIRED_REVIEW_NOT_DONE"
	| "REVIEW_RUN_NOT_STARTED"
	| "REVIEW_RUN_IN_PROGRESS"
	| "REVIEW_RUN_NOT_SUCCESSFUL"
	| "TEST_EVIDENCE_MISSING"
	| "TEST_EVIDENCE_INCOMPLETE"
	| "TEST_EVIDENCE_FAILED"
	| "TEST_EVIDENCE_STALE"
	| "SECURITY_EVIDENCE_MISSING"
	| "SECURITY_GATE_BLOCKED"
	| "BLOCKING_FINDINGS_UNRESOLVED"
	| "COMMIT_RECORD_MISSING"
	| "COMMIT_RECORD_NOT_READY"
	| "NO_STAGEABLE_PATHS"
	| "HEAD_MOVED"
	| "DIRTY_PATHS_MISSING"
	| "STAGED_PATHS_OUTSIDE_OWNERSHIP"
	| "COMMIT_ALREADY_CREATED"
	| "UPSTREAM_MISSING"
	| "PUSH_HEAD_MISMATCH"
	| "PUSH_POLICY_BLOCKED"
	| "GIT_COMMAND_FAILED";
type GitCloseoutUiState =
	| "review_required"
	| "commit_ready"
	| "commit_running"
	| "committed"
	| "push_ready"
	| "push_running"
	| "pushed"
	| "needs_human"
	| "failed";
type ReviewProgress =
	| "not_started"
	| "running"
	| "done"
	| "blocked"
	| "needs_human"
	| "failed";

const commitMessageDraftSchema = z.object({
	message: z.string().trim().min(1).max(240),
});

const commitMessageJsonSchema = {
	type: "object",
	additionalProperties: false,
	required: ["message"],
	properties: {
		message: {
			type: "string",
			minLength: 1,
			maxLength: 240,
		},
	},
};

async function withRepositoryCloseoutLock<T>(
	repositoryId: string,
	fn: () => Promise<T>,
): Promise<T> {
	const previous =
		repositoryCloseoutLocks.get(repositoryId) ?? Promise.resolve();
	let releaseCurrent: () => void = () => {};
	const current = new Promise<void>((resolve) => {
		releaseCurrent = resolve;
	});
	const tail = previous.catch(() => undefined).then(() => current);
	repositoryCloseoutLocks.set(repositoryId, tail);
	await previous.catch(() => undefined);
	try {
		return await fn();
	} finally {
		releaseCurrent();
		if (repositoryCloseoutLocks.get(repositoryId) === tail) {
			repositoryCloseoutLocks.delete(repositoryId);
		}
	}
}

function parseGitPorcelainZ(output: string) {
	const entries: Array<{ status: string; path: string }> = [];
	const tokens = output.split("\0").filter(Boolean);
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index] ?? "";
		const status = token.slice(0, 2);
		const filePath = token.slice(2).trimStart();
		if (!filePath) continue;
		entries.push({ status, path: filePath });
		if (status.includes("R") || status.includes("C")) {
			const nextPath = tokens[index + 1];
			if (nextPath) entries.push({ status, path: nextPath });
			index += 1;
		}
	}
	return entries;
}

async function git(
	repoRoot: string,
	args: string[],
	options: { allowFailure?: boolean } = {},
) {
	try {
		const result = await execFileAsync("git", args, {
			cwd: repoRoot,
			maxBuffer: 1024 * 1024 * 8,
		});
		return result.stdout.trim();
	} catch (error) {
		if (options.allowFailure) return null;
		throw error;
	}
}

async function readGitState(repoRoot: string) {
	const [head, branch, upstream, porcelain, staged] = await Promise.all([
		git(repoRoot, ["rev-parse", "--verify", "HEAD"], { allowFailure: true }),
		git(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"], {
			allowFailure: true,
		}),
		git(
			repoRoot,
			["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
			{
				allowFailure: true,
			},
		),
		git(repoRoot, ["status", "--porcelain=v1", "-z"], { allowFailure: true }),
		git(repoRoot, ["diff", "--cached", "--name-only"], {
			allowFailure: true,
		}),
	]);
	return {
		head,
		branch,
		upstream,
		dirtyPaths: parseGitPorcelainZ(porcelain ?? "")
			.map((entry) => entry.path)
			.sort(),
		stagedPaths: (staged ?? "")
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)
			.sort(),
	};
}

function list(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

function exclusions(value: unknown): Array<{ path: string; reason: string }> {
	return Array.isArray(value)
		? value.filter((item): item is { path: string; reason: string } =>
				Boolean(
					item &&
						typeof item === "object" &&
						typeof (item as { path?: unknown }).path === "string" &&
						typeof (item as { reason?: unknown }).reason === "string",
				),
			)
		: [];
}

function normalizePushStatus(record: CommitRecord | null) {
	if (record?.pushStatus) return String(record.pushStatus);
	return record?.status === "committed" ? "not_pushed" : "blocked";
}

async function loadCloseoutContext(runId: string) {
	const run = await repo.getTaskRun(runId);
	if (!run) throw new NotFoundError("Run not found");
	const repositoryId =
		run.repositoryId ?? (await repo.getTask(run.taskId))?.repositoryId;
	if (!repositoryId) throw new NotFoundError("Repository not found");
	const repository = await repo.getRepository(repositoryId);
	if (!repository?.localPath) throw new NotFoundError("Repository not found");
	const executionRepository = {
		...repository,
		localPath: run.worktreePath || repository.localPath,
	};
	const [commitRecord, reviewSession] = await Promise.all([
		repo.getTaskRunCommitRecord(runId),
		reviewRepo.getReviewSessionByRun(runId),
	]);
	const artifacts = reviewSession
		? await reviewRepo.listReviewArtifacts(reviewSession.id)
		: [];
	const testCoverage = artifacts.find(
		(artifact) => artifact.kind === "test_coverage",
	);
	const reviewRunArtifact = artifacts
		.filter((artifact) => artifact.kind === "review_run")
		.sort(
			(a, b) =>
				new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
		)[0];
	const testCoverageStatus =
		(testCoverage?.status as ReviewProgress | undefined) ?? null;
	const reviewRunStatus =
		(reviewRunArtifact?.status as ReviewProgress | undefined) ?? null;
	const closeoutEvidence = reviewSession
		? await resolveReviewCloseoutEvidence({
				runId: run.id,
				taskId: run.taskId,
				reviewSessionId: reviewSession.id,
				implementationFinishedAt:
					run.finishedAt ?? run.endedAt ?? run.updatedAt,
			})
		: null;
	const gitState = await readGitState(executionRepository.localPath);
	return {
		run,
		repository: executionRepository,
		commitRecord,
		reviewSession,
		testCoverageStatus,
		reviewRunStatus,
		closeoutEvidence,
		gitState,
	};
}

function blocking(
	code: GitCloseoutBlockingCode,
	reason: string,
	state: GitCloseoutUiState = "needs_human",
) {
	return { code, reason, state };
}

function decideCloseout(input: {
	commitRecord: CommitRecord | null;
	reviewSessionId: string | null;
	testCoverageStatus: ReviewProgress | null;
	reviewRunStatus: ReviewProgress | null;
	closeoutEvidence: ReviewCloseoutEvidence | null;
	head: string | null;
	upstream: string | null;
	dirtyPaths: string[];
	stagedPaths: string[];
}) {
	const { commitRecord } = input;
	const stageablePaths = list(commitRecord?.stageableOwnedPathsJson);
	if (!input.reviewSessionId) {
		return blocking(
			"REVIEW_SESSION_MISSING",
			"Review Mode session has not been created for this run.",
			"review_required",
		);
	}
	if (input.closeoutEvidence?.review.status !== "done") {
		const reviewStatus = input.closeoutEvidence?.review.status ?? "not_started";
		return blocking(
			reviewStatus === "not_started"
				? "REVIEW_RUN_NOT_STARTED"
				: reviewStatus === "running"
					? "REVIEW_RUN_IN_PROGRESS"
					: "REVIEW_RUN_NOT_SUCCESSFUL",
			`Review evidence is not complete: ${reviewStatus}.`,
			"review_required",
		);
	}
	if (input.closeoutEvidence.test.status !== "passed") {
		const testStatus = input.closeoutEvidence.test.status;
		return blocking(
			testStatus === "missing"
				? "TEST_EVIDENCE_MISSING"
				: testStatus === "failed"
					? "TEST_EVIDENCE_FAILED"
					: testStatus === "stale"
						? "TEST_EVIDENCE_STALE"
						: "TEST_EVIDENCE_INCOMPLETE",
			input.closeoutEvidence.test.reason ||
				`Test evidence is not passed: ${input.closeoutEvidence.test.status}.`,
			"review_required",
		);
	}
	if (!["passed", "skipped"].includes(input.closeoutEvidence.security.status)) {
		return blocking(
			input.closeoutEvidence.security.status === "missing"
				? "SECURITY_EVIDENCE_MISSING"
				: "SECURITY_GATE_BLOCKED",
			input.closeoutEvidence.security.reason ||
				`Security Oracle evidence is not passed: ${input.closeoutEvidence.security.status}.`,
			"review_required",
		);
	}
	if (input.closeoutEvidence.findings.unresolvedBlockingIds.length > 0) {
		return blocking(
			"BLOCKING_FINDINGS_UNRESOLVED",
			`Unresolved blocking findings remain: ${input.closeoutEvidence.findings.unresolvedBlockingIds.join(", ")}`,
			"review_required",
		);
	}
	if (!commitRecord) {
		return blocking(
			"COMMIT_RECORD_MISSING",
			"Commit ownership record is missing for this run.",
		);
	}
	if (commitRecord.status === "committed") {
		const pushStatus = normalizePushStatus(commitRecord);
		if (commitRecord.commitSha && input.head !== commitRecord.commitSha) {
			return blocking(
				"PUSH_HEAD_MISMATCH",
				"Current HEAD does not match the saved commit SHA.",
				"needs_human",
			);
		}
		if (pushStatus === "pushed") {
			return { code: null, reason: null, state: "pushed" as const };
		}
		if (pushStatus === "pushing") {
			return { code: null, reason: null, state: "push_running" as const };
		}
		if (pushStatus === "failed") {
			return blocking(
				"GIT_COMMAND_FAILED",
				commitRecord.statusReason || "Git push failed.",
				"failed",
			);
		}
		if (pushStatus === "blocked") {
			return blocking(
				"PUSH_POLICY_BLOCKED",
				commitRecord.statusReason || "Git push is blocked.",
				"committed",
			);
		}
		if (!input.upstream) {
			return blocking(
				"UPSTREAM_MISSING",
				"Current branch does not have an upstream.",
				"committed",
			);
		}
		return { code: null, reason: null, state: "push_ready" as const };
	}
	if (commitRecord.status !== "ready") {
		if (commitRecord.status === "failed") {
			return blocking(
				"GIT_COMMAND_FAILED",
				commitRecord.statusReason || "Git closeout commit failed.",
				"failed",
			);
		}
		return blocking(
			"COMMIT_RECORD_NOT_READY",
			commitRecord.statusReason ||
				`Commit ownership record is not ready: ${commitRecord.status}.`,
		);
	}
	if (stageablePaths.length === 0) {
		return blocking(
			"NO_STAGEABLE_PATHS",
			"No stageable owned paths were found.",
		);
	}
	if (commitRecord.baselineHead && input.head !== commitRecord.baselineHead) {
		return blocking("HEAD_MOVED", "Current HEAD moved since the run started.");
	}
	if (input.stagedPaths.length > 0) {
		return blocking(
			"STAGED_PATHS_OUTSIDE_OWNERSHIP",
			"The repository already has staged paths.",
		);
	}
	const dirty = new Set(input.dirtyPaths);
	const missing = stageablePaths.filter((path) => !dirty.has(path));
	if (missing.length > 0) {
		return blocking(
			"DIRTY_PATHS_MISSING",
			`Owned paths are no longer dirty: ${missing.join(", ")}`,
		);
	}
	return { code: null, reason: null, state: "commit_ready" as const };
}

export async function getRunGitCloseout(runId: string) {
	const context = await loadCloseoutContext(runId);
	const stageablePaths = list(context.commitRecord?.stageableOwnedPathsJson);
	const excludedPaths = exclusions(context.commitRecord?.excludedPathsJson);
	const decision = decideCloseout({
		commitRecord: context.commitRecord,
		reviewSessionId: context.reviewSession?.id ?? null,
		testCoverageStatus: context.testCoverageStatus,
		reviewRunStatus: context.reviewRunStatus,
		closeoutEvidence: context.closeoutEvidence,
		head: context.gitState.head,
		upstream: context.gitState.upstream,
		dirtyPaths: context.gitState.dirtyPaths,
		stagedPaths: context.gitState.stagedPaths,
	});
	return {
		runId: context.run.id,
		repositoryId: context.repository.id,
		canCommit: decision.state === "commit_ready",
		canPush: decision.state === "push_ready",
		state: decision.state,
		blockingCode: decision.code,
		blockingReason: decision.reason,
		commitRecord: context.commitRecord,
		requiredReview: {
			reviewSessionId: context.reviewSession?.id ?? null,
			testCoverageStatus: context.testCoverageStatus,
			reviewRunStatus: context.reviewRunStatus,
			complete:
				context.closeoutEvidence?.review.status === "done" &&
				context.closeoutEvidence.test.status === "passed" &&
				["passed", "skipped"].includes(
					context.closeoutEvidence.security.status,
				) &&
				context.closeoutEvidence.findings.unresolvedBlockingIds.length === 0,
		},
		evidence: context.closeoutEvidence,
		nextAction: decision.reason,
		git: context.gitState,
		counts: {
			stageablePaths: stageablePaths.length,
			excludedPaths: excludedPaths.length,
		},
	};
}

function defaultCommitMessage(input: {
	taskTitle?: string | null;
	runId: string;
	message?: string;
}) {
	const message = input.message?.trim();
	if (message) return message;
	const title = input.taskTitle?.trim();
	if (title) return `Implement ${title}`;
	return `Complete NightWorkers run ${input.runId.slice(0, 8)}`;
}

async function readOwnedDiff(input: {
	repoRoot: string;
	stageablePaths: string[];
}) {
	if (input.stageablePaths.length === 0) return "";
	const diff = await git(
		input.repoRoot,
		["diff", "--", ...input.stageablePaths],
		{ allowFailure: true },
	);
	return (diff ?? "").slice(0, 20_000);
}

async function generateCommitMessage(input: {
	repoRoot: string;
	runId: string;
	taskTitle?: string | null;
	runSummary?: string | null;
	finalReport?: string | null;
	stageablePaths: string[];
	explicitMessage?: string;
}) {
	const fallback = defaultCommitMessage({
		taskTitle: input.taskTitle,
		runId: input.runId,
		message: input.explicitMessage,
	});
	if (input.explicitMessage?.trim()) return fallback;
	try {
		const diff = await readOwnedDiff({
			repoRoot: input.repoRoot,
			stageablePaths: input.stageablePaths,
		});
		const raw = await callStructuredJsonLLM(
			[
				"You generate concise Git commit messages.",
				"Return JSON only.",
				"Use an imperative subject line.",
				"Do not mention NightWorkers, ReviewRun, or implementation details unless they are part of the user-facing change.",
			].join("\n"),
			[
				`Task title: ${input.taskTitle || "(none)"}`,
				`Run summary: ${input.runSummary || "(none)"}`,
				`Final report: ${(input.finalReport || "").slice(0, 2000) || "(none)"}`,
				`Files:\n${input.stageablePaths.map((filePath) => `- ${filePath}`).join("\n")}`,
				`Diff:\n${diff || "(diff unavailable)"}`,
				"",
				"Generate one commit message subject, 72 characters preferred, 240 characters maximum.",
			].join("\n"),
			{
				schemaName: "git_commit_message",
				schema: commitMessageJsonSchema,
				role: "completion",
				workingDirectory: input.repoRoot,
				runId: input.runId,
				timeoutMs: 30_000,
			},
		);
		const parsed = parseRepairedJsonWithSchema(raw, commitMessageDraftSchema);
		if (parsed.ok) return parsed.value.message;
		return fallback;
	} catch {
		return fallback;
	}
}

async function markUnsafe(runId: string, code: string, reason: string) {
	if (
		["HEAD_MOVED", "NO_STAGEABLE_PATHS", "DIRTY_PATHS_MISSING"].includes(
			code,
		) ||
		code === "STAGED_PATHS_OUTSIDE_OWNERSHIP"
	) {
		await repo.updateTaskRunCommitRecord(runId, {
			status: "needs_human",
			statusReason: reason,
		});
	}
}

export async function commitRunGitCloseout(
	runId: string,
	input: { message?: string } = {},
) {
	const context = await loadCloseoutContext(runId);
	return withRepositoryCloseoutLock(context.repository.id, () =>
		commitRunGitCloseoutLocked(runId, input),
	);
}

async function commitRunGitCloseoutLocked(
	runId: string,
	input: { message?: string } = {},
) {
	const context = await loadCloseoutContext(runId);
	const before = await getRunGitCloseout(runId);
	if (!before.canCommit) {
		if (before.blockingCode && before.blockingReason) {
			await markUnsafe(runId, before.blockingCode, before.blockingReason);
		}
		return getRunGitCloseout(runId);
	}
	const commitRecord = context.commitRecord;
	if (!commitRecord) {
		throw new AppError(
			409,
			"COMMIT_RECORD_MISSING",
			"Commit ownership record is missing for this run.",
		);
	}
	const stageablePaths = list(commitRecord.stageableOwnedPathsJson);
	const task = await repo.getTask(context.run.taskId);
	const message = await generateCommitMessage({
		repoRoot: context.repository.localPath,
		taskTitle: task?.title,
		runId,
		runSummary: context.run.summary,
		finalReport: context.run.finalReport,
		stageablePaths,
		explicitMessage: input.message,
	});
	try {
		const stagedBefore = context.gitState.stagedPaths;
		if (stagedBefore.length > 0) {
			await repo.updateTaskRunCommitRecord(runId, {
				status: "needs_human",
				statusReason: "The repository already has staged paths.",
			});
			return getRunGitCloseout(runId);
		}
		await execFileAsync("git", ["add", "--", ...stageablePaths], {
			cwd: context.repository.localPath,
			maxBuffer: 1024 * 1024 * 8,
		});
		const stagedAfterOutput = await git(context.repository.localPath, [
			"diff",
			"--cached",
			"--name-only",
		]);
		const stagedAfter = (stagedAfterOutput ?? "").split("\n").filter(Boolean);
		const allowed = new Set(stageablePaths);
		if (stagedAfter.some((path) => !allowed.has(path))) {
			await repo.updateTaskRunCommitRecord(runId, {
				status: "needs_human",
				statusReason: "Staged paths include files outside run ownership.",
			});
			return getRunGitCloseout(runId);
		}
		await execFileAsync("git", ["commit", "-m", message], {
			cwd: context.repository.localPath,
			maxBuffer: 1024 * 1024 * 8,
		});
		const commitSha = await git(context.repository.localPath, [
			"rev-parse",
			"HEAD",
		]);
		await repo.updateTaskRunCommitRecord(runId, {
			status: "committed",
			commitSha,
			commitMessage: message,
			pushStatus: "not_pushed",
			statusReason: "Committed runtime-owned paths.",
		});
		await repo.createRunEvent({
			version: 1,
			runId,
			taskId: context.run.taskId,
			timestamp: new Date().toISOString(),
			type: "git.closeout_committed",
			severity: "info",
			actor: "system",
			message: `Committed runtime-owned paths: ${commitSha}`,
			data: { commitSha, message, paths: stageablePaths },
		});
		await queueRepo.completeImplementationQueueEntryForRunId({
			runId,
			runStatus: "completed",
		});
		return getRunGitCloseout(runId);
	} catch (error) {
		await repo.updateTaskRunCommitRecord(runId, {
			status: "failed",
			statusReason: toErrorMessage(error),
		});
		await repo.createRunEvent({
			version: 1,
			runId,
			taskId: context.run.taskId,
			timestamp: new Date().toISOString(),
			type: "git.closeout_commit_failed",
			severity: "warning",
			actor: "system",
			message: "Git closeout commit failed.",
			data: { error: toErrorMessage(error) },
		});
		return getRunGitCloseout(runId);
	}
}

function pushBlockedByPolicy(safetyPolicy: unknown) {
	const blockedCommands = Array.isArray(
		(safetyPolicy as { blockedCommands?: unknown })?.blockedCommands,
	)
		? ((safetyPolicy as { blockedCommands: unknown[] }).blockedCommands.filter(
				(item): item is string => typeof item === "string",
			) ?? [])
		: [];
	const command = "git push";
	return blockedCommands.some((blocked) => {
		const normalized = blocked.trim();
		if (!normalized) return false;
		return (
			command.includes(normalized) ||
			new RegExp(`\\b${escapeRegExp(normalized)}\\b`).test(command)
		);
	});
}

function escapeRegExp(value: string) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function pushRunGitCloseout(runId: string) {
	const context = await loadCloseoutContext(runId);
	return withRepositoryCloseoutLock(context.repository.id, () =>
		pushRunGitCloseoutLocked(runId),
	);
}

async function pushRunGitCloseoutLocked(runId: string) {
	const context = await loadCloseoutContext(runId);
	const state = await getRunGitCloseout(runId);
	if (!state.canPush) return state;
	if (pushBlockedByPolicy(context.repository.safetyPolicy)) {
		await repo.updateTaskRunCommitRecord(runId, {
			pushStatus: "blocked",
			statusReason: "Repository safety policy blocks git push.",
		});
		return getRunGitCloseout(runId);
	}
	const upstream = context.gitState.upstream;
	if (!upstream) return state;
	try {
		await repo.updateTaskRunCommitRecord(runId, {
			pushStatus: "pushing",
			statusReason: "Pushing committed run closeout.",
		});
		await execFileAsync("git", ["push"], {
			cwd: context.repository.localPath,
			maxBuffer: 1024 * 1024 * 8,
		});
		const slash = upstream.indexOf("/");
		const pushRemote = slash > 0 ? upstream.slice(0, slash) : null;
		const pushBranch = slash > 0 ? upstream.slice(slash + 1) : upstream;
		await repo.updateTaskRunCommitRecord(runId, {
			pushStatus: "pushed",
			pushedAt: new Date(),
			pushRemote,
			pushBranch,
			statusReason: "Pushed committed run closeout.",
		});
		await repo.createRunEvent({
			version: 1,
			runId,
			taskId: context.run.taskId,
			timestamp: new Date().toISOString(),
			type: "git.closeout_pushed",
			severity: "info",
			actor: "system",
			message: `Pushed committed run closeout to ${upstream}.`,
			data: { upstream, pushRemote, pushBranch },
		});
		return getRunGitCloseout(runId);
	} catch (error) {
		await repo.updateTaskRunCommitRecord(runId, {
			pushStatus: "failed",
			statusReason: toErrorMessage(error),
		});
		await repo.createRunEvent({
			version: 1,
			runId,
			taskId: context.run.taskId,
			timestamp: new Date().toISOString(),
			type: "git.closeout_push_failed",
			severity: "warning",
			actor: "system",
			message: "Git closeout push failed.",
			data: { error: toErrorMessage(error), upstream },
		});
		return getRunGitCloseout(runId);
	}
}
