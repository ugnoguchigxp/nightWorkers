import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/client";
import {
	missionPilotEvents,
	missionPilotPhaseRuns,
	missionPilotSessions,
} from "../../db/mission-pilot-schema";
import {
	implementationQueueEntries,
	type TaskRunStatus,
	type TaskStatus,
	taskGitWorkspaces,
	taskRunCommitRecords,
	taskRuns,
	taskRunTodos,
	tasks,
} from "../../db/schema";
import { logger } from "../../lib/logger";
import { listRepositoryWorktrees } from "../gitworktree/gitworktree.service";
import {
	applyMissionPilotTaskStatusAfterRun,
	readMissionPilotAgentRunProvenance,
	resolveMissionPilotTaskStatusAfterRun,
} from "../nightworkers/run-orchestration/task-status-projection-policy";
import { resolveMissionPilotRuntimeOwnership } from "./agent/mission-pilot-runtime-ownership.service";
import {
	continueAfterReviewRun,
	readRecord,
	setMissionPilotAttention,
} from "./mission-pilot-post-queue-review.service";
import { evaluateImplementationCompletionGate } from "./mission-pilot-post-queue-state";
import { finalizeImplementationVerification } from "./mission-pilot-verification-snapshot.service";

export async function resolveMissionPilotParentTaskStatus(input: {
	runId: string;
	runStatus: TaskRunStatus;
	executionMode: string;
}): Promise<TaskStatus> {
	const [runForOwnership] = await db
		.select({
			taskId: taskRuns.taskId,
			contextSnapshot: taskRuns.contextSnapshot,
		})
		.from(taskRuns)
		.where(eq(taskRuns.id, input.runId))
		.limit(1);
	if (
		readMissionPilotAgentRunProvenance(
			readRecord(runForOwnership?.contextSnapshot).missionPilotAgent,
		)
	)
		return resolveMissionPilotTaskStatusAfterRun({
			taskId: runForOwnership.taskId,
			runId: input.runId,
			runStatus: input.runStatus,
		});
	const [phaseRun] = await db
		.select()
		.from(missionPilotPhaseRuns)
		.where(eq(missionPilotPhaseRuns.runId, input.runId))
		.limit(1);
	if (!phaseRun) return input.runStatus;
	if (!["completed", "needs_review"].includes(input.runStatus))
		return input.runStatus;
	if (phaseRun.phase === "repository_bootstrap") return "queued";
	if (input.executionMode === "implementation") return "verifying";
	return "needs_review";
}

export async function applyMissionPilotParentTaskStatus(input: {
	runId: string;
	runStatus: TaskRunStatus;
	executionMode: string;
}) {
	const [runForOwnership] = await db
		.select({
			taskId: taskRuns.taskId,
			contextSnapshot: taskRuns.contextSnapshot,
		})
		.from(taskRuns)
		.where(eq(taskRuns.id, input.runId))
		.limit(1);
	if (
		runForOwnership &&
		readMissionPilotAgentRunProvenance(
			readRecord(runForOwnership.contextSnapshot).missionPilotAgent,
		)
	) {
		const task = await applyMissionPilotTaskStatusAfterRun({
			taskId: runForOwnership.taskId,
			runId: input.runId,
			runStatus: input.runStatus,
		});
		return { handled: true as const, status: task?.status ?? input.runStatus };
	}
	return {
		handled: false as const,
		status: await resolveMissionPilotParentTaskStatus(input),
	};
}

