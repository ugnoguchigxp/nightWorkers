import crypto from "node:crypto";
import { asc, eq } from "drizzle-orm";
import type { MissionPilotRepairRequest } from "../../../../shared/schemas/mission-pilot-agent.schema";
import { db } from "../../../db/client";
import { missionPilotRepairRequests } from "../../../db/mission-pilot-agent-schema";

export async function createMissionPilotRepairRequest(input: {
	sessionId: string;
	sourceRunId?: string | null;
	request: MissionPilotRepairRequest;
	sourceRevision: number;
	sourceDigest: string;
}) {
	const now = new Date();
	const [row] = await db
		.insert(missionPilotRepairRequests)
		.values({
			id: crypto.randomUUID(),
			sessionId: input.sessionId,
			sourceRunId: input.sourceRunId ?? null,
			requestJson: input.request,
			sourceRevision: input.sourceRevision,
			sourceDigest: input.sourceDigest,
			status: "requested",
			createdAt: now,
			updatedAt: now,
		})
		.returning();
	return row ?? null;
}
export async function listMissionPilotRepairRequests(sessionId: string) {
	return db
		.select()
		.from(missionPilotRepairRequests)
		.where(eq(missionPilotRepairRequests.sessionId, sessionId))
		.orderBy(asc(missionPilotRepairRequests.createdAt));
}
