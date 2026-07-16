import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "../../db/client";
import type { ImplementationQueueEntryStatus } from "../../db/schema";
import { implementationQueueEntries } from "../../db/schema";

import {
	type ClaimImplementationQueueResult,
	type ClaimNextImplementationQueueEntryInput,
	type ClaimSkipEvidence,
	LOCK_ACTIVE_STATUSES,
	normalizeExecutionType,
	OCCUPIED_PROCESSOR_STATUSES,
	QUEUE_COMPLETION_SOURCE_STATUSES,
	type QueueDb,
	type QueueSchedulingBlockedReason,
	type QueueSchedulingLockState,
	queueStatusForRunStatus,
	resolveImplementationQueueExecutionLockKey,
	SEQUENCE_TERMINAL_BLOCKER_STATUSES,
	type TaskExecutionType,
} from "./queue-repository-row-mapper";
import { workspaceClaimSkipEvidence } from "./queue-workspace-claim-gate";

export async function createImplementationQueueEntry(
	data: {
		taskId: string;
		repositoryId: string;
		priority?: number;
		queuePosition?: number | null;
		executionType?: TaskExecutionType;
		executionLockKey?: string | null;
		sequenceGroupId?: string | null;
		sequenceOrder?: number | null;
		sequenceDependsOnEntryId?: string | null;
		schedulingReason?: string | null;
		missionPilotAdmissionKey?: string | null;
		missionPilotAgent?:
			| import("../../../shared/schemas/mission-pilot-agent.schema").MissionPilotAgentRunProvenance
			| null;
		claimReady?: boolean;
	},
	database: QueueDb = db,
) {
	const now = new Date();
	const executionType = data.executionType ?? "normal";
	const [entry] = await database
		.insert(implementationQueueEntries)
		.values({
			taskId: data.taskId,
			repositoryId: data.repositoryId,
			priority: data.priority ?? 0,
			queuePosition: data.queuePosition ?? null,
			executionType,
			executionLockKey:
				data.executionLockKey ??
				resolveImplementationQueueExecutionLockKey(data),
			sequenceGroupId:
				executionType === "sequence" ? (data.sequenceGroupId ?? null) : null,
			sequenceOrder:
				executionType === "sequence" ? (data.sequenceOrder ?? null) : null,
			sequenceDependsOnEntryId:
				executionType === "sequence"
					? (data.sequenceDependsOnEntryId ?? null)
					: null,
			schedulingReason: data.schedulingReason ?? null,
			missionPilotAdmissionKey: data.missionPilotAdmissionKey ?? null,
			missionPilotAgentJson: data.missionPilotAgent ?? null,
			claimReady: data.claimReady ?? true,
			status: "queued",
			createdAt: now,
			updatedAt: now,
		})
		.returning();
	return entry;
}

export async function updateImplementationQueueEntry(
	id: string,
	data: {
		status?: ImplementationQueueEntryStatus;
		priority?: number;
		queuePosition?: number | null;
		processorSlot?: number | null;
		activeRunId?: string | null;
		claimedAt?: Date | null;
		lastHeartbeatAt?: Date | null;
		archivedAt?: Date | null;
		statusReason?: string | null;
		leaseOwnerId?: string | null;
		leaseAcquiredAt?: Date | null;
		leaseExpiresAt?: Date | null;
		leaseVersion?: number;
		attemptCount?: number;
		recoveredAt?: Date | null;
		recoveryReason?: string | null;
		lastFailureKind?: string | null;
		executionType?: TaskExecutionType;
		executionLockKey?: string | null;
		sequenceGroupId?: string | null;
		sequenceOrder?: number | null;
		sequenceDependsOnEntryId?: string | null;
		schedulingReason?: string | null;
	},
) {
	const [entry] = await db
		.update(implementationQueueEntries)
		.set({ ...data, updatedAt: new Date() })
		.where(eq(implementationQueueEntries.id, id))
		.returning();
	return entry;
}

