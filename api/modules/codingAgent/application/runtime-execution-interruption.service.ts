import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db } from "../../../db/client";
import {
	implementationQueueEntries,
	runtimeSessionStates,
	taskEvents,
	taskRuns,
	taskRunTodos,
	tasks,
} from "../../../db/schema";
import { AppError } from "../../../lib/errors";
import * as nightworkersRepo from "../../nightworkers/nightworkers.repository";
import {
	type CodingAgentProcessInterruptionSnapshot,
	projectUnknownOutcomeToolCalls,
} from "../context/process-interruption-snapshot";
import {
	type CodingAgentRunInterruptionReason,
	codingAgentRunExecutions,
} from "../persistence/runtime-execution-schema";
import {
	type CodingAgentExecutionOwnerIdentity,
	getCodingAgentExecutionOwnerIdentity,
} from "../runtime/execution-owner-identity";
import { resolveAgentRuntime } from "../runtime/registry";
import {
	CODING_AGENT_EXECUTION_LEASE_TTL_MS,
	CODING_AGENT_INTERRUPTIBLE_RUN_STATUSES,
} from "./runtime-execution-contracts";

type ExecutionRow = typeof codingAgentRunExecutions.$inferSelect;

export async function claimCodingAgentRunExecution(input: {
	runId: string;
	agentModeSessionId: string | null;
	owner?: CodingAgentExecutionOwnerIdentity;
	now?: Date;
}) {
	const agentModeSessionId = input.agentModeSessionId;
	if (!agentModeSessionId) {
		throw new AppError(
			409,
			"AGENT_MODE_SESSION_REQUIRED",
			"Coding Agent runtime execution requires an Agent Mode Session.",
		);
	}
	const owner = input.owner ?? getCodingAgentExecutionOwnerIdentity();
	const now = input.now ?? new Date();
	const expiresAt = new Date(
		now.getTime() + CODING_AGENT_EXECUTION_LEASE_TTL_MS,
	);
	return db.transaction(async (tx) => {
		const [current] = await tx
			.select()
			.from(codingAgentRunExecutions)
			.where(eq(codingAgentRunExecutions.runId, input.runId));
		if (!current) {
			const [created] = await tx
				.insert(codingAgentRunExecutions)
				.values({
					runId: input.runId,
					agentModeSessionId,
					status: "active",
					ownerKind: owner.kind,
					ownerInstanceId: owner.instanceId,
					ownerPid: owner.pid,
					leaseVersion: 1,
					acquiredAt: now,
					heartbeatAt: now,
					leaseExpiresAt: expiresAt,
					interruptionRevision: 0,
					interruptionReason: null,
					interruptionSnapshotJson: null,
					createdAt: now,
					updatedAt: now,
				})
				.returning();
			if (!created) throw new Error("Failed to claim Coding Agent execution.");
			return created;
		}
		if (
			current.status === "active" &&
			current.ownerKind === owner.kind &&
			current.ownerInstanceId === owner.instanceId
		) {
			return current;
		}
		if (current.status !== "released") {
			throw executionClaimConflict(current);
		}
		const [claimed] = await tx
			.update(codingAgentRunExecutions)
			.set({
				agentModeSessionId,
				status: "active",
				ownerKind: owner.kind,
				ownerInstanceId: owner.instanceId,
				ownerPid: owner.pid,
				leaseVersion: sql`${codingAgentRunExecutions.leaseVersion} + 1`,
				acquiredAt: now,
				heartbeatAt: now,
				leaseExpiresAt: expiresAt,
				updatedAt: now,
			})
			.where(
				and(
					eq(codingAgentRunExecutions.runId, input.runId),
					eq(codingAgentRunExecutions.status, "released"),
					eq(codingAgentRunExecutions.leaseVersion, current.leaseVersion),
				),
			)
			.returning();
		if (!claimed) throw executionClaimConflict(current);
		return claimed;
	});
}

export async function heartbeatCodingAgentRunExecution(input: {
	runId: string;
	leaseVersion: number;
	owner?: CodingAgentExecutionOwnerIdentity;
	now?: Date;
}) {
	const owner = input.owner ?? getCodingAgentExecutionOwnerIdentity();
	const now = input.now ?? new Date();
	const [execution] = await db
		.update(codingAgentRunExecutions)
		.set({
			heartbeatAt: now,
			leaseExpiresAt: new Date(
				now.getTime() + CODING_AGENT_EXECUTION_LEASE_TTL_MS,
			),
			updatedAt: now,
		})
		.where(
			and(
				eq(codingAgentRunExecutions.runId, input.runId),
				eq(codingAgentRunExecutions.status, "active"),
				eq(codingAgentRunExecutions.ownerKind, owner.kind),
				eq(codingAgentRunExecutions.ownerInstanceId, owner.instanceId),
				eq(codingAgentRunExecutions.leaseVersion, input.leaseVersion),
			),
		)
		.returning();
	return execution ?? null;
}

