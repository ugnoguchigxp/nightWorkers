import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db/client";
import {
	implementationQueueEntries,
	implementationQueueSettings,
	repositories,
	taskRuns,
	tasks,
	todoWorkflowSettings,
} from "../../db/schema";

import {
	ACTIVE_IMPLEMENTATION_QUEUE_STATUSES,
	isRunningTaskRunStatus,
	OCCUPIED_PROCESSOR_STATUSES,
	type QueueDb,
} from "./queue-repository-row-mapper";

export async function getImplementationQueueSettings() {
	const [settings] = await db
		.select()
		.from(implementationQueueSettings)
		.where(eq(implementationQueueSettings.id, "global"));
	if (settings) return settings;
	const now = new Date();
	const [created] = await db
		.insert(implementationQueueSettings)
		.values({ id: "global", processorCount: 1, createdAt: now, updatedAt: now })
		.returning();
	return created;
}

export async function updateImplementationQueueSettings(data: {
	processorCount: number;
}) {
	const now = new Date();
	const processorCount = Math.min(
		3,
		Math.max(1, Math.floor(data.processorCount)),
	);
	const [settings] = await db
		.insert(implementationQueueSettings)
		.values({ id: "global", processorCount, createdAt: now, updatedAt: now })
		.onConflictDoUpdate({
			target: implementationQueueSettings.id,
			set: { processorCount, updatedAt: now },
		})
		.returning();
	return settings;
}

export async function getTodoWorkflowSettings() {
	const [settings] = await db
		.select()
		.from(todoWorkflowSettings)
		.where(eq(todoWorkflowSettings.id, "global"));
	if (settings) return settings;
	const now = new Date();
	const [created] = await db
		.insert(todoWorkflowSettings)
		.values({ id: "global", createdAt: now, updatedAt: now })
		.returning();
	return created;
}

export async function updateTodoWorkflowSettings(data: {
	requirePerTodoReview?: boolean;
	requirePerTodoFix?: boolean;
	requireFinalVerification?: boolean;
	requireRegisterCandidatePrompt?: boolean;
	askCommitOnCompletion?: boolean;
	hookPolicyJson?: unknown;
}) {
	const current = await getTodoWorkflowSettings();
	const now = new Date();
	const [settings] = await db
		.update(todoWorkflowSettings)
		.set({
			requirePerTodoReview:
				data.requirePerTodoReview ?? current.requirePerTodoReview,
			requirePerTodoFix: data.requirePerTodoFix ?? current.requirePerTodoFix,
			requireFinalVerification:
				data.requireFinalVerification ?? current.requireFinalVerification,
			requireRegisterCandidatePrompt:
				data.requireRegisterCandidatePrompt ??
				current.requireRegisterCandidatePrompt,
			askCommitOnCompletion:
				data.askCommitOnCompletion ?? current.askCommitOnCompletion,
			hookPolicyJson: data.hookPolicyJson ?? current.hookPolicyJson,
			updatedAt: now,
		})
		.where(eq(todoWorkflowSettings.id, "global"))
		.returning();
	return settings;
}

export async function listImplementationQueueEntries() {
	return db
		.select({
			entry: implementationQueueEntries,
			task: tasks,
			repository: repositories,
		})
		.from(implementationQueueEntries)
		.innerJoin(tasks, eq(implementationQueueEntries.taskId, tasks.id))
		.innerJoin(
			repositories,
			eq(implementationQueueEntries.repositoryId, repositories.id),
		)
		.orderBy(
			desc(implementationQueueEntries.priority),
			asc(implementationQueueEntries.queuePosition),
			asc(implementationQueueEntries.createdAt),
		);
}

export async function listActiveImplementationQueueEntries() {
	return db
		.select()
		.from(implementationQueueEntries)
		.where(
			inArray(implementationQueueEntries.status, [
				...ACTIVE_IMPLEMENTATION_QUEUE_STATUSES,
			]),
		);
}

export async function listOccupiedImplementationQueueEntries() {
	return db
		.select()
		.from(implementationQueueEntries)
		.where(
			inArray(implementationQueueEntries.status, [
				...OCCUPIED_PROCESSOR_STATUSES,
			]),
		);
}

