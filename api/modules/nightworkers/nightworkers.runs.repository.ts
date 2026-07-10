import { and, asc, desc, eq, gt, inArray, not, sql } from "drizzle-orm";
import { db } from "../../db/client";
import { withSqliteBusyRetry } from "../../db/retry";
import type { TaskRunStatus } from "../../db/schema";
import {
	artifacts,
	taskEvents,
	taskRunCommitRecords,
	taskRuns,
	taskRunTodos,
	tasks,
} from "../../db/schema";
import { nightWorkersRealtimeBroker } from "../../services/realtime/nightworkers-ws";
import { normalizeRunEventToLegacy } from "../../services/run-events/normalizer";
import type { RunEventBase } from "../../services/run-events/types";
import {
	enqueueActivityEvent,
	runEventToActivityKind,
	runEventToActivityStatus,
	runEventToActivityText,
	runEventToActivityTurnId,
	schemaFirstAgentEventType,
	schemaFirstPayload,
	shouldProjectRunEventToActivity,
} from "./nightworkers.activity.repository";
import {
	type JsonRecord,
	readRunEventPayload,
} from "./nightworkers.json-adapters";

const TERMINAL_TODO_STATUSES = [
	"passed",
	"failed",
	"needs_human",
	"skipped",
] as const;
const OPEN_TODO_STATUSES = ["pending", "running"] as const;

type TaskRunTodoRow = typeof taskRunTodos.$inferSelect;
type ReplaceTaskRunTodoInput = {
	seq: number;
	title: string;
	description?: string | null;
	taskType: string;
	status?: string;
	procedureId?: string | null;
	procedureSnapshot?: unknown;
	contextSnapshot?: unknown;
	completionGateResult?: unknown;
	evidenceRequirementsJson?: unknown;
	evidenceRequirements?: unknown;
	evidenceRefsJson?: string[] | null;
	dependsOn?: Array<string | number> | null;
	statusReason?: string | null;
	startedAt?: Date | null;
	completedAt?: Date | null;
};

function isTerminalTodoStatus(status: string) {
	return (TERMINAL_TODO_STATUSES as readonly string[]).includes(status);
}

function isOpenTodoStatus(status: string) {
	return (OPEN_TODO_STATUSES as readonly string[]).includes(status);
}

function shouldAutoStartReplacementTodo(todo: TaskRunTodoRow) {
	return (
		todo.status === "pending" &&
		!["knowledge_capture", "completion_report"].includes(todo.taskType)
	);
}

function normalizeReplacementTodoInput(
	runId: string,
	todo: ReplaceTaskRunTodoInput,
) {
	return {
		runId,
		seq: todo.seq,
		title: todo.title,
		description: todo.description ?? null,
		taskType: todo.taskType,
		status: todo.status ?? "pending",
		procedureId: todo.procedureId ?? null,
		procedureSnapshot: todo.procedureSnapshot ?? null,
		contextSnapshot: todo.contextSnapshot ?? null,
		completionGateResult: todo.completionGateResult ?? null,
		evidenceRequirementsJson:
			todo.evidenceRequirementsJson ?? todo.evidenceRequirements ?? null,
		evidenceRefsJson: todo.evidenceRefsJson ?? [],
		dependsOn: todo.dependsOn ?? [],
		statusReason: todo.statusReason ?? null,
		startedAt: todo.startedAt ?? null,
		completedAt: todo.completedAt ?? null,
	};
}

function isSqliteUniqueConstraintError(error: unknown) {
	const message = error instanceof Error ? error.message : String(error);
	return (
		message.includes("SQLITE_CONSTRAINT") ||
		message.includes("UNIQUE constraint failed")
	);
}

export async function createTaskRun(data: {
	taskId: string;
	repositoryId?: string | null;
	status?: TaskRunStatus;
	workerKind?: string;
	baseRef?: string | null;
	worktreePath?: string | null;
	timeoutSeconds?: number;
	contextSnapshot?: unknown;
	summary?: string | null;
	finalReport?: string | null;
	finalJudgment?: unknown;
	startedAt?: Date;
	endedAt?: Date;
	finishedAt?: Date;
}) {
	const [run] = await db.insert(taskRuns).values(data).returning();
	return run;
}

export async function getTaskRun(id: string) {
	const [run] = await db.select().from(taskRuns).where(eq(taskRuns.id, id));
	return run;
}