export async function releaseCodingAgentRunExecution(input: {
	runId: string;
	leaseVersion: number;
	owner?: CodingAgentExecutionOwnerIdentity;
	now?: Date;
}) {
	const owner = input.owner ?? getCodingAgentExecutionOwnerIdentity();
	const now = input.now ?? new Date();
	const [execution] = await db
		.update(codingAgentRunExecutions)
		.set({
			status: "released",
			heartbeatAt: now,
			leaseExpiresAt: now,
			updatedAt: now,
		})
		.where(
			and(
				eq(codingAgentRunExecutions.runId, input.runId),
				eq(codingAgentRunExecutions.status, "active"),
				eq(codingAgentRunExecutions.ownerKind, owner.kind),
				eq(codingAgentRunExecutions.ownerInstanceId, owner.instanceId),
				eq(codingAgentRunExecutions.leaseVersion, input.leaseVersion),
			),
		)
		.returning();
	return execution ?? null;
}

export async function reconcileCodingAgentProcessInterruptions(
	input: { owner?: CodingAgentExecutionOwnerIdentity; now?: Date } = {},
) {
	const owner = input.owner ?? getCodingAgentExecutionOwnerIdentity();
	if (owner.kind !== "api_process") return [];
	const activeOwners = await db
		.select({ runId: codingAgentRunExecutions.runId })
		.from(codingAgentRunExecutions)
		.where(
			and(
				eq(codingAgentRunExecutions.status, "active"),
				eq(codingAgentRunExecutions.ownerKind, "api_process"),
				ne(codingAgentRunExecutions.ownerInstanceId, owner.instanceId),
			),
		);
	const unownedRuns = await db
		.select({ runId: taskRuns.id })
		.from(taskRuns)
		.leftJoin(
			codingAgentRunExecutions,
			eq(codingAgentRunExecutions.runId, taskRuns.id),
		)
		.where(
			and(
				inArray(taskRuns.status, [...CODING_AGENT_INTERRUPTIBLE_RUN_STATUSES]),
				isNull(codingAgentRunExecutions.runId),
			),
		);
	const runIds = [
		...new Set([
			...activeOwners.map((row) => row.runId),
			...unownedRuns.map((row) => row.runId),
		]),
	];
	const results = [];
	for (const runId of runIds) {
		const result = await interruptCodingAgentRun({
			runId,
			reason: "process_restarted",
			now: input.now,
		});
		if (result) results.push(result);
	}
	return results;
}

export async function interruptCodingAgentRunsAfterWorkerExit(
	runs: Array<{ runId: string; ownerPid: number }>,
) {
	const results = [];
	const uniqueRuns = new Map(runs.map((run) => [run.runId, run]));
	for (const { runId, ownerPid } of uniqueRuns.values()) {
		const result = await interruptCodingAgentRun({
			runId,
			reason: "worker_lost",
			expectedOwner: { kind: "worker_process", pid: ownerPid },
		});
		if (result) results.push(result);
	}
	return results;
}

export async function suspendActiveCodingAgentRunsForHostShutdown(
	input: { owner?: CodingAgentExecutionOwnerIdentity; now?: Date } = {},
) {
	const owner = input.owner ?? getCodingAgentExecutionOwnerIdentity();
	const active = await db
		.select({ runId: codingAgentRunExecutions.runId })
		.from(codingAgentRunExecutions)
		.where(
			and(
				eq(codingAgentRunExecutions.status, "active"),
				eq(codingAgentRunExecutions.ownerKind, owner.kind),
				eq(codingAgentRunExecutions.ownerInstanceId, owner.instanceId),
			),
		);
	const interrupted = [];
	for (const { runId } of active) {
		const result = await interruptCodingAgentRun({
			runId,
			reason: "graceful_shutdown",
			now: input.now,
		});
		if (result) {
			interrupted.push(result);
			await resolveAgentRuntime(
				result.run.workerKind === "codex-agent"
					? "codex-agent"
					: "native-local",
			).suspendForHostShutdown(runId);
		}
	}
	return interrupted;
}

export async function suspendCodingAgentRunForHostShutdown(runId: string) {
	const result = await interruptCodingAgentRun({
		runId,
		reason: "graceful_shutdown",
	});
	if (!result) return null;
	await resolveAgentRuntime(
		result.run.workerKind === "codex-agent" ? "codex-agent" : "native-local",
	).suspendForHostShutdown(runId);
	return result;
}

