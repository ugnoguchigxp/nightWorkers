import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "../../../db/client";
import {
	agentModeSessions,
	implementationQueueEntries,
	taskGitWorkspaces,
	taskRuns,
	taskRunTodos,
	tasks,
} from "../../../db/schema";
import { AppError, NotFoundError } from "../../../lib/errors";
import * as nightworkersRepo from "../../nightworkers/nightworkers.repository";
import {
	type CodingAgentProcessInterruptionSnapshot,
	readProcessInterruptionSnapshot,
} from "../context/process-interruption-snapshot";
import { codingAgentRunExecutions } from "../persistence/runtime-execution-schema";
import {
	type CodingAgentExecutionOwnerIdentity,
	getCodingAgentExecutionOwnerIdentity,
} from "../runtime/execution-owner-identity";
import {
	CODING_AGENT_EXECUTION_LEASE_TTL_MS,
	CODING_AGENT_INTERRUPTIBLE_RUN_STATUSES,
} from "./runtime-execution-contracts";

export async function activateInterruptedCodingAgentRun(input: {
	runId: string;
	expectedInterruptionRevision: number;
	todoId: string | null;
	expectedTodoRevision: number | null;
	owner?: CodingAgentExecutionOwnerIdentity;
	now?: Date;
}) {
	const owner = input.owner ?? getCodingAgentExecutionOwnerIdentity();
	const now = input.now ?? new Date();
	const result = await db.transaction(async (tx) => {
		const [execution] = await tx
			.select()
			.from(codingAgentRunExecutions)
			.where(eq(codingAgentRunExecutions.runId, input.runId));
		if (
			execution?.status !== "interrupted" ||
			execution.interruptionRevision !== input.expectedInterruptionRevision
		) {
			throw new AppError(
				409,
				"RUN_INTERRUPTION_REVISION_CONFLICT",
				"Run interruption state changed; reload the latest Task state.",
			);
		}
		const [run] = await tx
			.select()
			.from(taskRuns)
			.where(eq(taskRuns.id, input.runId));
		if (!run) throw new NotFoundError("Run not found");
		if (run.status !== "needs_human") {
			throw new AppError(409, "RUN_NOT_RESUMABLE", "Run is not resumable.");
		}
		const pause = readProcessInterruptionSnapshot(run.contextSnapshot);
		if (!pause || pause.revision !== input.expectedInterruptionRevision) {
			throw new AppError(
				409,
				"RUN_INTERRUPTION_SNAPSHOT_CONFLICT",
				"Run interruption snapshot changed; reload the latest Task state.",
			);
		}
		if (
			pause.run.id !== run.id ||
			pause.run.agentModeSessionId !== run.agentModeSessionId ||
			execution.agentModeSessionId !== run.agentModeSessionId
		) {
			throw new AppError(
				409,
				"RUN_INTERRUPTION_IDENTITY_CONFLICT",
				"Run interruption identity changed; resume was not applied.",
			);
		}
		const [task] = await tx
			.select()
			.from(tasks)
			.where(eq(tasks.id, run.taskId));
		if (task?.status !== "needs_human") {
			throw new AppError(
				409,
				"TASK_NOT_RESUMABLE",
				"Task is not in the interrupted resumable state.",
			);
		}
		const [session] = await tx
			.select()
			.from(agentModeSessions)
			.where(
				and(
					eq(agentModeSessions.id, execution.agentModeSessionId),
					eq(agentModeSessions.status, "active"),
				),
			);
		if (!session || run.agentModeSessionId !== session.id) {
			throw new AppError(
				409,
				"AGENT_MODE_SESSION_NOT_RESUMABLE",
				"Agent Mode Session is not active for this Run.",
			);
		}
		if (input.todoId === null || input.expectedTodoRevision === null) {
			if (pause.currentTodo !== null) {
				throw todoConflict();
			}
			const [unexpectedRunningTodo] = await tx
				.select({ id: taskRunTodos.id })
				.from(taskRunTodos)
				.where(
					and(
						eq(taskRunTodos.runId, run.id),
						eq(taskRunTodos.status, "running"),
					),
				);
			if (unexpectedRunningTodo) throw todoConflict();
		} else {
			const pausedTodo = pause.currentTodo;
			if (
				!pausedTodo ||
				pausedTodo.id !== input.todoId ||
				pausedTodo.revision !== input.expectedTodoRevision
			) {
				throw todoConflict();
			}
			const [todo] = await tx
				.select()
				.from(taskRunTodos)
				.where(
					and(
						eq(taskRunTodos.id, input.todoId),
						eq(taskRunTodos.runId, run.id),
						eq(taskRunTodos.status, "running"),
						eq(taskRunTodos.revision, input.expectedTodoRevision),
					),
				);
			if (!todo) throw todoConflict();
		}
		await assertWorkspaceBinding(tx, run, pause);
		const [queueEntry] = await tx
			.select()
			.from(implementationQueueEntries)
			.where(eq(implementationQueueEntries.activeRunId, run.id));
		if (queueEntry && queueEntry.status !== "needs_human") {
			throw new AppError(
				409,
				"QUEUE_RESUME_STATE_CONFLICT",
				"Implementation Queue state changed; resume was not applied.",
			);
		}
		const otherActiveRuns = await tx
			.select({ id: taskRuns.id })
			.from(taskRuns)
			.where(
				and(
					eq(taskRuns.taskId, run.taskId),
					ne(taskRuns.id, run.id),
					inArray(taskRuns.status, [
						...CODING_AGENT_INTERRUPTIBLE_RUN_STATUSES,
					]),
				),
			);
		if (otherActiveRuns.length > 0) {
			throw new AppError(
				409,
				"RUN_ALREADY_ACTIVE",
				"Another run is already active for this Task.",
			);
		}
		const [claimedExecution] = await tx
			.update(codingAgentRunExecutions)
			.set({
				status: "active",
				ownerKind: owner.kind,
				ownerInstanceId: owner.instanceId,
				ownerPid: owner.pid,
				leaseVersion: sql`${codingAgentRunExecutions.leaseVersion} + 1`,
				acquiredAt: now,
				heartbeatAt: now,
				leaseExpiresAt: new Date(
					now.getTime() + CODING_AGENT_EXECUTION_LEASE_TTL_MS,
				),
				updatedAt: now,
			})
			.where(
				and(
					eq(codingAgentRunExecutions.runId, run.id),
					eq(codingAgentRunExecutions.status, "interrupted"),
					eq(
						codingAgentRunExecutions.interruptionRevision,
						input.expectedInterruptionRevision,
					),
					eq(codingAgentRunExecutions.leaseVersion, execution.leaseVersion),
				),
			)
			.returning();
		if (!claimedExecution) throw executionClaimConflict(execution);
		const [resumedRun] = await tx
			.update(taskRuns)
			.set({
				status: "running",
				endedAt: null,
				finishedAt: null,
				contextSnapshot: clearProcessRuntimePause(run.contextSnapshot, pause),
				summary: null,
				finalReport: null,
				finalJudgment: null,
				updatedAt: now,
			})
			.where(and(eq(taskRuns.id, run.id), eq(taskRuns.status, "needs_human")))
			.returning();
		if (!resumedRun) throw new InterruptionConflict();
		const [resumedTask] = await tx
			.update(tasks)
			.set({ status: "running", updatedAt: now })
			.where(and(eq(tasks.id, run.taskId), eq(tasks.status, "needs_human")))
			.returning();
		if (!resumedTask) throw new InterruptionConflict();
		const resumedQueue = await tx
			.update(implementationQueueEntries)
			.set({
				status: "processing",
				leaseOwnerId: `coding-agent:${owner.instanceId}`,
				leaseAcquiredAt: now,
				leaseExpiresAt: new Date(
					now.getTime() + CODING_AGENT_EXECUTION_LEASE_TTL_MS,
				),
				lastHeartbeatAt: now,
				recoveredAt: now,
				recoveryReason: "process_interrupted_resume",
				statusReason: null,
				leaseVersion: sql`${implementationQueueEntries.leaseVersion} + 1`,
				updatedAt: now,
			})
			.where(
				and(
					eq(implementationQueueEntries.activeRunId, run.id),
					eq(implementationQueueEntries.status, "needs_human"),
				),
			)
			.returning();
		if (queueEntry && resumedQueue.length !== 1) {
			throw new InterruptionConflict();
		}
		return { run: resumedRun, execution: claimedExecution };
	});
	await Promise.allSettled([
		nightworkersRepo.createRunEvent({
			version: 1,
			runId: result.run.id,
			taskId: result.run.taskId,
			timestamp: now.toISOString(),
			type: "run.resume_claimed",
			severity: "info",
			actor: "system",
			message:
				"Interrupted Coding Agent Run was claimed by a new runtime owner.",
			data: {
				interruptionRevision: input.expectedInterruptionRevision,
				ownerKind: owner.kind,
				ownerInstanceId: owner.instanceId,
				leaseVersion: result.execution.leaseVersion,
			},
		}),
		nightworkersRepo.publishTaskRunUpdate(result.run),
	]);
	return result.run;
}

