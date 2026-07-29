import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../../db/client";
import {
	missionPilotCloseouts,
	missionPilotContextSnapshots,
	missionPilotSessions,
	taskArchiveRecords,
} from "../../db/mission-pilot-schema";
import { tasks } from "../../db/schema";
import { digestText } from "../../services/text-digest";
import { withRepositoryGitMutationLock } from "../gitworktree/repository-git-mutation-lock";
import { archiveCompletedTask } from "../nightworkers/task-archive.service";
import {
	admitMissionPilotCloseout,
	consumeMissionPilotCloseoutAdmission,
	loadMissionPilotCloseoutEvidence,
} from "./mission-pilot-closeout-admission.service";
import {
	appendFinalMissionPilotContext,
	git,
	hashWorkingTreePath,
	lines,
	markAttention,
	normalizeOwnedPaths,
	readArray,
	readPathHashes,
	readPorcelainPath,
	readRecord,
	recoverMissionPilotCommittedCloseout,
} from "./mission-pilot-closeout-support";
import { appendMissionPilotEvent } from "./mission-pilot-event.repository";
import { evaluateCompletionAdmission } from "./mission-pilot-post-queue-state";

export { recoverMissionPilotCommittedCloseout } from "./mission-pilot-closeout-support";

const _execFileAsync = promisify(execFile);
const closeoutLocks = new Map<string, Promise<unknown>>();
export async function executeMissionPilotCloseout(sessionId: string) {
	const previous = closeoutLocks.get(sessionId) ?? Promise.resolve();
	const current = previous
		.catch(() => undefined)
		.then(() => executeCloseout(sessionId));
	closeoutLocks.set(sessionId, current);
	try {
		return await current;
	} finally {
		if (closeoutLocks.get(sessionId) === current)
			closeoutLocks.delete(sessionId);
	}
}

async function executeCloseout(sessionId: string) {
	const [session] = await db
		.select()
		.from(missionPilotSessions)
		.where(eq(missionPilotSessions.id, sessionId))
		.limit(1);
	if (session) {
		const [archiveRecord] = await db
			.select()
			.from(taskArchiveRecords)
			.where(
				and(
					eq(taskArchiveRecords.taskId, session.taskId),
					eq(taskArchiveRecords.missionPilotSessionId, session.id),
					isNull(taskArchiveRecords.restoredAt),
				),
			)
			.orderBy(desc(taskArchiveRecords.archivedAt))
			.limit(1);
		if (archiveRecord)
			return finalizeArchivedCloseout({ session, archiveRecord });
	}
	if (!session) throw new Error("Mission Pilot session is missing");
	return withRepositoryGitMutationLock(session.repositoryId, "commit", () =>
		executeCloseoutLocked(session),
	);
}