export async function recoverImplementationQueueEntryFromSnapshot(
	id: string,
	expected: { status: ImplementationQueueEntryStatus; leaseVersion: number },
	data: {
		status?: ImplementationQueueEntryStatus;
		priority?: number;
		queuePosition?: number | null;
		processorSlot?: number | null;
		activeRunId?: string | null;
		claimedAt?: Date | null;
		lastHeartbeatAt?: Date | null;
		archivedAt?: Date | null;
		statusReason?: string | null;
		leaseOwnerId?: string | null;
		leaseAcquiredAt?: Date | null;
		leaseExpiresAt?: Date | null;
		leaseVersion?: number;
		attemptCount?: number;
		recoveredAt?: Date | null;
		recoveryReason?: string | null;
		lastFailureKind?: string | null;
	},
) {
	const [entry] = await db
		.update(implementationQueueEntries)
		.set({
			...data,
			leaseVersion: sql`${implementationQueueEntries.leaseVersion} + 1`,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(implementationQueueEntries.id, id),
				eq(implementationQueueEntries.status, expected.status),
				eq(implementationQueueEntries.leaseVersion, expected.leaseVersion),
			),
		)
		.returning();
	return entry ?? null;
}

export async function getImplementationQueueEntry(id: string) {
	const [entry] = await db
		.select()
		.from(implementationQueueEntries)
		.where(eq(implementationQueueEntries.id, id));
	return entry;
}

export async function getImplementationQueueEntryForRun(runId: string) {
	const [entry] = await db
		.select()
		.from(implementationQueueEntries)
		.where(eq(implementationQueueEntries.activeRunId, runId));
	return entry;
}

export async function markImplementationQueueEntryProcessing(input: {
	entryId: string;
	runId: string;
	leaseOwnerId: string;
	leaseVersion: number;
	leaseTtlMs: number;
	now?: Date;
}) {
	const now = input.now ?? new Date();
	const [entry] = await db
		.update(implementationQueueEntries)
		.set({
			status: "processing",
			activeRunId: input.runId,
			lastHeartbeatAt: now,
			leaseExpiresAt: new Date(now.getTime() + input.leaseTtlMs),
			leaseVersion: sql`${implementationQueueEntries.leaseVersion} + 1`,
			updatedAt: now,
		})
		.where(
			and(
				eq(implementationQueueEntries.id, input.entryId),
				eq(implementationQueueEntries.status, "claimed"),
				eq(implementationQueueEntries.leaseOwnerId, input.leaseOwnerId),
				eq(implementationQueueEntries.leaseVersion, input.leaseVersion),
			),
		)
		.returning();
	return entry ?? null;
}

export async function refreshImplementationQueueLease(input: {
	entryId: string;
	leaseOwnerId: string;
	leaseVersion: number;
	leaseTtlMs: number;
	now?: Date;
}) {
	const now = input.now ?? new Date();
	const [entry] = await db
		.update(implementationQueueEntries)
		.set({
			lastHeartbeatAt: now,
			leaseExpiresAt: new Date(now.getTime() + input.leaseTtlMs),
			leaseVersion: sql`${implementationQueueEntries.leaseVersion} + 1`,
			updatedAt: now,
		})
		.where(
			and(
				eq(implementationQueueEntries.id, input.entryId),
				eq(implementationQueueEntries.leaseOwnerId, input.leaseOwnerId),
				eq(implementationQueueEntries.leaseVersion, input.leaseVersion),
				inArray(implementationQueueEntries.status, ["claimed", "processing"]),
			),
		)
		.returning();
	return entry ?? null;
}

export async function refreshImplementationQueueLeaseForRun(input: {
	runId: string;
	leaseTtlMs: number;
	now?: Date;
}) {
	const now = input.now ?? new Date();
	const [entry] = await db
		.update(implementationQueueEntries)
		.set({
			lastHeartbeatAt: now,
			leaseExpiresAt: new Date(now.getTime() + input.leaseTtlMs),
			leaseVersion: sql`${implementationQueueEntries.leaseVersion} + 1`,
			updatedAt: now,
		})
		.where(
			and(
				eq(implementationQueueEntries.activeRunId, input.runId),
				eq(implementationQueueEntries.status, "processing"),
			),
		)
		.returning();
	return entry ?? null;
}