export async function createTaskRunCommitRecord(data: {
	runId: string;
	repositoryId: string;
	status?: string;
	baselineHead?: string | null;
	baselineStatusJson?: unknown;
	preExistingDirtyPaths?: string[];
	ownedCandidatePaths?: string[];
	stageableOwnedPaths?: string[];
	excludedPaths?: Array<{ path: string; reason: string }>;
	verificationStatus?: "not_run" | "passed" | "failed" | "partial";
	verificationEvidenceJson?: unknown;
	commitSha?: string | null;
	commitMessage?: string | null;
	pushStatus?: string | null;
	pushedAt?: Date | null;
	pushRemote?: string | null;
	pushBranch?: string | null;
	statusReason?: string | null;
}) {
	const now = new Date();
	const values = {
		runId: data.runId,
		repositoryId: data.repositoryId,
		status: data.status ?? "pending",
		baselineHead: data.baselineHead ?? null,
		baselineStatusJson: data.baselineStatusJson ?? null,
		preExistingDirtyPathsJson: data.preExistingDirtyPaths ?? [],
		ownedCandidatePathsJson: data.ownedCandidatePaths ?? [],
		stageableOwnedPathsJson: data.stageableOwnedPaths ?? [],
		excludedPathsJson: data.excludedPaths ?? [],
		verificationStatus: data.verificationStatus ?? "not_run",
		verificationEvidenceJson: data.verificationEvidenceJson ?? null,
		commitSha: data.commitSha ?? null,
		commitMessage: data.commitMessage ?? null,
		pushStatus: data.pushStatus ?? null,
		pushedAt: data.pushedAt ?? null,
		pushRemote: data.pushRemote ?? null,
		pushBranch: data.pushBranch ?? null,
		statusReason: data.statusReason ?? null,
		createdAt: now,
		updatedAt: now,
	};
	const updateValues = {
		repositoryId: values.repositoryId,
		status: values.status,
		baselineHead: values.baselineHead,
		baselineStatusJson: values.baselineStatusJson,
		preExistingDirtyPathsJson: values.preExistingDirtyPathsJson,
		ownedCandidatePathsJson: values.ownedCandidatePathsJson,
		stageableOwnedPathsJson: values.stageableOwnedPathsJson,
		excludedPathsJson: values.excludedPathsJson,
		verificationStatus: values.verificationStatus,
		verificationEvidenceJson: values.verificationEvidenceJson,
		commitSha: values.commitSha,
		commitMessage: values.commitMessage,
		pushStatus: values.pushStatus,
		pushedAt: values.pushedAt,
		pushRemote: values.pushRemote,
		pushBranch: values.pushBranch,
		statusReason: values.statusReason,
		updatedAt: now,
	};
	const [record] = await db
		.insert(taskRunCommitRecords)
		.values(values)
		.onConflictDoUpdate({
			target: taskRunCommitRecords.runId,
			set: updateValues,
		})
		.returning();
	return record;
}

export async function getTaskRunCommitRecord(runId: string) {
	const [record] = await db
		.select()
		.from(taskRunCommitRecords)
		.where(eq(taskRunCommitRecords.runId, runId));
	return record ?? null;
}

export async function updateTaskRunCommitRecord(
	runId: string,
	data: {
		status?: string;
		ownedCandidatePaths?: string[];
		stageableOwnedPaths?: string[];
		excludedPaths?: Array<{ path: string; reason: string }>;
		verificationStatus?: "not_run" | "passed" | "failed" | "partial";
		verificationEvidenceJson?: unknown;
		commitSha?: string | null;
		commitMessage?: string | null;
		pushStatus?: string | null;
		pushedAt?: Date | null;
		pushRemote?: string | null;
		pushBranch?: string | null;
		statusReason?: string | null;
	},
) {
	const updateValues = {
		...(data.status !== undefined ? { status: data.status } : {}),
		...(data.ownedCandidatePaths !== undefined
			? { ownedCandidatePathsJson: data.ownedCandidatePaths }
			: {}),
		...(data.stageableOwnedPaths !== undefined
			? { stageableOwnedPathsJson: data.stageableOwnedPaths }
			: {}),
		...(data.excludedPaths !== undefined
			? { excludedPathsJson: data.excludedPaths }
			: {}),
		...(data.verificationStatus !== undefined
			? { verificationStatus: data.verificationStatus }
			: {}),
		...(data.verificationEvidenceJson !== undefined
			? { verificationEvidenceJson: data.verificationEvidenceJson }
			: {}),
		...(data.commitSha !== undefined ? { commitSha: data.commitSha } : {}),
		...(data.commitMessage !== undefined
			? { commitMessage: data.commitMessage }
			: {}),
		...(data.pushStatus !== undefined ? { pushStatus: data.pushStatus } : {}),
		...(data.pushedAt !== undefined ? { pushedAt: data.pushedAt } : {}),
		...(data.pushRemote !== undefined ? { pushRemote: data.pushRemote } : {}),
		...(data.pushBranch !== undefined ? { pushBranch: data.pushBranch } : {}),
		...(data.statusReason !== undefined
			? { statusReason: data.statusReason }
			: {}),
		updatedAt: new Date(),
	};
	const [record] = await db
		.update(taskRunCommitRecords)
		.set(updateValues)
		.where(eq(taskRunCommitRecords.runId, runId))
		.returning();
	return record ?? null;
}

