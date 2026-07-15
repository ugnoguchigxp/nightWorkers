import { and, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { db } from "../../../db/client";
import {
	missionPilotAgentTurns,
	missionPilotToolCalls,
} from "../../../db/mission-pilot-agent-schema";
import { missionPilotSessions } from "../../../db/mission-pilot-schema";
import { MISSION_PILOT_AGENT_LEASE_MS } from "./mission-pilot-agent.constants";
import { completeMissionPilotToolCall } from "./mission-pilot-conversation.repository";

export async function cancelPendingMissionPilotToolCalls(
	sessionId: string,
	reason: "stopped" | "resource_limit" = "stopped",
) {
	const pending = await db
		.select({
			id: missionPilotToolCalls.id,
			actionId: missionPilotToolCalls.actionId,
			idempotencyKey: missionPilotToolCalls.idempotencyKey,
		})
		.from(missionPilotToolCalls)
		.where(
			and(
				eq(missionPilotToolCalls.sessionId, sessionId),
				eq(missionPilotToolCalls.status, "pending"),
			),
		);
	for (const call of pending) {
		await completeMissionPilotToolCall({
			id: call.id,
			cancelled: true,
			failure: {
				kind:
					reason === "resource_limit"
						? "resource_limit"
						: "domain_precondition",
				retryable: false,
				providerCode:
					reason === "resource_limit"
						? "MISSION_PILOT_RESOURCE_LIMIT"
						: "MISSION_PILOT_STOPPED",
				httpStatus: null,
				message:
					reason === "resource_limit"
						? "Mission Pilot reached the per-wake resource limit before this action started."
						: "Mission Pilot was stopped before this action started.",
				retryAfterMs: null,
				attempt: 1,
				actionId: call.actionId,
				idempotencyKey: call.idempotencyKey,
			},
		});
	}
	return pending.length;
}

export async function renewMissionPilotAgentTurnLease(input: {
	sessionId: string;
	turnId: string;
	leaseOwner: string;
}) {
	const [turn] = await db
		.select({ id: missionPilotAgentTurns.id })
		.from(missionPilotAgentTurns)
		.where(
			and(
				eq(missionPilotAgentTurns.id, input.turnId),
				eq(missionPilotAgentTurns.sessionId, input.sessionId),
				inArray(missionPilotAgentTurns.status, ["running", "waiting_tool"]),
			),
		);
	if (!turn) return false;
	const now = new Date();
	const [session] = await db
		.update(missionPilotSessions)
		.set({
			leaseExpiresAt: new Date(now.getTime() + MISSION_PILOT_AGENT_LEASE_MS),
			updatedAt: now,
		})
		.where(
			and(
				eq(missionPilotSessions.id, input.sessionId),
				eq(missionPilotSessions.desiredState, "playing"),
				eq(missionPilotSessions.runtimeState, "running"),
				eq(missionPilotSessions.leaseOwner, input.leaseOwner),
			),
		)
		.returning({ id: missionPilotSessions.id });
	return Boolean(session);
}

export async function resumeMissionPilotAgentTurnAfterTools(input: {
	sessionId: string;
	turnId: string;
	leaseOwner: string;
}) {
	if (!(await renewMissionPilotAgentTurnLease(input))) return false;
	const [turn] = await db
		.update(missionPilotAgentTurns)
		.set({ status: "running" })
		.where(
			and(
				eq(missionPilotAgentTurns.id, input.turnId),
				eq(missionPilotAgentTurns.sessionId, input.sessionId),
				eq(missionPilotAgentTurns.status, "waiting_tool"),
			),
		)
		.returning({ id: missionPilotAgentTurns.id });
	return Boolean(turn);
}

export async function finishMissionPilotAgentTurn(input: {
	sessionId: string;
	turnId: string;
	leaseOwner: string;
	state: "waiting" | "attention" | "completed" | "stopped";
	error?: unknown;
}) {
	const now = new Date();
	await db.transaction(async (tx) => {
		await tx
			.update(missionPilotAgentTurns)
			.set({
				status:
					input.state === "stopped"
						? "cancelled"
						: input.error
							? "failed"
							: "completed",
				finishedAt: now,
				errorJson: input.error ?? null,
			})
			.where(
				and(
					eq(missionPilotAgentTurns.id, input.turnId),
					inArray(missionPilotAgentTurns.status, ["running", "waiting_tool"]),
				),
			);
		await tx
			.update(missionPilotSessions)
			.set({
				runtimeState: input.state,
				leaseOwner: null,
				leaseExpiresAt: null,
				updatedAt: now,
			})
			.where(
				and(
					eq(missionPilotSessions.id, input.sessionId),
					eq(missionPilotSessions.leaseOwner, input.leaseOwner),
				),
			);
	});
}

export async function reconcileInterruptedMissionPilotAgentSessions(
	now = new Date(),
) {
	const sessions = await db
		.select()
		.from(missionPilotSessions)
		.where(
			and(
				eq(missionPilotSessions.runtimeKind, "agent"),
				eq(missionPilotSessions.runtimeState, "running"),
				or(
					isNull(missionPilotSessions.leaseExpiresAt),
					lte(missionPilotSessions.leaseExpiresAt, now),
				),
			),
		);
	const runningCalls = sessions.length
		? await db
				.select()
				.from(missionPilotToolCalls)
				.where(
					and(
						inArray(
							missionPilotToolCalls.sessionId,
							sessions.map((session) => session.id),
						),
						eq(missionPilotToolCalls.status, "running"),
					),
				)
		: [];
	for (const call of runningCalls) {
		await completeMissionPilotToolCall({
			id: call.id,
			failure: {
				kind: "outcome_unknown",
				retryable: null,
				providerCode: null,
				httpStatus: null,
				message:
					"Process stopped while this mutation was running. Re-read current state before deciding whether to retry.",
				retryAfterMs: null,
				attempt: 1,
				actionId: call.actionId,
				idempotencyKey: call.idempotencyKey,
			},
		});
	}
	for (const session of sessions) {
		await db
			.update(missionPilotAgentTurns)
			.set({
				status: "failed",
				finishedAt: now,
				errorJson: { kind: "outcome_unknown", reason: "lease_expired" },
			})
			.where(
				and(
					eq(missionPilotAgentTurns.sessionId, session.id),
					inArray(missionPilotAgentTurns.status, ["running", "waiting_tool"]),
				),
			);
		await db
			.update(missionPilotSessions)
			.set({
				runtimeState: session.desiredState === "playing" ? "idle" : "stopped",
				leaseOwner: null,
				leaseExpiresAt: null,
				updatedAt: now,
			})
			.where(eq(missionPilotSessions.id, session.id));
	}
	return sessions;
}