export async function completeImplementationQueueEntryForRunId(input: {
	runId: string;
	runStatus: string;
	now?: Date;
}) {
	const now = input.now ?? new Date();
	const nextStatus = queueStatusForRunStatus(input.runStatus);
	const [entry] = await db
		.update(implementationQueueEntries)
		.set({
			status: nextStatus,
			processorSlot: null,
			leaseOwnerId: null,
			leaseAcquiredAt: null,
			leaseExpiresAt: null,
			activeRunId: input.runId,
			lastHeartbeatAt: now,
			statusReason:
				nextStatus === "failed"
					? `Run finished with status=${input.runStatus}`
					: null,
			leaseVersion: sql`${implementationQueueEntries.leaseVersion} + 1`,
			updatedAt: now,
		})
		.where(
			and(
				eq(implementationQueueEntries.activeRunId, input.runId),
				inArray(implementationQueueEntries.status, [
					...QUEUE_COMPLETION_SOURCE_STATUSES,
				]),
			),
		)
		.returning();
	return entry ?? null;
}

async function resolveSequenceReadiness(
	tx: QueueDb,
	candidate: typeof implementationQueueEntries.$inferSelect,
): Promise<{ ready: boolean; reason: QueueSchedulingBlockedReason }> {
	if (normalizeExecutionType(candidate.executionType) !== "sequence") {
		return { ready: true, reason: "none" };
	}
	const sequenceOrder = candidate.sequenceOrder;
	if (!candidate.sequenceGroupId || sequenceOrder === null) {
		return { ready: false, reason: "sequence_order_conflict" };
	}
	const peers = await tx
		.select()
		.from(implementationQueueEntries)
		.where(
			eq(implementationQueueEntries.sequenceGroupId, candidate.sequenceGroupId),
		);
	const sameOrder = peers.filter(
		(entry) => entry.sequenceOrder === sequenceOrder,
	);
	if (sameOrder.length > 1)
		return { ready: false, reason: "sequence_order_conflict" };
	if (sequenceOrder <= 1) return { ready: true, reason: "none" };

	const predecessor = peers.find(
		(entry) => entry.sequenceOrder === sequenceOrder - 1,
	);
	if (!predecessor)
		return { ready: false, reason: "sequence_predecessor_pending" };
	if (predecessor.status === "execution_completed")
		return { ready: true, reason: "none" };
	if (
		(SEQUENCE_TERMINAL_BLOCKER_STATUSES as readonly string[]).includes(
			predecessor.status,
		)
	) {
		return { ready: false, reason: "sequence_predecessor_failed" };
	}
	return { ready: false, reason: "sequence_predecessor_pending" };
}

async function resolveSchedulingLockState(
	tx: QueueDb,
	lockKey: string,
	repositoryId: string,
	candidateId: string,
): Promise<QueueSchedulingLockState> {
	const defaultRepositoryLockKey = `repository:${repositoryId}`;
	const rows = await tx
		.select()
		.from(implementationQueueEntries)
		.where(
			lockKey === defaultRepositoryLockKey
				? or(
						eq(implementationQueueEntries.executionLockKey, lockKey),
						and(
							eq(implementationQueueEntries.repositoryId, repositoryId),
							isNull(implementationQueueEntries.executionLockKey),
						),
					)
				: eq(implementationQueueEntries.executionLockKey, lockKey),
		);
	const active = rows.filter(
		(entry) =>
			entry.id !== candidateId &&
			(LOCK_ACTIVE_STATUSES as readonly string[]).includes(entry.status),
	);
	const readyNonNormal = [];
	for (const entry of rows) {
		if (entry.id === candidateId) continue;
		if (entry.status !== "queued") continue;
		if (!entry.claimReady) continue;
		if (normalizeExecutionType(entry.executionType) === "normal") continue;
		const sequenceReadiness = await resolveSequenceReadiness(tx, entry);
		if (sequenceReadiness.ready) readyNonNormal.push(entry);
	}
	return {
		activeCount: active.length,
		activeNonNormalCount: active.filter(
			(entry) => normalizeExecutionType(entry.executionType) !== "normal",
		).length,
		readyNonNormalCount: readyNonNormal.length,
		activeEntryIds: active.map((entry) => entry.id),
		readyNonNormalEntryIds: readyNonNormal.map((entry) => entry.id),
	};
}