export async function listTaskRunsForTask(taskId: string) {
	return db
		.select()
		.from(taskRuns)
		.where(eq(taskRuns.taskId, taskId))
		.orderBy(desc(taskRuns.startedAt));
}

export async function listActiveTaskRunsForTask(taskId: string) {
	return db
		.select()
		.from(taskRuns)
		.where(
			and(
				eq(taskRuns.taskId, taskId),
				inArray(taskRuns.status, [
					"running",
					"context_compiling",
					"finalizing",
				]),
			),
		);
}

export async function countActiveTaskRuns(repositoryId?: string) {
	const rows = await db
		.select({ count: sql<number>`count(*)` })
		.from(taskRuns)
		.where(
			repositoryId
				? and(
						eq(taskRuns.repositoryId, repositoryId),
						inArray(taskRuns.status, [
							"running",
							"context_compiling",
							"finalizing",
						]),
					)
				: inArray(taskRuns.status, [
						"running",
						"context_compiling",
						"finalizing",
					]),
		);
	return Number(rows[0]?.count ?? 0);
}

export async function claimNextQueuedTask(repositoryId: string) {
	const [task] = await db
		.select()
		.from(tasks)
		.where(
			and(
				eq(tasks.repositoryId, repositoryId),
				inArray(tasks.status, ["ready", "queued"]),
				sql`not exists (
          select 1 from implementation_queue_entries iqe
          where iqe.task_id = ${tasks.id}
            and iqe.status in ('queued', 'claimed', 'processing', 'needs_human', 'awaiting_commit_decision', 'execution_completed', 'failed', 'cancelled')
        )`,
			),
		)
		.orderBy(desc(tasks.priority), asc(tasks.updatedAt))
		.limit(1);
	if (!task) return null;
	const [claimed] = await db
		.update(tasks)
		.set({ status: "running", updatedAt: new Date() })
		.where(
			and(eq(tasks.id, task.id), inArray(tasks.status, ["ready", "queued"])),
		)
		.returning();
	if (claimed) {
		nightWorkersRealtimeBroker.publish(claimed.id, {
			type: "task_status_updated",
			payload: { status: claimed.status, task: claimed },
		});
	}
	return claimed ?? null;
}

export async function updateTaskRun(
	id: string,
	data: {
		status?: TaskRunStatus;
		endedAt?: Date;
		finishedAt?: Date;
		logContent?: string;
		diffPatch?: string;
		testResults?: unknown;
		workerKind?: string;
		baseRef?: string | null;
		worktreePath?: string | null;
		timeoutSeconds?: number;
		contextSnapshot?: unknown;
		summary?: string | null;
		finalReport?: string | null;
		finalJudgment?: unknown;
	},
) {
	const [run] = await db
		.update(taskRuns)
		.set({ ...data, updatedAt: new Date() })
		.where(eq(taskRuns.id, id))
		.returning();
	if (run) {
		nightWorkersRealtimeBroker.publish(run.taskId, {
			type: "task_run_updated",
			runId: run.id,
			payload: { run },
		});
	}
	return run;
}

