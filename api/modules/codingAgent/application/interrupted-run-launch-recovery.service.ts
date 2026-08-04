import { and, eq, sql } from "drizzle-orm";
import { db } from "../../../db/client";
import {
	implementationQueueEntries,
	taskRuns,
	tasks,
} from "../../../db/schema";
import { redactSecretText } from "../../../services/security/secret-redaction";
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

export async function restoreInterruptedCodingAgentRunAfterLaunchFailure(input: {
	runId: string;
	expectedInterruptionRevision: number;
	error: unknown;
	owner?: CodingAgentExecutionOwnerIdentity;
	now?: Date;
}) {
	const owner = input.owner ?? getCodingAgentExecutionOwnerIdentity();
	const now = input.now ?? new Date();
	const restored = await db.transaction(async (tx) => {
		const [execution] = await tx
			.select()
			.from(codingAgentRunExecutions)
			.where(eq(codingAgentRunExecutions.runId, input.runId));
		if (
			execution?.status !== "active" ||
			execution.ownerKind !== owner.kind ||
			execution.ownerInstanceId !== owner.instanceId ||
			execution.interruptionRevision !== input.expectedInterruptionRevision
		) {
			return null;
		}
		const pause = readProcessInterruptionSnapshot({
			runtimePause: execution.interruptionSnapshotJson,
		});
		if (!pause || pause.revision !== input.expectedInterruptionRevision) {
			return null;
		}
		const [run] = await tx
			.select()
			.from(taskRuns)
			.where(eq(taskRuns.id, input.runId));
		if (run?.status !== "running") return null;
		const [interruptedExecution] = await tx
			.update(codingAgentRunExecutions)
			.set({
				status: "interrupted",
				heartbeatAt: now,
				leaseExpiresAt: now,
				updatedAt: now,
			})
			.where(
				and(
					eq(codingAgentRunExecutions.runId, run.id),
					eq(codingAgentRunExecutions.status, "active"),
					eq(codingAgentRunExecutions.ownerKind, owner.kind),
					eq(codingAgentRunExecutions.ownerInstanceId, owner.instanceId),
					eq(codingAgentRunExecutions.leaseVersion, execution.leaseVersion),
				),
			)
			.returning();
		if (!interruptedExecution) throw new InterruptionConflict();
		const [interruptedRun] = await tx
			.update(taskRuns)
			.set({
				status: "needs_human",
				contextSnapshot: mergeRuntimePause(run.contextSnapshot, pause),
				updatedAt: now,
			})
			.where(and(eq(taskRuns.id, run.id), eq(taskRuns.status, "running")))
			.returning();
		if (!interruptedRun) throw new InterruptionConflict();
		const [interruptedTask] = await tx
			.update(tasks)
			.set({ status: "needs_human", updatedAt: now })
			.where(and(eq(tasks.id, run.taskId), eq(tasks.status, "running")))
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
				recoveryReason: "process_interrupted_resume_launch_failed",
				statusReason: "Coding Agent resume failed before runtime launch.",
				leaseVersion: sql`${implementationQueueEntries.leaseVersion} + 1`,
				updatedAt: now,
			})
			.where(
				and(
					eq(implementationQueueEntries.activeRunId, run.id),
					eq(implementationQueueEntries.status, "processing"),
				),
			);
		return { run: interruptedRun, pause };
	});
	if (!restored) return null;
	const errorMessage = redactSecretText(
		input.error instanceof Error ? input.error.message : String(input.error),
	).slice(0, 2_000);
	await Promise.allSettled([
		nightworkersRepo.createRunEvent({
			version: 1,
			runId: restored.run.id,
			taskId: restored.run.taskId,
			timestamp: now.toISOString(),
			type: "system.error",
			severity: "error",
			actor: "system",
			message:
				"Interrupted Coding Agent Run could not launch and remains resumable.",
			data: {
				action: "coding_agent.interrupted_run_resume_launch_failed",
				interruptionRevision: restored.pause.revision,
				error: errorMessage,
			},
		}),
		nightworkersRepo.createTaskMessage({
			taskId: restored.run.taskId,
			runId: restored.run.id,
			role: "system",
			content: `同じCoding Agent Runの再開準備に失敗したため、中断状態を保持しました: ${errorMessage}`,
			messageType: "text",
			payloadJson: {
				intent: "coding_agent_resume_launch_failed",
				interruptionRevision: restored.pause.revision,
				error: errorMessage,
			},
		}),
		nightworkersRepo.publishTaskRunUpdate(restored.run),
	]);
	return restored.run;
}

function mergeRuntimePause(
	value: unknown,
	pause: CodingAgentProcessInterruptionSnapshot,
) {
	const context =
		value && typeof value === "object" && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: {};
	return { ...context, runtimePause: pause };
}

class InterruptionConflict extends Error {}
