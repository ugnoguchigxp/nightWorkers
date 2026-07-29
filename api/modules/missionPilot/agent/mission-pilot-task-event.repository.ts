import crypto from "node:crypto";
import { and, asc, eq, isNull, lte } from "drizzle-orm";
import type { MissionPilotTaskEventType } from "../../../../shared/modules/missionPilot";
import { db } from "../../../db/client";
import {
	missionPilotAgentSessions,
	missionPilotTaskEventInbox,
} from "../../../db/mission-pilot-agent-schema";
import { missionPilotSessions } from "../../../db/mission-pilot-schema";

class MissionPilotEventSequenceConflictError extends Error {}

export async function appendMissionPilotTaskEvent(input: {
	taskId: string;
	eventType: MissionPilotTaskEventType;
	sourceEventId: string;
	taskRevision: number;
	payload: unknown;
	availableAt?: Date;
}) {
	for (let attempt = 1; attempt <= 5; attempt += 1) {
		try {
			return await appendMissionPilotTaskEventOnce(input);
		} catch (error) {
			if (
				!(error instanceof MissionPilotEventSequenceConflictError) ||
				attempt === 5
			)
				throw error;
		}
	}
	return null;
}

async function appendMissionPilotTaskEventOnce(input: {
	taskId: string;
	eventType: MissionPilotTaskEventType;
	sourceEventId: string;
	taskRevision: number;
	payload: unknown;
	availableAt?: Date;
}) {
	return db.transaction(async (tx) => {
		const [session] = await tx
			.select()
			.from(missionPilotSessions)
			.where(eq(missionPilotSessions.taskId, input.taskId));
		const [agent] = session
			? await tx
					.select()
					.from(missionPilotAgentSessions)
					.where(eq(missionPilotAgentSessions.sessionId, session.id))
			: [];
		if (
			!session ||
			!agent ||
			session.desiredState !== "playing" ||
			agent.engineMode !== "agent"
		)
			return null;
		const [existing] = await tx
			.select()
			.from(missionPilotTaskEventInbox)
			.where(
				and(
					eq(missionPilotTaskEventInbox.sessionId, session.id),
					eq(missionPilotTaskEventInbox.sourceEventId, input.sourceEventId),
				),
			);
		if (existing) return existing;
		const sequence = agent.nextEventSequence;
		const [advanced] = await tx
			.update(missionPilotAgentSessions)
			.set({ nextEventSequence: sequence + 1, updatedAt: new Date() })
			.where(
				and(
					eq(missionPilotAgentSessions.sessionId, session.id),
					eq(missionPilotAgentSessions.nextEventSequence, sequence),
				),
			)
			.returning({ sessionId: missionPilotAgentSessions.sessionId });
		if (!advanced) throw new MissionPilotEventSequenceConflictError();
		const [created] = await tx
			.insert(missionPilotTaskEventInbox)
			.values({
				id: crypto.randomUUID(),
				sessionId: session.id,
				taskId: input.taskId,
				sequence,
				eventType: input.eventType,
				sourceEventId: input.sourceEventId,
				taskRevision: input.taskRevision,
				payloadJson: input.payload,
				availableAt: input.availableAt ?? new Date(),
				createdAt: new Date(),
			})
			.returning();
		return created ?? null;
	});
}

export async function projectMissionPilotExecutionEvent(input: {
	taskId: string;
	type: "task.run.started" | "task.run.terminal" | "task.run.failed";
	runId: string;
}) {
	const terminal =
		input.type === "task.run.terminal" || input.type === "task.run.failed";
	const [updated] = await db
		.update(missionPilotSessions)
		.set({
			activeRunId: terminal ? null : input.runId,
			phase: terminal ? "review" : "implementation",
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(missionPilotSessions.taskId, input.taskId),
				eq(missionPilotSessions.desiredState, "playing"),
			),
		)
		.returning();
	return updated ?? null;
}

export async function listPendingMissionPilotTaskEvents(
	sessionId: string,
	now = new Date(),
) {
	return db
		.select()
		.from(missionPilotTaskEventInbox)
		.where(
			and(
				eq(missionPilotTaskEventInbox.sessionId, sessionId),
				isNull(missionPilotTaskEventInbox.consumedAt),
				lte(missionPilotTaskEventInbox.availableAt, now),
			),
		)
		.orderBy(asc(missionPilotTaskEventInbox.sequence));
}

export async function getNextMissionPilotTaskEventAt(sessionId: string) {
	const [event] = await db
		.select({ availableAt: missionPilotTaskEventInbox.availableAt })
		.from(missionPilotTaskEventInbox)
		.where(
			and(
				eq(missionPilotTaskEventInbox.sessionId, sessionId),
				isNull(missionPilotTaskEventInbox.consumedAt),
			),
		)
		.orderBy(asc(missionPilotTaskEventInbox.availableAt))
		.limit(1);
	return event?.availableAt ?? null;
}

export async function consumeMissionPilotTaskEventBySource(
	sessionId: string,
	sourceEventId: string,
) {
	const [updated] = await db
		.update(missionPilotTaskEventInbox)
		.set({ consumedAt: new Date() })
		.where(
			and(
				eq(missionPilotTaskEventInbox.sessionId, sessionId),
				eq(missionPilotTaskEventInbox.sourceEventId, sourceEventId),
				isNull(missionPilotTaskEventInbox.consumedAt),
			),
		)
		.returning({ id: missionPilotTaskEventInbox.id });
	return Boolean(updated);
}

export async function cancelMissionPilotProviderRetryEvents(sessionId: string) {
	return db
		.update(missionPilotTaskEventInbox)
		.set({ consumedAt: new Date() })
		.where(
			and(
				eq(missionPilotTaskEventInbox.sessionId, sessionId),
				eq(
					missionPilotTaskEventInbox.eventType,
					"mission_pilot.retry_timer_elapsed",
				),
				isNull(missionPilotTaskEventInbox.consumedAt),
			),
		);
}