async function assertWorkspaceBinding(
	tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
	run: typeof taskRuns.$inferSelect,
	pause: CodingAgentProcessInterruptionSnapshot,
) {
	if (!run.workspaceId) {
		if (pause.workspace === null) return;
		throw workspaceConflict();
	}
	const [workspace] = await tx
		.select()
		.from(taskGitWorkspaces)
		.where(eq(taskGitWorkspaces.id, run.workspaceId));
	if (
		!workspace ||
		workspace.taskId !== run.taskId ||
		workspace.allocationVersion !== run.workspaceAllocationVersion ||
		workspace.repositoryIdentityRevision !== run.repositoryIdentityRevision ||
		pause.workspace?.id !== run.workspaceId ||
		pause.workspace.allocationVersion !== run.workspaceAllocationVersion ||
		pause.workspace.repositoryIdentityRevision !==
			run.repositoryIdentityRevision ||
		pause.workspace.attestationId !== run.admissionAttestationId ||
		pause.workspace.attestationDigest !== run.admissionAttestationDigest
	) {
		throw workspaceConflict();
	}
}

function clearProcessRuntimePause(
	value: unknown,
	pause: CodingAgentProcessInterruptionSnapshot,
) {
	const context = record(value);
	return { ...context, lastProcessInterruption: pause, runtimePause: null };
}

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function executionClaimConflict(
	current: typeof codingAgentRunExecutions.$inferSelect,
) {
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

function todoConflict() {
	return new AppError(
		409,
		"TODO_REVISION_CONFLICT",
		"Current Todo changed; reload the latest Task state.",
	);
}

function workspaceConflict() {
	return new AppError(
		409,
		"WORKSPACE_BINDING_CONFLICT",
		"Run workspace binding changed; resume was not applied.",
	);
}

class InterruptionConflict extends Error {}