function canClaimCandidate(
	candidate: typeof implementationQueueEntries.$inferSelect,
	sequenceState: { ready: boolean; reason: QueueSchedulingBlockedReason },
	lockState: QueueSchedulingLockState,
): { claimable: boolean; reason: QueueSchedulingBlockedReason } {
	const executionType = normalizeExecutionType(candidate.executionType);
	if (!candidate.claimReady)
		return { claimable: false, reason: "claim_not_ready" };
	if (!sequenceState.ready)
		return { claimable: false, reason: sequenceState.reason };
	if (executionType !== "normal" && lockState.activeCount > 0) {
		return { claimable: false, reason: "exclusive_waiting_for_active_tasks" };
	}
	if (executionType === "normal" && lockState.readyNonNormalCount > 0) {
		return { claimable: false, reason: "normal_blocked_by_ready_non_normal" };
	}
	if (executionType === "normal" && lockState.activeNonNormalCount > 0) {
		return { claimable: false, reason: "normal_blocked_by_active_non_normal" };
	}
	return { claimable: true, reason: "none" };
}

export async function getImplementationQueueEntrySchedulingHealth(
	entry: typeof implementationQueueEntries.$inferSelect,
) {
	const executionType = normalizeExecutionType(entry.executionType);
	const executionLockKey = resolveImplementationQueueExecutionLockKey(entry);
	const sequenceState = await resolveSequenceReadiness(db, entry);
	const lockState = await resolveSchedulingLockState(
		db,
		executionLockKey,
		entry.repositoryId,
		entry.id,
	);
	const decision = canClaimCandidate(entry, sequenceState, lockState);
	const hasActiveNonNormal = lockState.activeNonNormalCount > 0;
	const hasActiveNormal = lockState.activeCount > 0 && !hasActiveNonNormal;
	const lockStateLabel =
		executionType === "normal" && lockState.readyNonNormalCount > 0
			? "draining_for_non_normal"
			: hasActiveNonNormal
				? "active_exclusive"
				: hasActiveNormal
					? "active_normal"
					: "free";
	return {
		executionType,
		executionLockKey,
		lockState: lockStateLabel as
			| "free"
			| "active_normal"
			| "active_exclusive"
			| "draining_for_non_normal",
		sequenceGroupId: entry.sequenceGroupId ?? null,
		sequenceOrder: entry.sequenceOrder ?? null,
		schedulingBlockedReason:
			entry.status === "queued" && !decision.claimable
				? decision.reason === "cas_lost"
					? "candidate_window_exhausted"
					: decision.reason
				: "none",
		activeEntryIds: lockState.activeEntryIds,
		readyNonNormalEntryIds: lockState.readyNonNormalEntryIds,
	};
}

