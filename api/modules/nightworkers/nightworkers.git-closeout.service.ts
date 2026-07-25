import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { AppError, NotFoundError } from "../../lib/errors";
import { callStructuredOutputWithRepair } from "../../services/structured-generation/structured-output-repair.service";
import { createStructuredOutputContract } from "../../services/structured-llm";
import { StructuredLlmResponseError } from "../../services/structured-llm/contract";
import { p } from "../../systemContexts/catalog";
import { withRepositoryGitMutationLock } from "../gitworktree/repository-git-mutation-lock";
import * as queueRepo from "../queue/queue.repository";
import { resolveReviewCloseoutEvidence } from "../review/review-closeout-evidence.service";
import * as reviewRepo from "../review/review-mode.repository";
import {
	blocking,
	defaultCommitMessage,
	exclusions,
	git,
	list,
	normalizePushStatus,
	pushBlockedByPolicy,
	readGitState,
	readOwnedDiff,
	resolveGitIntegrationCloseout,
	withRepositoryCloseoutLock,
} from "./git-closeout-support";
import { getTaskRunMergeRecord } from "./nightworkers.git-merge.repository";
import { createMergeRecordForCommittedRun } from "./nightworkers.git-merge.service";
import { pushMergedTaskRunTarget } from "./nightworkers.git-target-push.service";
import * as repo from "./nightworkers.repository";
import { toErrorMessage } from "./run-orchestration/utils";

const execFileAsync = promisify(execFile);

type CommitRecord = NonNullable<
	Awaited<ReturnType<typeof repo.getTaskRunCommitRecord>>
>;
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
	const [commitRecord, reviewSession, mergeRecord] = await Promise.all([
		repo.getTaskRunCommitRecord(runId),
		reviewRepo.getReviewSessionByRun(runId),
		getTaskRunMergeRecord(runId),
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
		mergeRecord,
		reviewSession,
		testCoverageStatus,
		reviewRunStatus,
		closeoutEvidence,
		gitState,
	};
}

function decideCloseout(input: {
	commitRecord: CommitRecord | null;
	head: string | null;
	upstream: string | null;
	dirtyPaths: string[];
	stagedPaths: string[];
}) {
	const { commitRecord } = input;
	const stageablePaths = list(commitRecord?.stageableOwnedPathsJson);
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
	const preExistingDirtyPaths = list(commitRecord.preExistingDirtyPathsJson);
	const stillDirtyPreExistingPaths = preExistingDirtyPaths.filter((path) =>
		dirty.has(path),
	);
	if (stillDirtyPreExistingPaths.length > 0) {
		return blocking(
			"PRE_EXISTING_DIRTY_PATHS",
			`Pre-existing dirty paths must be resolved before closeout: ${stillDirtyPreExistingPaths.join(", ")}`,
		);
	}
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
		head: context.gitState.head,
		upstream: context.gitState.upstream,
		dirtyPaths: context.gitState.dirtyPaths,
		stagedPaths: context.gitState.stagedPaths,
	});
	const integration = resolveGitIntegrationCloseout(
		context.mergeRecord,
		decision,
	);
	return {
		runId: context.run.id,
		repositoryId: context.repository.id,
		canCommit: decision.state === "commit_ready",
		canPush: integration.canPush,
		state: integration.state,
		blockingCode: decision.code,
		blockingReason: integration.blockingReason,
		commitRecord: context.commitRecord,
		mergeRecord: context.mergeRecord,
		requiredReview: {
			reviewSessionId: context.reviewSession?.id ?? null,
			testCoverageStatus: context.testCoverageStatus,
			reviewRunStatus: context.reviewRunStatus,
			complete:
				context.closeoutEvidence?.review.status === "done" &&
				context.closeoutEvidence.verification.status === "passed" &&
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
		const generated = await callStructuredOutputWithRepair({
			systemPrompt: p("nightworkers.git-commit-message", {}),
			userPrompt: [
				`Task title: ${input.taskTitle || "(none)"}`,
				`Run summary: ${input.runSummary || "(none)"}`,
				`Final report: ${(input.finalReport || "").slice(0, 2000) || "(none)"}`,
				`Files:\n${input.stageablePaths.map((filePath) => `- ${filePath}`).join("\n")}`,
				`Diff:\n${diff || "(diff unavailable)"}`,
				"",
				"Generate one commit message subject, 72 characters preferred, 240 characters maximum.",
			].join("\n"),
			options: {
				contract: createStructuredOutputContract({
					name: "git_commit_message",
					runtimeSchema: commitMessageDraftSchema,
					providerJsonSchema: commitMessageJsonSchema,
				}),
				role: "review",
				workingDirectory: input.repoRoot,
				runId: input.runId,
				timeoutMs: 30_000,
			},
		});
		return generated.value.message;
	} catch (error) {
		if (error instanceof StructuredLlmResponseError) throw error;
		return fallback;
	}
}

async function markUnsafe(runId: string, code: string, reason: string) {
	if (
		["HEAD_MOVED", "NO_STAGEABLE_PATHS", "DIRTY_PATHS_MISSING"].includes(
			code,
		) ||
		code === "PRE_EXISTING_DIRTY_PATHS" ||
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
		withRepositoryGitMutationLock(context.repository.id, "commit", () =>
			commitRunGitCloseoutLocked(runId, input),
		),
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
		const taskWorkspace = await (
			await import("../gitworktree/task-git-workspace.repository")
		).getTaskGitWorkspace(context.run.taskId);
		if (taskWorkspace) {
			await createMergeRecordForCommittedRun(runId);
			await queueRepo.completeImplementationQueueEntryForRunId({
				runId,
				runStatus: "completed",
			});
			await repo.updateTask(context.run.taskId, { status: "needs_review" });
		} else {
			await queueRepo.completeImplementationQueueEntryForRunId({
				runId,
				runStatus: "completed",
			});
		}
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

export async function pushRunGitCloseout(runId: string) {
	const context = await loadCloseoutContext(runId);
	return withRepositoryCloseoutLock(context.repository.id, () =>
		withRepositoryGitMutationLock(context.repository.id, "commit", () =>
			pushRunGitCloseoutLocked(runId),
		),
	);
}

async function pushRunGitCloseoutLocked(runId: string) {
	const context = await loadCloseoutContext(runId);
	const state = await getRunGitCloseout(runId);
	if (!state.canPush) return state;
	if (context.mergeRecord?.status === "merged") {
		await pushMergedTaskRunTarget(runId);
		return getRunGitCloseout(runId);
	}
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