// --- Task Run Todos ---
export async function createTaskRunTodo(data: {
	runId: string;
	seq: number;
	title: string;
	description?: string | null;
	taskType: string;
	status?: string;
	procedureId?: string | null;
	procedureSnapshot?: unknown;
	contextSnapshot?: unknown;
	completionGateResult?: unknown;
	evidenceRequirementsJson?: unknown;
	evidenceRefsJson?: string[] | null;
	dependsOn?: Array<string | number> | null;
	statusReason?: string | null;
	startedAt?: Date | null;
	completedAt?: Date | null;
}) {
	const [todo] = await db
		.insert(taskRunTodos)
		.values({
			...data,
			evidenceRefsJson: data.evidenceRefsJson ?? [],
			dependsOn: data.dependsOn ?? [],
		})
		.returning();
	return todo;
}

export async function replaceTaskRunTodosForRun(
	runId: string,
	todos: ReplaceTaskRunTodoInput[],
) {
	const replaced = await withSqliteBusyRetry(() =>
		db.transaction(async (tx) => {
			const existingTodos = await tx
				.select()
				.from(taskRunTodos)
				.where(eq(taskRunTodos.runId, runId))
				.orderBy(asc(taskRunTodos.seq));
			const existingBySeq = new Map(
				existingTodos.map((todo) => [todo.seq, todo]),
			);
			const incomingSeqs = new Set(todos.map((todo) => todo.seq));
			const autoStartRequested = todos.some(
				(todo) => todo.status === "running",
			);

			for (const todo of todos) {
				const existing = existingBySeq.get(todo.seq);
				if (existing && isTerminalTodoStatus(existing.status)) {
					continue;
				}

				const replacement = normalizeReplacementTodoInput(runId, todo);
				if (existing) {
					await tx
						.update(taskRunTodos)
						.set({ ...replacement, updatedAt: new Date() })
						.where(eq(taskRunTodos.id, existing.id));
					continue;
				}

				await tx.insert(taskRunTodos).values(replacement);
			}

			const obsoleteOpenTodoIds = existingTodos
				.filter(
					(todo) =>
						!incomingSeqs.has(todo.seq) && isOpenTodoStatus(todo.status),
				)
				.map((todo) => todo.id);
			if (obsoleteOpenTodoIds.length > 0) {
				await tx
					.delete(taskRunTodos)
					.where(inArray(taskRunTodos.id, obsoleteOpenTodoIds));
			}

			let currentTodos = await tx
				.select()
				.from(taskRunTodos)
				.where(eq(taskRunTodos.runId, runId))
				.orderBy(asc(taskRunTodos.seq));
			const hasRunningTodo = currentTodos.some(
				(todo) => todo.status === "running",
			);
			if (!hasRunningTodo && autoStartRequested) {
				const now = new Date();
				const nextTodo = currentTodos.find(shouldAutoStartReplacementTodo);
				if (nextTodo) {
					const [startedTodo] = await tx
						.update(taskRunTodos)
						.set({
							status: "running",
							startedAt: now,
							completedAt: null,
							updatedAt: now,
						})
						.where(eq(taskRunTodos.id, nextTodo.id))
						.returning();
					currentTodos = currentTodos.map((todo) =>
						todo.id === nextTodo.id ? startedTodo : todo,
					);
				}
			}

			return currentTodos;
		}),
	);
	const [run] = await withSqliteBusyRetry(() =>
		db.select().from(taskRuns).where(eq(taskRuns.id, runId)),
	);
	if (run) {
		nightWorkersRealtimeBroker.publish(run.taskId, {
			type: "task_run_updated",
			runId: run.id,
			payload: { run },
		});
	}
	return replaced;
}

export async function listTaskRunTodosForRun(runId: string) {
	return withSqliteBusyRetry(() =>
		db
			.select()
			.from(taskRunTodos)
			.where(eq(taskRunTodos.runId, runId))
			.orderBy(taskRunTodos.seq),
	);
}

