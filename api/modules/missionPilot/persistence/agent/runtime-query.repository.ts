import crypto from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../../../../db/client";
import {
	missionPilotAgentSessions,
	missionPilotAgentTurns,
	missionPilotSessions,
	missionPilotToolCalls,
} from "../index";

export async function readMissionPilotTaskActionState(input: {
	sessionId: string;
	taskId: string;
	toolCallId: string;
	actionId: string;
	idempotencyKey: string;
}) {
	const [session, toolCall, agent] = await Promise.all([
		db
			.select()
			.from(missionPilotSessions)
			.where(
				and(
					eq(missionPilotSessions.id, input.sessionId),
					eq(missionPilotSessions.taskId, input.taskId),
				),
			)
			.limit(1)
			.then((rows) => rows[0] ?? null),
		db
			.select()
			.from(missionPilotToolCalls)
			.where(
				and(
					eq(missionPilotToolCalls.id, input.toolCallId),
					eq(missionPilotToolCalls.sessionId, input.sessionId),
					eq(missionPilotToolCalls.actionId, input.actionId),
					eq(missionPilotToolCalls.idempotencyKey, input.idempotencyKey),
				),
			)
			.limit(1)
			.then((rows) => rows[0] ?? null),
		db
			.select()
			.from(missionPilotAgentSessions)
			.where(eq(missionPilotAgentSessions.sessionId, input.sessionId))
			.limit(1)
			.then((rows) => rows[0] ?? null),
	]);
	return { session, toolCall, agent };
}

export function listMissionPilotToolCalls(sessionId: string) {
	return db
		.select()
		.from(missionPilotToolCalls)
		.where(eq(missionPilotToolCalls.sessionId, sessionId))
		.orderBy(
			asc(missionPilotToolCalls.createdAt),
			asc(missionPilotToolCalls.id),
		);
}

export async function prepareExpiredMissionPilotRuntimeFixture(input: {
	sessionId: string;
	now: Date;
}) {
	if (process.env.NIGHTWORKERS_E2E_ISOLATED !== "1")
		throw new Error("Mission Pilot runtime fixtures are disabled.");
	const [agent] = await db
		.select()
		.from(missionPilotAgentSessions)
		.where(eq(missionPilotAgentSessions.sessionId, input.sessionId))
		.limit(1);
	if (!agent || agent.runtimeState === "completed") return null;
	const turnId = crypto.randomUUID();
	await db.transaction(async (tx) => {
		await tx.insert(missionPilotAgentTurns).values({
			id: turnId,
			sessionId: input.sessionId,
			turnIndex: agent.nextTurnIndex,
			status: "running",
			startedAt: new Date(input.now.getTime() - 10_000),
		});
		await tx
			.update(missionPilotAgentSessions)
			.set({
				runtimeState: "running",
				currentTurnId: turnId,
				leaseOwner: "expired-e2e-runtime",
				leaseExpiresAt: new Date(0),
				nextTurnIndex: agent.nextTurnIndex + 1,
				updatedAt: input.now,
			})
			.where(eq(missionPilotAgentSessions.sessionId, input.sessionId));
	});
	return { turnId };
}