export async function listPlanReadyTasksWithoutActiveQueueEntry() {
	const rows = await db
		.select({
			task: tasks,
			repository: repositories,
			activeQueueEntryId: implementationQueueEntries.id,
		})
		.from(tasks)
		.innerJoin(repositories, eq(tasks.repositoryId, repositories.id))
		.leftJoin(
			implementationQueueEntries,
			and(
				eq(implementationQueueEntries.taskId, tasks.id),
				inArray(implementationQueueEntries.status, [
					...ACTIVE_IMPLEMENTATION_QUEUE_STATUSES,
				]),
			),
		)
		.where(
			and(
				inArray(tasks.status, ["ready", "queued"]),
				sql`${implementationQueueEntries.id} is null`,
			),
		)
		.orderBy(desc(tasks.priority), desc(tasks.updatedAt));
	return rows.map(({ activeQueueEntryId: _activeQueueEntryId, ...row }) => row);
}

export async function hasActiveImplementationQueueEntry(taskId: string) {
	const [entry] = await db
		.select()
		.from(implementationQueueEntries)
		.where(
			and(
				eq(implementationQueueEntries.taskId, taskId),
				inArray(implementationQueueEntries.status, [
					...ACTIVE_IMPLEMENTATION_QUEUE_STATUSES,
				]),
			),
		)
		.limit(1);
	return Boolean(entry);
}

export async function listActiveImplementationQueueEntriesForTask(
	taskId: string,
	database: QueueDb = db,
) {
	return database
		.select()
		.from(implementationQueueEntries)
		.where(
			and(
				eq(implementationQueueEntries.taskId, taskId),
				inArray(implementationQueueEntries.status, [
					...ACTIVE_IMPLEMENTATION_QUEUE_STATUSES,
				]),
			),
		);
}

export async function getImplementationQueueEntryByMissionPilotAdmissionKey(
	admissionKey: string,
	database: QueueDb = db,
) {
	const [entry] = await database
		.select()
		.from(implementationQueueEntries)
		.where(
			eq(implementationQueueEntries.missionPilotAdmissionKey, admissionKey),
		)
		.limit(1);
	return entry ?? null;
}

export async function listImplementationQueueHealthSnapshot(
	options: {
		repositoryId?: string;
		now?: Date;
		staleProcessingMs?: number;
		maxAttempts?: number;
	} = {},
) {
	const now = options.now ?? new Date();
	const staleProcessingMs = options.staleProcessingMs ?? 30 * 60 * 1000;
	const staleProcessingBefore = new Date(now.getTime() - staleProcessingMs);
	const rows = await db
		.select({
			entry: implementationQueueEntries,
			run: taskRuns,
		})
		.from(implementationQueueEntries)
		.leftJoin(taskRuns, eq(implementationQueueEntries.activeRunId, taskRuns.id))
		.where(
			options.repositoryId
				? eq(implementationQueueEntries.repositoryId, options.repositoryId)
				: undefined,
		);

	const items = rows.map(({ entry, run }) => {
		const activeRunMissing = Boolean(entry.activeRunId && !run);
		const runIsTerminal = Boolean(run && !isRunningTaskRunStatus(run.status));
		const leaseExpired = Boolean(
			entry.leaseExpiresAt && entry.leaseExpiresAt < now,
		);
		const heartbeatStale = Boolean(
			entry.lastHeartbeatAt && entry.lastHeartbeatAt < staleProcessingBefore,
		);
		const retryable =
			options.maxAttempts === undefined ||
			entry.attemptCount < options.maxAttempts;
		const classification = activeRunMissing
			? "orphaned_active_run"
			: runIsTerminal &&
					["claimed", "processing", "awaiting_commit_decision"].includes(
						entry.status,
					)
				? "terminal_run_pending_completion"
				: entry.status === "claimed" && leaseExpired && !entry.activeRunId
					? "stale_claim"
					: entry.status === "processing" && heartbeatStale
						? "stale_processing"
						: "normal";
		return {
			entry,
			run,
			classification,
			retryable,
		};
	});

	return {
		generatedAt: now,
		counts: {
			queued: items.filter(({ entry }) => entry.status === "queued").length,
			claimed: items.filter(({ entry }) => entry.status === "claimed").length,
			processing: items.filter(({ entry }) => entry.status === "processing")
				.length,
			awaitingCommitDecision: items.filter(
				({ entry }) => entry.status === "awaiting_commit_decision",
			).length,
			staleClaimed: items.filter(
				({ classification }) => classification === "stale_claim",
			).length,
			staleProcessing: items.filter(
				({ classification }) => classification === "stale_processing",
			).length,
			activeRunMissing: items.filter(
				({ classification }) => classification === "orphaned_active_run",
			).length,
			terminalRunWithActiveQueueEntry: items.filter(
				({ classification }) =>
					classification === "terminal_run_pending_completion",
			).length,
		},
		items,
	};
}