export async function interruptCodingAgentRun(input: {
	runId: string;
	reason: CodingAgentRunInterruptionReason;
	expectedOwner?: {
		kind: "api_process" | "worker_process";
		pid: number;
	};
	requireExpiredExecutionLease?: boolean;
	now?: Date;
}) {
	const now = input.now ?? new Date();
	const transition = await db.transaction(async (tx) => {
		const [run] = await tx
			.select()
			.from(taskRuns)
			.where(eq(taskRuns.id, input.runId));
		if (!run) return null;
		if (!isInterruptibleRunStatus(run.status)) {
			await tx
				.update(codingAgentRunExecutions)
				.set({ status: "released", leaseExpiresAt: now, updatedAt: now })
				.where(
					and(
						eq(codingAgentRunExecutions.runId, run.id),
						eq(codingAgentRunExecutions.status, "active"),
					),
				);
			return null;
		}
		if (!run.agentModeSessionId) return null;
		const [execution] = await tx
			.select()
			.from(codingAgentRunExecutions)
			.where(eq(codingAgentRunExecutions.runId, run.id));
		if (
			input.expectedOwner &&
			(execution?.status !== "active" ||
				execution.ownerKind !== input.expectedOwner.kind ||
				execution.ownerPid !== input.expectedOwner.pid)
		) {
			return null;
		}
		if (
			input.requireExpiredExecutionLease &&
			execution?.status === "active" &&
			execution.leaseExpiresAt.getTime() > now.getTime()
		) {
			return null;
		}
		if (execution && execution.status !== "active") return null;
		const [task] = await tx
			.select()
			.from(tasks)
			.where(eq(tasks.id, run.taskId));
		if (!task) throw new InterruptionConflict();
		const [todo] = await tx
			.select()
			.from(taskRunTodos)
			.where(
				and(eq(taskRunTodos.runId, run.id), eq(taskRunTodos.status, "running")),
			)
			.orderBy(taskRunTodos.seq)
			.limit(1);
		const [providerSession] = await tx
			.select()
			.from(runtimeSessionStates)
			.where(
				and(
					eq(runtimeSessionStates.agentModeSessionId, run.agentModeSessionId),
					eq(runtimeSessionStates.status, "active"),
				),
			)
			.orderBy(sql`${runtimeSessionStates.lastSeenAt} desc`)
			.limit(1);
		const eventRows = await tx
			.select({
				id: taskEvents.id,
				seq: taskEvents.seq,
				payloadJson: taskEvents.payloadJson,
			})
			.from(taskEvents)
			.where(eq(taskEvents.taskRunId, run.id))
			.orderBy(taskEvents.seq);
		const unresolvedToolCalls = projectUnknownOutcomeToolCalls(eventRows);
		const interruptionRevision = (execution?.interruptionRevision ?? 0) + 1;
		const previousOwner = execution
			? {
					kind: execution.ownerKind,
					instanceId: execution.ownerInstanceId,
					leaseVersion: execution.leaseVersion,
				}
			: {
					kind: "api_process" as const,
					instanceId: "legacy_unowned_process",
					leaseVersion: 0,
				};
		const workspace =
			run.workspaceId &&
			run.workspaceAllocationVersion !== null &&
			run.repositoryIdentityRevision !== null &&
			run.admissionAttestationId &&
			run.admissionAttestationDigest
				? {
						id: run.workspaceId,
						allocationVersion: run.workspaceAllocationVersion,
						repositoryIdentityRevision: run.repositoryIdentityRevision,
						attestationId: run.admissionAttestationId,
						attestationDigest: run.admissionAttestationDigest,
					}
				: null;
		const snapshot: CodingAgentProcessInterruptionSnapshot = {
			version: 1,
			kind: "process_interrupted",
			revision: interruptionRevision,
			interruptedAt: now.toISOString(),
			reason: input.reason,
			resumableRunningTodo: Boolean(todo),
			previousOwner,
			run: {
				id: run.id,
				agentModeSessionId: run.agentModeSessionId,
				status: run.status,
			},
			currentTodo: todo
				? {
						id: todo.id,
						todoKey: todo.todoKey,
						revision: todo.revision,
						status: "running",
					}
				: null,
			workspace,
			providerSession: providerSession?.providerSessionId
				? {
						stateId: providerSession.id,
						providerThreadId: providerSession.providerSessionId,
						model: providerSession.model,
					}
				: null,
			unresolvedToolCalls,
		};
		const contextSnapshot = mergeRuntimePause(run.contextSnapshot, snapshot);
		const [interruptedRun] = await tx
			.update(taskRuns)
			.set({ status: "needs_human", contextSnapshot, updatedAt: now })
			.where(and(eq(taskRuns.id, run.id), eq(taskRuns.status, run.status)))
			.returning();
		if (!interruptedRun) return null;
		if (execution) {
			const [interruptedExecution] = await tx
				.update(codingAgentRunExecutions)
				.set({
					status: "interrupted",
					heartbeatAt: now,
					leaseExpiresAt: now,
					interruptionRevision,
					interruptionReason: input.reason,
					interruptionSnapshotJson: snapshot,
					updatedAt: now,
				})
				.where(
					and(
						eq(codingAgentRunExecutions.runId, run.id),
						eq(codingAgentRunExecutions.status, "active"),
						eq(codingAgentRunExecutions.leaseVersion, execution.leaseVersion),
					),
				)
				.returning();
			if (!interruptedExecution) throw new InterruptionConflict();
		} else {
			await tx.insert(codingAgentRunExecutions).values({
				runId: run.id,
				agentModeSessionId: run.agentModeSessionId,
				status: "interrupted",
				ownerKind: previousOwner.kind,
				ownerInstanceId: previousOwner.instanceId,
				ownerPid: null,
				leaseVersion: 1,
				acquiredAt: run.startedAt,
				heartbeatAt: now,
				leaseExpiresAt: now,
				interruptionRevision,
				interruptionReason: input.reason,
				interruptionSnapshotJson: snapshot,
				createdAt: now,
				updatedAt: now,
			});
		}
		const [interruptedTask] = await tx
			.update(tasks)
			.set({ status: "needs_human", updatedAt: now })
			.where(
				and(
					eq(tasks.id, run.taskId),
					eq(tasks.status, task.status),
					eq(tasks.revision, task.revision),
					eq(tasks.updatedAt, task.updatedAt),
				),
			)
			.returning();
		if (!interruptedTask) throw new InterruptionConflict();
		await tx
			.update(implementationQueueEntries)
			.set({
				status: "needs_human",
				leaseOwnerId: null,
				leaseAcquiredAt: null,
				leaseExpiresAt: null,
				lastHeartbeatAt: now,
				recoveredAt: now,
				recoveryReason: input.reason,
				statusReason: "Coding Agent runtime process was interrupted.",
				leaseVersion: sql`${implementationQueueEntries.leaseVersion} + 1`,
				updatedAt: now,
			})
			.where(
				and(
					eq(implementationQueueEntries.activeRunId, run.id),
					inArray(implementationQueueEntries.status, ["claimed", "processing"]),
				),
			);
		return { run: interruptedRun, snapshot };
	});
	if (!transition) return null;
	await Promise.allSettled([
		nightworkersRepo.createRunEvent({
			version: 1,
			runId: transition.run.id,
			taskId: transition.run.taskId,
			timestamp: now.toISOString(),
			type: "run.process_interrupted",
			severity: "warning",
			actor: "system",
			message:
				"Coding Agent runtime process was interrupted; the same Run can be resumed.",
			data: transition.snapshot,
		}),
		nightworkersRepo.createTaskMessage({
			taskId: transition.run.taskId,
			runId: transition.run.id,
			role: "system",
			content:
				"Coding Agentの実行processが停止したため、現在のRunとTodoを保持して一時停止しました。次の依頼から同じRunを再開できます。",
			messageType: "text",
			payloadJson: {
				intent: "coding_agent_process_interrupted",
				interruptionRevision: transition.snapshot.revision,
				reason: transition.snapshot.reason,
				unresolvedToolCalls: transition.snapshot.unresolvedToolCalls,
			},
		}),
		...transition.snapshot.unresolvedToolCalls.map((toolCall) =>
			nightworkersRepo.createRunEvent({
				version: 1,
				runId: transition.run.id,
				taskId: transition.run.taskId,
				timestamp: now.toISOString(),
				type: "run.unresolved_tool_call_detected",
				severity: "warning",
				actor: "system",
				message:
					"A tool call was in flight when the runtime process stopped; its outcome remains unknown.",
				data: toolCall,
			}),
		),
		nightworkersRepo.publishTaskRunUpdate(transition.run),
	]);
	return transition;
}

function mergeRuntimePause(
	value: unknown,
	pause: CodingAgentProcessInterruptionSnapshot,
) {
	const context = record(value);
	return { ...context, runtimePause: pause };
}

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function executionClaimConflict(current: ExecutionRow) {
	return new AppError(
		409,
		"RUN_EXECUTION_ALREADY_OWNED",
		"Coding Agent Run execution is already owned by another process.",
		{
			status: current.status,
			ownerKind: current.ownerKind,
			ownerInstanceId: current.ownerInstanceId,
			leaseVersion: current.leaseVersion,
		},
	);
}

class InterruptionConflict extends Error {}

function isInterruptibleRunStatus(
	status: string,
): status is (typeof CODING_AGENT_INTERRUPTIBLE_RUN_STATUSES)[number] {
	return (
		CODING_AGENT_INTERRUPTIBLE_RUN_STATUSES as readonly string[]
	).includes(status);
}
