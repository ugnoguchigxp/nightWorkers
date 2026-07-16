import { and, eq, inArray, ne } from "drizzle-orm";
import {
	type MissionPilotAgentRunProvenance,
	missionPilotAgentRunProvenanceSchema,
} from "../../../../shared/modules/missionPilot";
import { db } from "../../../db/client";
import { missionPilotAgentSessions } from "../../../db/mission-pilot-agent-schema";
import { missionPilotSessions } from "../../../db/mission-pilot-schema";
import type { TaskRunStatus, TaskStatus } from "../../../db/schema";
import { taskRuns, tasks } from "../../../db/schema";
import * as repo from "../nightworkers.repository";

export type MissionPilotTaskStatusOwnership = "agent" | "legacy" | "none";

export function projectMissionPilotTaskStatus(input: {
	runStatus: TaskRunStatus;
	ownership: MissionPilotTaskStatusOwnership;
	sessionDesiredState: "playing" | "stopped" | null;
	currentTaskStatus: TaskStatus;
}): TaskStatus {
	if (["completed", "archived", "cancelled"].includes(input.currentTaskStatus))
		return input.currentTaskStatus;
	if (input.ownership === "agent" && input.sessionDesiredState === "playing")
		return "needs_review";
	if (input.ownership === "agent" && input.sessionDesiredState === "stopped")
		return input.currentTaskStatus;
	return input.runStatus;
}

export async function applyMissionPilotTaskStatusAfterRun(input: {
	taskId: string;
	runId: string;
	runStatus: TaskRunStatus;
}) {
	const [[task], [run]] = await Promise.all([
		db.select().from(tasks).where(eq(tasks.id, input.taskId)).limit(1),
		db.select().from(taskRuns).where(eq(taskRuns.id, input.runId)).limit(1),
	]);
	if (!task || !run || run.taskId !== input.taskId) return null;
	const provenance = readMissionPilotAgentRunProvenance(
		asRecord(run.contextSnapshot).missionPilotAgent,
	);
	if (!provenance) return repo.updateTaskStatus(input.taskId, input.runStatus);
	const [session] = await db
		.select({ desiredState: missionPilotSessions.desiredState })
		.from(missionPilotSessions)
		.innerJoin(
			missionPilotAgentSessions,
			eq(missionPilotAgentSessions.sessionId, missionPilotSessions.id),
		)
		.where(
			and(
				eq(missionPilotAgentSessions.sessionId, provenance.sessionId),
				eq(missionPilotAgentSessions.engineMode, "agent"),
				eq(missionPilotSessions.taskId, input.taskId),
			),
		)
		.limit(1);
	if (!session) return repo.updateTaskStatus(input.taskId, input.runStatus);
	const terminalTask = ["completed", "archived", "cancelled"].includes(
		task.status,
	);
	const [newerActiveRun] = await db
		.select({ id: taskRuns.id })
		.from(taskRuns)
		.where(
			and(
				eq(taskRuns.taskId, input.taskId),
				ne(taskRuns.id, input.runId),
				inArray(taskRuns.status, [
					"running",
					"context_compiling",
					"finalizing",
				]),
			),
		)
		.limit(1);
	if (terminalTask || session.desiredState !== "playing" || newerActiveRun)
		return task;
	const status = projectMissionPilotTaskStatus({
		runStatus: input.runStatus,
		ownership: "agent",
		sessionDesiredState: "playing",
		currentTaskStatus: task.status,
	});
	if (status === task.status) return task;
	return (
		(await repo.updateTaskStatusIfUnchanged({
			id: input.taskId,
			status,
			expectedStatus: task.status,
			expectedUpdatedAt: task.updatedAt,
		})) ?? (await repo.getTask(input.taskId))
	);
}

export function readMissionPilotAgentRunProvenance(
	value: unknown,
): MissionPilotAgentRunProvenance | null {
	const result = missionPilotAgentRunProvenanceSchema.safeParse(value);
	return result.success ? result.data : null;
}

export async function resolveMissionPilotTaskStatusAfterRun(input: {
	taskId: string;
	runId: string;
	runStatus: TaskRunStatus;
}) {
	const [[task], [run]] = await Promise.all([
		db.select().from(tasks).where(eq(tasks.id, input.taskId)).limit(1),
		db.select().from(taskRuns).where(eq(taskRuns.id, input.runId)).limit(1),
	]);
	if (!task || !run || run.taskId !== input.taskId) return input.runStatus;
	const snapshot = asRecord(run.contextSnapshot);
	const provenance = readMissionPilotAgentRunProvenance(
		snapshot.missionPilotAgent,
	);
	if (!provenance) return input.runStatus;
	const [session] = await db
		.select({
			id: missionPilotSessions.id,
			desiredState: missionPilotSessions.desiredState,
		})
		.from(missionPilotSessions)
		.innerJoin(
			missionPilotAgentSessions,
			eq(missionPilotAgentSessions.sessionId, missionPilotSessions.id),
		)
		.where(
			and(
				eq(missionPilotAgentSessions.sessionId, provenance.sessionId),
				eq(missionPilotAgentSessions.engineMode, "agent"),
				eq(missionPilotSessions.taskId, input.taskId),
			),
		)
		.limit(1);
	return projectMissionPilotTaskStatus({
		runStatus: input.runStatus,
		ownership: session ? "agent" : "none",
		sessionDesiredState:
			session?.desiredState === "playing" ? "playing" : "stopped",
		currentTaskStatus: task.status,
	});
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}