export async function updateTaskRunTodo(
	id: string,
	data: {
		title?: string;
		description?: string | null;
		taskType?: string;
		status?: string;
		procedureId?: string | null;
		procedureSnapshot?: unknown;
		contextSnapshot?: unknown;
		completionGateResult?: unknown;
		evidenceRequirementsJson?: unknown;
		evidenceRefsJson?: string[] | null;
		dependsOn?: Array<string | number> | null;
		statusReason?: string | null;
		startedAt?: Date | null;
		completedAt?: Date | null;
	},
	options: { notifyTaskId?: string; notifyRunId?: string } = {},
) {
	const blocksTerminalReopen =
		data.status !== undefined && isOpenTodoStatus(data.status);
	const [todo] = await withSqliteBusyRetry(() =>
		db
			.update(taskRunTodos)
			.set({
				...data,
				evidenceRefsJson:
					data.evidenceRefsJson === undefined
						? undefined
						: (data.evidenceRefsJson ?? []),
				dependsOn:
					data.dependsOn === undefined ? undefined : (data.dependsOn ?? []),
				updatedAt: new Date(),
			})
			.where(
				blocksTerminalReopen
					? and(
							eq(taskRunTodos.id, id),
							not(inArray(taskRunTodos.status, [...TERMINAL_TODO_STATUSES])),
						)
					: eq(taskRunTodos.id, id),
			)
			.returning(),
	);
	if (!todo && blocksTerminalReopen) {
		const [current] = await withSqliteBusyRetry(() =>
			db.select().from(taskRunTodos).where(eq(taskRunTodos.id, id)),
		);
		return current;
	}
	if (todo) {
		if (options.notifyTaskId) {
			nightWorkersRealtimeBroker.publish(options.notifyTaskId, {
				type: "task_run_updated",
				runId: options.notifyRunId ?? todo.runId,
				payload: { todo },
			});
		} else {
			try {
				const [run] = await db
					.select()
					.from(taskRuns)
					.where(eq(taskRuns.id, todo.runId));
				if (run) {
					nightWorkersRealtimeBroker.publish(run.taskId, {
						type: "task_run_updated",
						runId: run.id,
						payload: { run },
					});
				}
			} catch {
				// Todo persistence succeeded. Realtime notification must not turn it into a failed tool call.
			}
		}
	}
	return todo;
}

export async function startTaskRunTodoIfStillPendingAndNoEarlierOpen(
	input: {
		id: string;
		runId: string;
		afterSeq: number;
		startedAt: Date;
	},
	options: { notifyTaskId?: string; notifyRunId?: string } = {},
) {
	const [todo] = await withSqliteBusyRetry(() =>
		db
			.update(taskRunTodos)
			.set({
				status: "running",
				startedAt: input.startedAt,
				completedAt: null,
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(taskRunTodos.id, input.id),
					eq(taskRunTodos.runId, input.runId),
					eq(taskRunTodos.status, "pending"),
					sql`not exists (
            select 1
            from task_run_todos earlier
            where earlier.run_id = ${input.runId}
              and earlier.seq <= ${input.afterSeq}
              and earlier.status in ('pending', 'running')
          )`,
				),
			)
			.returning(),
	);
	if (todo && options.notifyTaskId) {
		nightWorkersRealtimeBroker.publish(options.notifyTaskId, {
			type: "task_run_updated",
			runId: options.notifyRunId ?? todo.runId,
			payload: { todo },
		});
	}
	return todo ?? null;
}

// --- Task Events ---
export async function createTaskEvent(data: {
	taskRunId: string;
	type: string;
	message: string;
	seq?: number;
	actor?: string;
	eventType?: string | null;
	payloadJson?: unknown;
	timestamp?: Date;
}) {
	const maxAttempts = data.seq === undefined ? 5 : 1;
	let lastError: unknown;
	for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
		try {
			return await withSqliteBusyRetry(() =>
				db.transaction(async (tx) => {
					let seq = data.seq;
					if (seq === undefined) {
						const result = await tx
							.select({
								maxSeq: sql<number>`coalesce(max(${taskEvents.seq}), 0)`,
							})
							.from(taskEvents)
							.where(eq(taskEvents.taskRunId, data.taskRunId));
						seq = (result[0]?.maxSeq || 0) + 1;
					}
					const [event] = await tx
						.insert(taskEvents)
						.values({ ...data, seq })
						.returning();
					return event;
				}),
			);
		} catch (error) {
			lastError = error;
			if (data.seq !== undefined || !isSqliteUniqueConstraintError(error))
				throw error;
		}
	}
	throw lastError;
}

