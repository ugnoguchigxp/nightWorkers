import crypto from "node:crypto";
import { and, asc, eq, lte, sql } from "drizzle-orm";
import { db } from "../../db/client";
import { missionPilotEvents } from "../../db/mission-pilot-schema";

export type AppendMissionPilotEventInput = {
	sessionId: string;
	taskId: string;
	eventType: string;
	phase: string;
	cycle?: number | null;
	contextRevision: number;
	contextDigest: string;
	dedupeKey: string;
	sourceKind:
		| "queue"
		| "task_run"
		| "verification"
		| "review"
		| "git"
		| "task_archive"
		| "coordinator";
	sourceId?: string | null;
	payload?: Record<string, unknown>;
};

export async function appendMissionPilotEvent(
	input: AppendMissionPilotEventInput,
) {
	const now = new Date();
	const inserted = await db
		.insert(missionPilotEvents)
		.values({
			id: crypto.randomUUID(),
			...input,
			cycle: input.cycle ?? null,
			sourceId: input.sourceId ?? null,
			payloadJson: input.payload ?? {},
			processStatus: "pending",
			attemptCount: 0,
			availableAt: now,
			createdAt: now,
			updatedAt: now,
		})
		.onConflictDoNothing({
			target: [missionPilotEvents.sessionId, missionPilotEvents.dedupeKey],
		})
		.returning();
	if (inserted[0]) return { event: inserted[0], duplicate: false } as const;
	const [existing] = await db
		.select()
		.from(missionPilotEvents)
		.where(
			and(
				eq(missionPilotEvents.sessionId, input.sessionId),
				eq(missionPilotEvents.dedupeKey, input.dedupeKey),
			),
		)
		.limit(1);
	return { event: existing, duplicate: true } as const;
}

export async function listProcessableMissionPilotEvents(limit = 25) {
	return db
		.select()
		.from(missionPilotEvents)
		.where(
			and(
				eq(missionPilotEvents.processStatus, "pending"),
				lte(missionPilotEvents.availableAt, new Date()),
			),
		)
		.orderBy(asc(missionPilotEvents.createdAt))
		.limit(limit);
}

export async function markMissionPilotEventProcessed(id: string) {
	const now = new Date();
	const [row] = await db
		.update(missionPilotEvents)
		.set({ processStatus: "processed", processedAt: now, updatedAt: now })
		.where(eq(missionPilotEvents.id, id))
		.returning();
	return row ?? null;
}

export async function rescheduleMissionPilotEvent(
	id: string,
	error: string,
	availableAt: Date,
) {
	const [row] = await db
		.update(missionPilotEvents)
		.set({
			processStatus: "pending",
			attemptCount: sql`${missionPilotEvents.attemptCount} + 1`,
			lastError: error,
			availableAt,
			updatedAt: new Date(),
		})
		.where(eq(missionPilotEvents.id, id))
		.returning();
	return row ?? null;
}
