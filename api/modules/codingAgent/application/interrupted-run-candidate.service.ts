import { and, eq } from "drizzle-orm";
import { db } from "../../../db/client";
import {
	agentModeSessions,
	taskRuns,
	taskRunTodos,
	tasks,
} from "../../../db/schema";
import { AppError } from "../../../lib/errors";
import { canonicalDigest } from "../../agentsShare";
import { readProcessInterruptionSnapshot } from "../context/process-interruption-snapshot";
import { codingAgentRunExecutions } from "../persistence/runtime-execution-schema";
import type { CodingAgentInterruptedRunCandidate } from "./runtime-execution-contracts";

export async function findInterruptedCodingAgentRunCandidate(taskId: string) {
	const rows = await db
		.select({ run: taskRuns, execution: codingAgentRunExecutions, task: tasks })
		.from(taskRuns)
		.innerJoin(tasks, eq(tasks.id, taskRuns.taskId))
		.innerJoin(
			codingAgentRunExecutions,
			eq(codingAgentRunExecutions.runId, taskRuns.id),
		)
		.where(
			and(
				eq(taskRuns.taskId, taskId),
				eq(taskRuns.status, "needs_human"),
				eq(codingAgentRunExecutions.status, "interrupted"),
			),
		);
	const resumable = rows.filter(({ run, execution, task }) => {
		const pause = readProcessInterruptionSnapshot(run.contextSnapshot);
		return (
			task.status === "needs_human" &&
			pause?.revision === execution.interruptionRevision &&
			pause.run.id === run.id &&
			pause.run.agentModeSessionId === run.agentModeSessionId &&
			execution.agentModeSessionId === run.agentModeSessionId &&
			(pause.workspace
				? pause.workspace.id === run.workspaceId &&
					pause.workspace.allocationVersion ===
						run.workspaceAllocationVersion &&
					pause.workspace.repositoryIdentityRevision ===
						run.repositoryIdentityRevision &&
					pause.workspace.attestationId === run.admissionAttestationId &&
					pause.workspace.attestationDigest === run.admissionAttestationDigest
				: run.workspaceId === null)
		);
	});
	if (resumable.length > 1) {
		throw new AppError(
			409,
			"MULTIPLE_INTERRUPTED_RUNS",
			"Multiple interrupted Runs require explicit operator resolution.",
		);
	}
	const row = resumable[0];
	if (!row?.run.agentModeSessionId) return null;
	const pause = readProcessInterruptionSnapshot(row.run.contextSnapshot);
	if (!pause) return null;
	const [session] = await db
		.select({ id: agentModeSessions.id })
		.from(agentModeSessions)
		.where(
			and(
				eq(agentModeSessions.id, row.run.agentModeSessionId),
				eq(agentModeSessions.status, "active"),
			),
		);
	if (!session) return null;
	if (pause.currentTodo) {
		const [todo] = await db
			.select()
			.from(taskRunTodos)
			.where(
				and(
					eq(taskRunTodos.id, pause.currentTodo.id),
					eq(taskRunTodos.runId, row.run.id),
					eq(taskRunTodos.status, "running"),
					eq(taskRunTodos.revision, pause.currentTodo.revision),
				),
			);
		if (!todo || todo.todoKey !== pause.currentTodo.todoKey) return null;
	} else {
		const [unexpectedRunningTodo] = await db
			.select({ id: taskRunTodos.id })
			.from(taskRunTodos)
			.where(
				and(
					eq(taskRunTodos.runId, row.run.id),
					eq(taskRunTodos.status, "running"),
				),
			);
		if (unexpectedRunningTodo) return null;
	}
	const candidateWithoutDigest = {
		runId: row.run.id,
		taskId: row.run.taskId,
		agentModeSessionId: row.run.agentModeSessionId,
		interruptionRevision: row.execution.interruptionRevision,
		executionLeaseVersion: row.execution.leaseVersion,
		todoId: pause.currentTodo?.id ?? null,
		todoKey: pause.currentTodo?.todoKey ?? null,
		todoRevision: pause.currentTodo?.revision ?? null,
		workspaceId: row.run.workspaceId,
		workspaceAllocationVersion: row.run.workspaceAllocationVersion,
		repositoryIdentityRevision: row.run.repositoryIdentityRevision,
		attestationDigest: row.run.admissionAttestationDigest,
	};
	return {
		...candidateWithoutDigest,
		routingSnapshotDigest: canonicalDigest({
			taskRevision: row.task.revision,
			...candidateWithoutDigest,
		}),
	} satisfies CodingAgentInterruptedRunCandidate;
}