async function executeCloseoutLocked(
	session: typeof missionPilotSessions.$inferSelect,
) {
	const { closeout, reviewDecision, snapshot, repository, task } =
		await loadMissionPilotCloseoutEvidence(session);
	if (
		closeout.reviewedContextDigest !== session.contextDigest ||
		reviewDecision.verdict !== "pass" ||
		snapshot.verdict !== "pass"
	)
		throw new Error("Mission Pilot closeout evidence is stale or not passed");
	const repoRoot = task.worktreePath || repository.localPath;
	const closeoutAdmission = await admitMissionPilotCloseout({
		session,
		snapshot,
		taskId: task.id,
	});
	const stageablePaths = normalizeOwnedPaths(closeout.stageableOwnedPathsJson);
	let commitSha: string | null = closeout.commitSha;
	let closeoutStatus = closeout.status;
	if (stageablePaths.length > 0 && !commitSha) {
		const currentHead = await git(repoRoot, ["rev-parse", "--verify", "HEAD"]);
		if (currentHead !== closeout.baselineHead) {
			const recovered = await recoverMissionPilotCommittedCloseout({
				repoRoot,
				currentHead,
				baselineHead: closeout.baselineHead,
				stageablePaths,
			});
			if (!recovered) return markAttention(session, closeout.id, "HEAD_MOVED");
			commitSha = currentHead;
			closeoutStatus = "committed";
			await db
				.update(missionPilotCloseouts)
				.set({ status: closeoutStatus, commitSha, updatedAt: new Date() })
				.where(eq(missionPilotCloseouts.id, closeout.id));
		} else if (
			lines(
				await git(repoRoot, [
					"status",
					"--porcelain=v1",
					"--",
					...stageablePaths,
				]),
			).length === 0
		) {
			const priorCloseouts = await db
				.select()
				.from(missionPilotCloseouts)
				.where(eq(missionPilotCloseouts.sessionId, session.id));
			const reviewedMissionCommit = priorCloseouts.some(
				(item) =>
					item.id !== closeout.id &&
					item.commitSha === currentHead &&
					item.status === "invalidated",
			);
			if (!reviewedMissionCommit)
				return markAttention(
					session,
					closeout.id,
					"REVIEWED_MISSION_COMMIT_MISSING",
				);
			commitSha = currentHead;
			closeoutStatus = "committed";
			await db
				.update(missionPilotCloseouts)
				.set({
					status: closeoutStatus,
					commitSha,
					statusReason: "reviewed_existing_mission_commit",
					updatedAt: new Date(),
				})
				.where(eq(missionPilotCloseouts.id, closeout.id));
		} else {
			const preCommitStatusPaths = lines(
				await git(repoRoot, ["status", "--porcelain=v1"]),
			)
				.map(readPorcelainPath)
				.filter(Boolean);
			const preCommitOutsideHashes = await readPathHashes(
				repoRoot,
				preCommitStatusPaths.filter((path) => !stageablePaths.includes(path)),
			);
			const stagedBefore = lines(
				await git(repoRoot, ["diff", "--cached", "--name-only"]),
			);
			if (stagedBefore.length > 0)
				return markAttention(session, closeout.id, "PRE_EXISTING_STAGED_PATHS");
			await db
				.update(missionPilotSessions)
				.set({ phase: "committing", updatedAt: new Date() })
				.where(eq(missionPilotSessions.id, session.id));
			await db
				.update(missionPilotCloseouts)
				.set({ status: "committing", updatedAt: new Date() })
				.where(eq(missionPilotCloseouts.id, closeout.id));
			await git(repoRoot, ["add", "--", ...stageablePaths]);
			const staged = lines(
				await git(repoRoot, ["diff", "--cached", "--name-only"]),
			).sort();
			if (
				JSON.stringify(staged) !== JSON.stringify([...stageablePaths].sort())
			) {
				await git(
					repoRoot,
					["restore", "--staged", "--", ...stageablePaths],
					true,
				);
				return markAttention(
					session,
					closeout.id,
					"STAGED_PATHS_OUTSIDE_OWNERSHIP",
				);
			}
			const reviewedTree = await git(repoRoot, ["write-tree"]);
			const message = `feat: complete Mission Pilot task ${task.title}`.slice(
				0,
				240,
			);
			await git(repoRoot, ["commit", "-m", message, "--", ...stageablePaths]);
			commitSha = await git(repoRoot, ["rev-parse", "--verify", "HEAD"]);
			const committedTree = await git(repoRoot, [
				"rev-parse",
				"--verify",
				`${commitSha}^{tree}`,
			]);
			closeoutStatus = "committed";
			await db
				.update(missionPilotCloseouts)
				.set({
					status: closeoutStatus,
					commitSha,
					commitMessage: message,
					updatedAt: new Date(),
				})
				.where(eq(missionPilotCloseouts.id, closeout.id));
			const postCommitStatus = lines(
				await git(repoRoot, ["status", "--porcelain=v1"]),
			);
			const committedMutationPaths =
				reviewedTree === committedTree
					? []
					: lines(
							await git(repoRoot, [
								"diff-tree",
								"--no-commit-id",
								"--name-only",
								"-r",
								reviewedTree,
								committedTree,
							]),
						);
			const postCommitPaths = postCommitStatus
				.map(readPorcelainPath)
				.filter(Boolean);
			const postCommitOwnedPaths = postCommitPaths.filter((path) =>
				stageablePaths.includes(path),
			);
			const changedOutsidePaths: string[] = [];
			for (const path of postCommitPaths.filter(
				(path) => !stageablePaths.includes(path),
			)) {
				const previousHash = preCommitOutsideHashes.get(path);
				const currentHash = await hashWorkingTreePath(repoRoot, path);
				if (previousHash === undefined || previousHash !== currentHash)
					changedOutsidePaths.push(path);
			}
			const mutationPaths = [
				...new Set([
					...committedMutationPaths,
					...postCommitOwnedPaths,
					...changedOutsidePaths,
				]),
			].sort();
			if (mutationPaths.length > 0) {
				const outsideOwnership = mutationPaths.filter(
					(path) => !stageablePaths.includes(path),
				);
				if (outsideOwnership.length > 0)
					return markAttention(
						session,
						closeout.id,
						"COMMIT_HOOK_MUTATION_OUTSIDE_OWNERSHIP",
					);
				const stagedHookPaths = lines(
					await git(repoRoot, ["diff", "--cached", "--name-only"]),
				).filter((path) => mutationPaths.includes(path));
				if (stagedHookPaths.length > 0) {
					await git(repoRoot, [
						"restore",
						"--staged",
						"--",
						...stagedHookPaths,
					]);
				}
				return invalidateEvidenceAfterHookMutation({
					session,
					closeoutId: closeout.id,
					commitSha,
					mutationPaths,
					reviewedTree,
					committedTree,
				});
			}
		}
	}
	let pushStatus = closeout.pushStatus;
	if (closeout.pushPolicy === "never") {
		pushStatus = "skipped";
	} else if (pushStatus === "pushed") {
		closeoutStatus = "pushed";
	} else {
		await db
			.update(missionPilotSessions)
			.set({ phase: "pushing", updatedAt: new Date() })
			.where(eq(missionPilotSessions.id, session.id));
		try {
			await git(repoRoot, ["push"]);
			pushStatus = "pushed";
			closeoutStatus = "pushed";
		} catch (_error) {
			if (closeout.pushPolicy === "required")
				return markAttention(session, closeout.id, "REQUIRED_PUSH_FAILED");
			pushStatus = "failed";
		}
	}
	await db
		.update(missionPilotCloseouts)
		.set({ status: closeoutStatus, pushStatus, updatedAt: new Date() })
		.where(eq(missionPilotCloseouts.id, closeout.id));
	const admission = evaluateCompletionAdmission({
		verificationPass: snapshot.verdict === "pass",
		reviewPass:
			reviewDecision.verdict === "pass" && reviewDecision.blockingCount === 0,
		closeoutStatus,
		pushPolicy: closeout.pushPolicy as "never" | "allowed" | "required",
		pushStatus,
		hasOwnedChanges: stageablePaths.length > 0,
		commitSha,
	});
	if (!admission.pass)
		return markAttention(session, closeout.id, admission.reasons.join(","));
	if (
		task.status !== "completed" ||
		!["completed", "archiving"].includes(session.phase)
	) {
		const now = new Date();
		await db.transaction(async (tx) => {
			const [completedTask] = await tx
				.update(tasks)
				.set({ status: "completed", completedAt: now, updatedAt: now })
				.where(and(eq(tasks.id, task.id), eq(tasks.status, task.status)))
				.returning({ id: tasks.id });
			const [completedSession] = await tx
				.update(missionPilotSessions)
				.set({ phase: "completed", updatedAt: now })
				.where(
					and(
						eq(missionPilotSessions.id, session.id),
						eq(missionPilotSessions.desiredState, "playing"),
						eq(missionPilotSessions.contextDigest, session.contextDigest),
						eq(missionPilotSessions.activeCloseoutId, closeout.id),
					),
				)
				.returning({ id: missionPilotSessions.id });
			if (!completedTask || !completedSession)
				throw new Error("Mission Pilot completion admission changed");
		});
	}
	await consumeMissionPilotCloseoutAdmission(closeoutAdmission.id);
	await appendMissionPilotEvent({
		sessionId: session.id,
		taskId: session.taskId,
		eventType: "task.completed",
		phase: "completed",
		contextRevision: session.contextRevision,
		contextDigest: session.contextDigest,
		dedupeKey: `task:completed:${closeout.id}`,
		sourceKind: "git",
		sourceId: closeout.id,
		payload: { commitSha, pushStatus },
	});
	if (session.phase !== "archiving") {
		const [claimed] = await db
			.update(missionPilotSessions)
			.set({ phase: "archiving", updatedAt: new Date() })
			.where(
				and(
					eq(missionPilotSessions.id, session.id),
					eq(missionPilotSessions.phase, "completed"),
					eq(missionPilotSessions.activeCloseoutId, closeout.id),
				),
			)
			.returning({ id: missionPilotSessions.id });
		if (!claimed) {
			const [currentSession] = await db
				.select({ phase: missionPilotSessions.phase })
				.from(missionPilotSessions)
				.where(eq(missionPilotSessions.id, session.id))
				.limit(1);
			if (
				!currentSession ||
				!["archiving", "archived"].includes(currentSession.phase)
			)
				throw new Error("Mission Pilot archive admission changed");
		}
	}
	const archived = await archiveCompletedTask({
		taskId: task.id,
		reason: "mission_pilot_completed",
		missionPilotSessionId: session.id,
		sourceRunId: null,
		evidence: {
			verificationSnapshotId: snapshot.id,
			reviewDecisionId: reviewDecision.id,
			closeoutId: closeout.id,
			commitSha,
		},
	});
	const finalContext = await appendFinalMissionPilotContext({
		sessionId: session.id,
		closeoutId: closeout.id,
		commitSha,
		pushStatus,
		archiveRecordId: archived.archiveRecord?.id ?? null,
	});
	await appendMissionPilotEvent({
		sessionId: session.id,
		taskId: session.taskId,
		eventType: "task.archived",
		phase: "archived",
		contextRevision: finalContext.revision,
		contextDigest: finalContext.digest,
		dedupeKey: `task:archived:${archived.archiveRecord?.id}`,
		sourceKind: "task_archive",
		sourceId: archived.archiveRecord?.id ?? null,
		payload: { closeoutId: closeout.id },
	});
	return {
		status: "archived",
		commitSha,
		pushStatus,
		archiveRecord: archived.archiveRecord,
	} as const;
}

