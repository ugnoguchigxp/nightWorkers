import crypto from "node:crypto";
import type { MissionPilotTaskEventType } from "@nightworkers/mission-pilot/contracts";
import { and, asc, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { db } from "../../../../db/client";
import {
	missionPilotAgentSessions,
	missionPilotSessions,
	missionPilotTaskEventInbox,
} from "../index";

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
			const event = await appendMissionPilotTaskEventOnce(input);
			if (event) await projectMissionPilotNextWakeAt(event.sessionId);
			return event;
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

export async function projectMissionPilotNextWakeAt(
	sessionId: string,
	now = new Date(),
) {
	return db.transaction(async (tx) => {
		const [session] = await tx
			.select()
			.from(missionPilotSessions)
			.where(eq(missionPilotSessions.id, sessionId));
		if (session?.desiredState !== "playing") return session ?? null;
		const [event] = await tx
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
		const nextWakeAt =
			event?.availableAt && event.availableAt.getTime() > now.getTime()
				? event.availableAt
				: null;
		if (
			(session.nextWakeAt?.getTime() ?? null) ===
			(nextWakeAt?.getTime() ?? null)
		)
			return session;
		const [updated] = await tx
			.update(missionPilotSessions)
			.set({
				nextWakeAt,
				version: sql`${missionPilotSessions.version} + 1`,
				updatedAt: now,
			})
			.where(
				and(
					eq(missionPilotSessions.id, sessionId),
					eq(missionPilotSessions.desiredState, "playing"),
				),
			)
			.returning();
		return updated ?? session;
	});
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
	if (updated) await projectMissionPilotNextWakeAt(sessionId);
	return Boolean(updated);
}

export async function consumePendingMissionPilotQuestionnaireEvents(input: {
	sessionId: string;
	questionnaireSessionId: string;
	status: string;
}) {
	const events = await db
		.select({
			id: missionPilotTaskEventInbox.id,
			payloadJson: missionPilotTaskEventInbox.payloadJson,
		})
		.from(missionPilotTaskEventInbox)
		.where(
			and(
				eq(missionPilotTaskEventInbox.sessionId, input.sessionId),
				eq(missionPilotTaskEventInbox.eventType, "questionnaire.state_changed"),
				isNull(missionPilotTaskEventInbox.consumedAt),
			),
		);
	const ids = events
		.filter((event) => {
			const payload =
				event.payloadJson &&
				typeof event.payloadJson === "object" &&
				!Array.isArray(event.payloadJson)
					? (event.payloadJson as Record<string, unknown>)
					: {};
			return (
				payload.questionnaireSessionId === input.questionnaireSessionId &&
				payload.status === input.status
			);
		})
		.map((event) => event.id);
	if (ids.length === 0) return 0;
	const consumed = await db
		.update(missionPilotTaskEventInbox)
		.set({ consumedAt: new Date() })
		.where(
			and(
				eq(missionPilotTaskEventInbox.sessionId, input.sessionId),
				inArray(missionPilotTaskEventInbox.id, ids),
				isNull(missionPilotTaskEventInbox.consumedAt),
			),
		)
		.returning({ id: missionPilotTaskEventInbox.id });
	if (consumed.length > 0) await projectMissionPilotNextWakeAt(input.sessionId);
	return consumed.length;
}

export async function hasConsumedMissionPilotQuestionnaireAnsweringEvent(input: {
	sessionId: string;
	questionnaireSessionId: string;
	now?: Date;
}) {
	const events = await db
		.select({
			payloadJson: missionPilotTaskEventInbox.payloadJson,
			availableAt: missionPilotTaskEventInbox.availableAt,
			consumedAt: missionPilotTaskEventInbox.consumedAt,
		})
		.from(missionPilotTaskEventInbox)
		.where(
			and(
				eq(missionPilotTaskEventInbox.sessionId, input.sessionId),
				eq(missionPilotTaskEventInbox.eventType, "questionnaire.state_changed"),
			),
		)
		.orderBy(desc(missionPilotTaskEventInbox.sequence));
	const latestAnsweringEvent = events.find((event) => {
		const payload =
			event.payloadJson &&
			typeof event.payloadJson === "object" &&
			!Array.isArray(event.payloadJson)
				? (event.payloadJson as Record<string, unknown>)
				: {};
		return (
			payload.questionnaireSessionId === input.questionnaireSessionId &&
			payload.status === "answering"
		);
	});
	return Boolean(
		latestAnsweringEvent?.consumedAt &&
			latestAnsweringEvent.availableAt.getTime() <=
				(input.now ?? new Date()).getTime(),
	);
}

export async function cancelMissionPilotProviderRetryEvents(sessionId: string) {
	const consumed = await db
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
	await projectMissionPilotNextWakeAt(sessionId);
	return consumed;
}