export async function claimNextImplementationQueueEntry(
	input: ClaimNextImplementationQueueEntryInput,
): Promise<ClaimImplementationQueueResult> {
	const now = input.now ?? new Date();
	const processorCount = Math.max(1, Math.floor(input.processorCount));
	const leaseExpiresAt = new Date(now.getTime() + input.leaseTtlMs);
	const candidateLimit =
		input.candidateLimit ?? Math.max(processorCount * 4, 20);

	return db.transaction(async (tx) => {
		const occupied = (
			await tx
				.select()
				.from(implementationQueueEntries)
				.where(
					inArray(implementationQueueEntries.status, [
						...OCCUPIED_PROCESSOR_STATUSES,
					]),
				)
		).filter((entry) => {
			if (
				input.allowExpiredClaimRecovery &&
				entry.status === "claimed" &&
				entry.leaseExpiresAt &&
				entry.leaseExpiresAt < now &&
				!entry.activeRunId
			) {
				return false;
			}
			return true;
		});
		if (occupied.length >= processorCount) {
			return { kind: "not_claimed", reason: "processor_full", skipped: [] };
		}
		const occupiedSlots = new Set(
			occupied.map((entry) => entry.processorSlot).filter(Boolean),
		);
		const processorSlot =
			Array.from({ length: processorCount }, (_value, index) => index + 1).find(
				(slot) => !occupiedSlots.has(slot),
			) ?? 1;

		const candidates = await tx
			.select()
			.from(implementationQueueEntries)
			.where(
				input.allowExpiredClaimRecovery
					? or(
							and(
								eq(implementationQueueEntries.status, "queued"),
								eq(implementationQueueEntries.claimReady, true),
							),
							and(
								eq(implementationQueueEntries.status, "claimed"),
								lt(implementationQueueEntries.leaseExpiresAt, now),
								isNull(implementationQueueEntries.activeRunId),
							),
						)
					: and(
							eq(implementationQueueEntries.status, "queued"),
							eq(implementationQueueEntries.claimReady, true),
						),
			)
			.orderBy(
				desc(implementationQueueEntries.priority),
				asc(implementationQueueEntries.queuePosition),
				asc(implementationQueueEntries.createdAt),
			)
			.limit(candidateLimit);
		const skipped: ClaimSkipEvidence[] = [];
		if (candidates.length === 0)
			return { kind: "not_claimed", reason: "empty", skipped };

		for (const candidate of candidates) {
			const workspaceSkip = await workspaceClaimSkipEvidence(tx, candidate);
			if (workspaceSkip) {
				skipped.push(workspaceSkip);
				continue;
			}
			const lockKey = resolveImplementationQueueExecutionLockKey(candidate);
			const sequenceState = await resolveSequenceReadiness(tx, candidate);
			const lockState = await resolveSchedulingLockState(
				tx,
				lockKey,
				candidate.repositoryId,
				candidate.id,
			);
			const decision = canClaimCandidate(candidate, sequenceState, lockState);
			const executionType = normalizeExecutionType(candidate.executionType);
			if (!decision.claimable) {
				skipped.push({
					entryId: candidate.id,
					reason: decision.reason,
					executionType,
					lockKey,
					activeEntryIds: lockState.activeEntryIds,
					readyNonNormalEntryIds: lockState.readyNonNormalEntryIds,
				});
				continue;
			}

			const isExpiredClaimRecovery = candidate.status === "claimed";
			const claimPredicate = isExpiredClaimRecovery
				? and(
						eq(implementationQueueEntries.id, candidate.id),
						eq(implementationQueueEntries.status, "claimed"),
						eq(implementationQueueEntries.leaseVersion, candidate.leaseVersion),
						lt(implementationQueueEntries.leaseExpiresAt, now),
						isNull(implementationQueueEntries.activeRunId),
					)
				: and(
						eq(implementationQueueEntries.id, candidate.id),
						eq(implementationQueueEntries.status, "queued"),
						eq(implementationQueueEntries.claimReady, true),
					);
			const [claimed] = await tx
				.update(implementationQueueEntries)
				.set({
					status: "claimed",
					processorSlot,
					leaseOwnerId: input.leaseOwnerId,
					leaseAcquiredAt: now,
					leaseExpiresAt,
					executionLockKey: lockKey,
					leaseVersion: sql`${implementationQueueEntries.leaseVersion} + 1`,
					attemptCount: sql`${implementationQueueEntries.attemptCount} + 1`,
					claimedAt: now,
					lastHeartbeatAt: now,
					recoveredAt: isExpiredClaimRecovery ? now : candidate.recoveredAt,
					recoveryReason: isExpiredClaimRecovery
						? "lease_expired_before_run_start"
						: candidate.recoveryReason,
					updatedAt: now,
				})
				.where(claimPredicate)
				.returning();
			if (claimed) return { kind: "claimed", entry: claimed };
			skipped.push({
				entryId: candidate.id,
				reason: "cas_lost",
				executionType,
				lockKey,
				activeEntryIds: lockState.activeEntryIds,
				readyNonNormalEntryIds: lockState.readyNonNormalEntryIds,
			});
		}

		const onlyCasLost =
			skipped.length > 0 &&
			skipped.every((entry) => entry.reason === "cas_lost");
		return {
			kind: "not_claimed",
			reason: onlyCasLost ? "cas_lost" : "blocked_by_lock",
			skipped,
		};
	});
}