async function finalizeArchivedCloseout(input: {
	session: typeof missionPilotSessions.$inferSelect;
	archiveRecord: typeof taskArchiveRecords.$inferSelect;
}) {
	if (input.session.phase !== "archived") {
		await db
			.update(missionPilotSessions)
			.set({
				phase: "archived",
				desiredState: "stopped",
				activeRunId: null,
				activePhaseRunId: null,
				stoppedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(missionPilotSessions.id, input.session.id));
	}
	const [closeout] = input.session.activeCloseoutId
		? await db
				.select()
				.from(missionPilotCloseouts)
				.where(eq(missionPilotCloseouts.id, input.session.activeCloseoutId))
				.limit(1)
		: [];
	const finalContext = await appendFinalMissionPilotContext({
		sessionId: input.session.id,
		closeoutId: input.session.activeCloseoutId,
		commitSha: closeout?.commitSha ?? null,
		pushStatus: closeout?.pushStatus ?? null,
		archiveRecordId: input.archiveRecord.id,
	});
	await appendMissionPilotEvent({
		sessionId: input.session.id,
		taskId: input.session.taskId,
		eventType: "task.archived",
		phase: "archived",
		contextRevision: finalContext.revision,
		contextDigest: finalContext.digest,
		dedupeKey: `task:archived:${input.archiveRecord.id}`,
		sourceKind: "task_archive",
		sourceId: input.archiveRecord.id,
		payload: { closeoutId: input.session.activeCloseoutId },
	});
	return {
		status: "archived",
		commitSha: closeout?.commitSha ?? null,
		pushStatus: closeout?.pushStatus ?? "skipped",
		archiveRecord: input.archiveRecord,
		contextRevision: finalContext.revision,
	} as const;
}

async function invalidateEvidenceAfterHookMutation(input: {
	session: typeof missionPilotSessions.$inferSelect;
	closeoutId: string;
	commitSha: string;
	mutationPaths: string[];
	reviewedTree: string;
	committedTree: string;
}) {
	const implementationCycle = input.session.implementationCycle + 1;
	const totalCorrectionCycle = input.session.totalCorrectionCycle + 1;
	if (implementationCycle > 3 || totalCorrectionCycle > 5)
		return markAttention(
			input.session,
			input.closeoutId,
			"CORRECTION_CYCLE_LIMIT",
		);
	const [latestContext] = await db
		.select()
		.from(missionPilotContextSnapshots)
		.where(eq(missionPilotContextSnapshots.sessionId, input.session.id))
		.orderBy(desc(missionPilotContextSnapshots.revision))
		.limit(1);
	if (!latestContext)
		return markAttention(
			input.session,
			input.closeoutId,
			"CONTEXT_SNAPSHOT_MISSING",
		);
	const execution = readRecord(latestContext.contextJson.execution);
	const invalidatedEvidence = {
		verificationSnapshotId: input.session.activeVerificationSnapshotId,
		reviewDecisionId: input.session.activeReviewDecisionId,
		closeoutId: input.closeoutId,
		reason: "commit_hook_mutation",
		commitSha: input.commitSha,
		mutationPaths: input.mutationPaths,
		reviewedTree: input.reviewedTree,
		committedTree: input.committedTree,
	};
	const nextContext = {
		...latestContext.contextJson,
		execution: {
			...execution,
			verification: undefined,
			review: undefined,
			closeout: undefined,
			pendingRework: invalidatedEvidence,
			invalidatedEvidence: [
				...readArray(execution.invalidatedEvidence),
				invalidatedEvidence,
			],
		},
	};
	const revision = input.session.contextRevision + 1;
	const digest = digestText(JSON.stringify(nextContext));
	const now = new Date();
	await db.transaction(async (tx) => {
		const [updatedSession] = await tx
			.update(missionPilotSessions)
			.set({
				phase: "implementation_rework",
				implementationCycle,
				totalCorrectionCycle,
				contextRevision: revision,
				contextDigest: digest,
				activeRunId: null,
				activePhaseRunId: null,
				activeVerificationSnapshotId: null,
				activeReviewDecisionId: null,
				activeCloseoutId: null,
				updatedAt: now,
			})
			.where(
				and(
					eq(missionPilotSessions.id, input.session.id),
					eq(missionPilotSessions.desiredState, "playing"),
					eq(missionPilotSessions.contextDigest, input.session.contextDigest),
					eq(missionPilotSessions.activeCloseoutId, input.closeoutId),
				),
			)
			.returning({ id: missionPilotSessions.id });
		if (!updatedSession)
			throw new Error("Mission Pilot hook mutation admission changed");
		const [invalidatedCloseout] = await tx
			.update(missionPilotCloseouts)
			.set({
				status: "invalidated",
				statusReason: "COMMIT_HOOK_MUTATION",
				updatedAt: now,
			})
			.where(
				and(
					eq(missionPilotCloseouts.id, input.closeoutId),
					eq(missionPilotCloseouts.status, "committed"),
				),
			)
			.returning({ id: missionPilotCloseouts.id });
		if (!invalidatedCloseout)
			throw new Error("Mission Pilot closeout invalidation changed");
		await tx.insert(missionPilotContextSnapshots).values({
			id: crypto.randomUUID(),
			sessionId: input.session.id,
			revision,
			reason: "commit_hook_mutation",
			contextJson: nextContext,
			digest,
			tokenEstimate: Math.ceil(JSON.stringify(nextContext).length / 4),
			createdAt: now,
		});
	});
	await appendMissionPilotEvent({
		sessionId: input.session.id,
		taskId: input.session.taskId,
		eventType: "mission_pilot.evidence_invalidated",
		phase: "implementation_rework",
		cycle: implementationCycle,
		contextRevision: revision,
		contextDigest: digest,
		dedupeKey: `closeout:${input.closeoutId}:hook-mutation`,
		sourceKind: "git",
		sourceId: input.commitSha,
		payload: invalidatedEvidence,
	});
	return {
		status: "rework_required",
		input: {
			taskId: input.session.taskId,
			missionPilot: {
				sessionId: input.session.id,
				cycle: implementationCycle,
				contextRevision: revision,
				contextDigest: digest,
				reworkPacket: invalidatedEvidence,
			},
		},
	} as const;
}
