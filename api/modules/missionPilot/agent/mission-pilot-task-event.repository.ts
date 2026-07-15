import crypto from "node:crypto";
import { and, asc, eq, isNull, lte } from "drizzle-orm";
import type { MissionPilotTaskEventType } from "../../../../shared/schemas/mission-pilot-agent.schema";
import { db } from "../../../db/client";
import { missionPilotTaskEventInbox } from "../../../db/mission-pilot-agent-schema";
import { missionPilotSessions } from "../../../db/mission-pilot-schema";

export async function appendMissionPilotTaskEvent(input: {
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
		if (session?.runtimeKind !== "agent") return null;
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
		const sequence = session.nextEventSequence;
		const [claimed] = await tx
			.update(missionPilotSessions)
			.set({
				nextEventSequence: sequence + 1,
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(missionPilotSessions.id, session.id),
					eq(missionPilotSessions.nextEventSequence, sequence),
				),
			)
			.returning({ id: missionPilotSessions.id });
		if (!claimed) throw new Error("Mission Pilot event sequence conflict");
		const now = new Date();
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
				availableAt: input.availableAt ?? now,
				createdAt: now,
			})
			.returning();
		return created ?? null;
	});
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