export async function releaseMissionPilotQueueHandoff(taskId: string) {
	if ((await resolveMissionPilotRuntimeOwnership({ taskId })).kind === "agent")
		return null;
	const now = new Date();
	const released = await db.transaction(async (tx) => {
		const [session] = await tx
			.select()
			.from(missionPilotSessions)
			.where(eq(missionPilotSessions.taskId, taskId))
			.limit(1);
		const handoff = session?.queueHandoffJson;
		if (
			!session ||
			!handoff ||
			session.desiredState !== "playing" ||
			session.phase !== "queued" ||
			handoff.reviewedContextRevision !== session.contextRevision ||
			handoff.reviewedContextDigest !== session.contextDigest
		)
			return null;
		const [entry] = await tx
			.select()
			.from(implementationQueueEntries)
			.where(eq(implementationQueueEntries.id, handoff.queueEntryId))
			.limit(1);
		if (entry?.status !== "queued") return null;
		if (entry.workspaceRequired) {
			if (!entry.workspaceId) return null;
			const [workspace] = await tx
				.select()
				.from(taskGitWorkspaces)
				.where(eq(taskGitWorkspaces.id, entry.workspaceId))
				.limit(1);
			if (!workspace || !["ready", "active"].includes(workspace.status))
				return null;
			const [task] = await tx
				.select({ worktreePath: tasks.worktreePath })
				.from(tasks)
				.where(eq(tasks.id, taskId))
				.limit(1);
			if (
				!workspace.worktreePath ||
				!workspace.worktreeId ||
				!workspace.targetBaseSha ||
				!workspace.expectedHeadSha ||
				task?.worktreePath !== workspace.worktreePath
			)
				return null;
			const actual = (
				await listRepositoryWorktrees(entry.repositoryId)
			).worktrees.find((item) => item.id === workspace.worktreeId);
			if (
				!actual ||
				actual.canonicalPath !== workspace.worktreePath ||
				actual.branch !== workspace.sourceBranch ||
				actual.head !== workspace.expectedHeadSha
			)
				return null;
		}
		if (!entry.claimReady) {
			await tx
				.update(implementationQueueEntries)
				.set({ claimReady: true, updatedAt: now })
				.where(
					and(
						eq(implementationQueueEntries.id, entry.id),
						eq(implementationQueueEntries.claimReady, false),
					),
				);
		}
		await tx
			.insert(missionPilotEvents)
			.values({
				id: crypto.randomUUID(),
				sessionId: session.id,
				taskId: session.taskId,
				eventType: "queue.handoff_released",
				phase: "implementation_starting",
				cycle: session.implementationCycle,
				contextRevision: session.contextRevision,
				contextDigest: session.contextDigest,
				dedupeKey: `queue:released:${entry.id}`,
				sourceKind: "queue",
				sourceId: entry.id,
				payloadJson: { admissionKey: handoff.admissionKey },
				processStatus: "processed",
				attemptCount: 0,
				availableAt: now,
				processedAt: now,
				createdAt: now,
				updatedAt: now,
			})
			.onConflictDoNothing({
				target: [missionPilotEvents.sessionId, missionPilotEvents.dedupeKey],
			});
		await tx
			.update(missionPilotSessions)
			.set({ phase: "implementation_starting", updatedAt: now })
			.where(eq(missionPilotSessions.id, session.id));
		return entry.id;
	});
	if (released) {
		const { runImplementationQueue } = await import(
			"../nightworkers/nightworkers.run-orchestration.service"
		);
		void runImplementationQueue().catch((error) => {
			logger.error({ error, taskId }, "Mission Pilot queue release failed");
		});
	}
	return released;
}

export async function continueMissionPilotAfterRun(input: {
	taskId: string;
	runId: string;
	executionMode: string;
	runStatus?: TaskStatus;
}) {
	if (
		(await resolveMissionPilotRuntimeOwnership({ taskId: input.taskId }))
			.kind === "agent"
	)
		return { kind: "agent_owned" } as const;
	const [phaseRun] = await db
		.select()
		.from(missionPilotPhaseRuns)
		.where(eq(missionPilotPhaseRuns.runId, input.runId))
		.limit(1);
	if (!phaseRun) return { kind: "not_mission_pilot" } as const;
	const [session] = await db
		.select()
		.from(missionPilotSessions)
		.where(eq(missionPilotSessions.id, phaseRun.sessionId))
		.limit(1);
	if (
		session &&
		(await resolveMissionPilotRuntimeOwnership({ sessionId: session.id }))
			.kind === "agent"
	)
		return { kind: "agent_owned" } as const;
	if (session?.desiredState !== "playing") return { kind: "paused" } as const;
	if (phaseRun.phase === "repository_bootstrap") {
		const { completeMissionPilotRepositoryBootstrap } = await import(
			"./mission-pilot-repository-bootstrap.service"
		);
		return completeMissionPilotRepositoryBootstrap({
			phaseRun,
			session,
			runId: input.runId,
		});
	}
	if (phaseRun.phase === "review" || input.executionMode === "review") {
		return continueAfterReviewRun({ session, phaseRun, runId: input.runId });
	}
	if (input.executionMode !== "implementation") {
		return { kind: "awaiting_domain_gate", phase: phaseRun.phase } as const;
	}
	const [run] = await db
		.select()
		.from(taskRuns)
		.where(eq(taskRuns.id, input.runId))
		.limit(1);
	const todos = await db
		.select()
		.from(taskRunTodos)
		.where(eq(taskRunTodos.runId, input.runId));
	const [commitRecord] = await db
		.select()
		.from(taskRunCommitRecords)
		.where(eq(taskRunCommitRecords.runId, input.runId))
		.limit(1);
	const gate = evaluateImplementationCompletionGate({
		runStatus: input.runStatus ?? run?.status ?? "missing",
		terminalReason: null,
		openTodoCount: todos.filter((todo) =>
			["pending", "running"].includes(todo.status),
		).length,
		securityAllowed:
			(input.runStatus ?? run?.status) === "completed" ||
			(input.runStatus ?? run?.status) === "needs_review",
		hasOwnershipEvidence: Boolean(commitRecord),
		hasDiffOrNoopEvidence: Boolean(
			run?.diffPatch ||
				commitRecord?.ownedCandidatePathsJson ||
				commitRecord?.status === "ready",
		),
		hasFinalReport: Boolean(run?.finalReport || run?.summary),
		contextDigestMatches: phaseRun.inputContextDigest === session.contextDigest,
	});
	if (!gate.pass) {
		await setMissionPilotAttention(
			session.id,
			phaseRun.id,
			gate.reasons.join(","),
		);
		return { kind: "attention", reasons: gate.reasons } as const;
	}
	const changedPaths = commitRecord?.ownedCandidatePathsJson ?? [];
	return finalizeImplementationVerification({
		session,
		phaseRun,
		runId: input.runId,
		changedPaths,
	});
}