export async function createRunEvent(
	event: RunEventBase,
	options?: { legacyPayload?: unknown; payloadJson?: Record<string, unknown> },
) {
	if (event.type === "model.response_delta") return null;

	const normalized = normalizeRunEventToLegacy({
		event,
		legacyPayload: options?.legacyPayload,
	});
	const payloadJson = {
		...normalized.payloadJson,
		...(options?.payloadJson || {}),
	};
	const created = await createTaskEvent({
		taskRunId: event.runId,
		actor: normalized.actor,
		type: normalized.type,
		eventType: normalized.eventType,
		message: normalized.message,
		payloadJson,
		timestamp: normalized.timestamp,
	});
	if (!created) return created;

	const { payload, runEvent: currentRunEvent } = readRunEventPayload(
		created.payloadJson,
	);
	if (!currentRunEvent) return created;

	const patchedPayload = {
		...payload,
		...(options?.payloadJson || {}),
		runEvent: {
			...currentRunEvent,
			id: created.id,
			seq: created.seq,
			runId: currentRunEvent.runId || created.taskRunId,
		},
	};

	const [updated] = await withSqliteBusyRetry(() =>
		db
			.update(taskEvents)
			.set({ payloadJson: patchedPayload })
			.where(eq(taskEvents.id, created.id))
			.returning(),
	);
	const finalEvent = updated ?? { ...created, payloadJson: patchedPayload };
	const patchedRunEvent =
		patchedPayload.runEvent && typeof patchedPayload.runEvent === "object"
			? (patchedPayload.runEvent as JsonRecord)
			: {};
	let taskId =
		event.taskId ||
		(typeof patchedRunEvent.taskId === "string"
			? patchedRunEvent.taskId
			: null);
	if (!taskId) {
		const [run] = await withSqliteBusyRetry(() =>
			db.select().from(taskRuns).where(eq(taskRuns.id, event.runId)),
		);
		taskId = run?.taskId;
	}
	if (taskId) {
		const agentEventType = schemaFirstAgentEventType(patchedPayload);
		const projectToActivity = shouldProjectRunEventToActivity({
			eventType: event.type,
			agentEventType,
		});
		if (!projectToActivity) {
			nightWorkersRealtimeBroker.publish(taskId, {
				type: "task_event_created",
				runId: event.runId,
				event: finalEvent,
			});
			return finalEvent;
		}
		await enqueueActivityEvent({
			taskId,
			runId: event.runId,
			turnId: runEventToActivityTurnId({
				runId: event.runId,
				eventType: event.type,
				agentEventType,
			}),
			runSeq: finalEvent.seq,
			kind: runEventToActivityKind(event.type, finalEvent.type, agentEventType),
			source:
				event.actor === "worker"
					? "worker"
					: event.actor === "tool"
						? "tool"
						: event.actor === "supervisor"
							? "supervisor"
							: event.actor === "runtime"
								? "runtime"
								: event.actor === "human"
									? "user"
									: "system",
			status: runEventToActivityStatus({
				eventType: event.type,
				legacyType: finalEvent.type,
				agentEventType,
			}),
			text: runEventToActivityText({
				eventType: event.type,
				agentEventType,
				message: event.message,
				payload: patchedPayload,
			}),
			payloadJson: {
				runEvent: patchedPayload.runEvent,
				legacyEvent: finalEvent,
				legacyPayload: options?.legacyPayload ?? null,
				agentEventType,
				payload: schemaFirstPayload(patchedPayload),
			},
			externalId: finalEvent.id,
			dedupeKey: `task_event:${finalEvent.id}`,
			createdAt: finalEvent.timestamp,
		});
		nightWorkersRealtimeBroker.publish(taskId, {
			type: "task_event_created",
			runId: event.runId,
			event: finalEvent,
		});
	}
	return finalEvent;
}

export async function listTaskEventsForRun(
	taskRunId: string,
	options?: { afterSeq?: number },
) {
	const predicates = [eq(taskEvents.taskRunId, taskRunId)];
	if (typeof options?.afterSeq === "number") {
		predicates.push(gt(taskEvents.seq, options.afterSeq));
	}
	return db
		.select()
		.from(taskEvents)
		.where(and(...predicates))
		.orderBy(taskEvents.seq, taskEvents.timestamp);
}

// --- Artifacts ---
export async function createArtifact(data: {
	runId: string;
	kind: string;
	path: string;
	metadataJson?: unknown;
}) {
	const [artifact] = await db.insert(artifacts).values(data).returning();
	return artifact;
}

export async function listArtifactsForRun(runId: string) {
	return db
		.select()
		.from(artifacts)
		.where(eq(artifacts.runId, runId))
		.orderBy(desc(artifacts.createdAt));
}
