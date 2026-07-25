import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "../../db/client";
import {
	missionPilotAgentSessions,
	missionPilotConversationItems,
	missionPilotToolCalls,
} from "../../db/mission-pilot-agent-schema";
import {
	missionPilotArtifactCorrectionRuns,
	missionPilotCloseouts,
	missionPilotEvents,
	missionPilotPhaseRuns,
	missionPilotReviewDecisions,
	missionPilotSessions,
	missionPilotVerificationSnapshots,
} from "../../db/mission-pilot-schema";
import { activityEvents, taskMessages } from "../../db/schema";
import { MissionPilotError } from "./mission-pilot.errors";
import {
	buildMissionPilotThoughtEntries,
	projectMissionPilotAgentVisibleItems,
} from "./mission-pilot-thought-projection";

export {
	buildMissionPilotThoughtEntries,
	projectMissionPilotAgentVisibleItems,
} from "./mission-pilot-thought-projection";

export function attachArtifactCorrectionRequests<
	T extends { payloadJson: unknown },
	C extends {
		id: string;
		target: string;
		focusJson: unknown;
		instruction: string;
		preserveUnfocusedContent: boolean;
	},
>(events: readonly T[], correctionRuns: readonly C[]): T[] {
	const correctionById = new Map(correctionRuns.map((run) => [run.id, run]));
	return events.map((event) => {
		const payload =
			event.payloadJson &&
			typeof event.payloadJson === "object" &&
			!Array.isArray(event.payloadJson)
				? (event.payloadJson as Record<string, unknown>)
				: null;
		if (!payload || payload.correctionRequest) return event;
		const correctionRunId = payload.correctionRunId;
		if (typeof correctionRunId !== "string") return event;
		const correction = correctionById.get(correctionRunId);
		if (!correction) return event;
		return {
			...event,
			payloadJson: {
				...payload,
				correctionRequest: {
					target: correction.target,
					focus: correction.focusJson,
					instruction: correction.instruction,
					preserveUnfocusedContent: correction.preserveUnfocusedContent,
				},
			},
		};
	});
}

export async function getMissionPilotExecution(sessionId: string) {
	const [session] = await db
		.select()
		.from(missionPilotSessions)
		.where(eq(missionPilotSessions.id, sessionId))
		.limit(1);
	if (!session)
		throw new MissionPilotError(
			404,
			"MISSION_PILOT_NOT_FOUND",
			"Mission Pilot session not found",
		);
	const [
		phaseRuns,
		verificationSnapshots,
		reviewDecisions,
		closeouts,
		events,
		artifactCorrectionRuns,
	] = await Promise.all([
		db
			.select()
			.from(missionPilotPhaseRuns)
			.where(eq(missionPilotPhaseRuns.sessionId, sessionId))
			.orderBy(desc(missionPilotPhaseRuns.startedAt)),
		db
			.select()
			.from(missionPilotVerificationSnapshots)
			.where(eq(missionPilotVerificationSnapshots.sessionId, sessionId))
			.orderBy(desc(missionPilotVerificationSnapshots.createdAt)),
		db
			.select()
			.from(missionPilotReviewDecisions)
			.where(eq(missionPilotReviewDecisions.sessionId, sessionId))
			.orderBy(desc(missionPilotReviewDecisions.createdAt)),
		db
			.select()
			.from(missionPilotCloseouts)
			.where(eq(missionPilotCloseouts.sessionId, sessionId))
			.orderBy(desc(missionPilotCloseouts.attempt)),
		db
			.select()
			.from(missionPilotEvents)
			.where(eq(missionPilotEvents.sessionId, sessionId))
			.orderBy(asc(missionPilotEvents.createdAt), asc(missionPilotEvents.id)),
		db
			.select({
				id: missionPilotArtifactCorrectionRuns.id,
				target: missionPilotArtifactCorrectionRuns.target,
				focusJson: missionPilotArtifactCorrectionRuns.focusJson,
				instruction: missionPilotArtifactCorrectionRuns.instruction,
				preserveUnfocusedContent:
					missionPilotArtifactCorrectionRuns.preserveUnfocusedContent,
			})
			.from(missionPilotArtifactCorrectionRuns)
			.where(eq(missionPilotArtifactCorrectionRuns.sessionId, sessionId)),
	]);
	const [pilotActivityEvents, pilotMessages, agentRows] = await Promise.all([
		db
			.select()
			.from(activityEvents)
			.where(
				and(
					eq(activityEvents.taskId, session.taskId),
					eq(activityEvents.traceOwner, "mission_pilot"),
					eq(activityEvents.traceChannel, "pilot_thought"),
				),
			)
			.orderBy(
				asc(activityEvents.seq),
				asc(activityEvents.createdAt),
				asc(activityEvents.id),
			),
		db
			.select()
			.from(taskMessages)
			.where(
				and(
					eq(taskMessages.taskId, session.taskId),
					eq(taskMessages.traceOwner, "mission_pilot"),
					eq(taskMessages.traceChannel, "pilot_thought"),
				),
			)
			.orderBy(asc(taskMessages.createdAt), asc(taskMessages.id)),
		db
			.select({
				sessionId: missionPilotAgentSessions.sessionId,
				conversationRevision: missionPilotAgentSessions.conversationRevision,
			})
			.from(missionPilotAgentSessions)
			.where(eq(missionPilotAgentSessions.sessionId, sessionId))
			.limit(1),
	]);
	const agent = agentRows[0] ?? null;
	const [agentItems, toolCalls] = agent
		? await Promise.all([
				db
					.select()
					.from(missionPilotConversationItems)
					.where(eq(missionPilotConversationItems.sessionId, sessionId))
					.orderBy(asc(missionPilotConversationItems.sequence)),
				db
					.select()
					.from(missionPilotToolCalls)
					.where(eq(missionPilotToolCalls.sessionId, sessionId))
					.orderBy(
						asc(missionPilotToolCalls.createdAt),
						asc(missionPilotToolCalls.id),
					),
			])
		: [[], []];
	const projectedActivityEvents = attachArtifactCorrectionRequests(
		pilotActivityEvents,
		artifactCorrectionRuns,
	);
	return {
		session,
		phaseRuns,
		verificationSnapshots,
		reviewDecisions,
		closeouts,
		events,
		activityEvents: projectedActivityEvents,
		messages: pilotMessages,
		entries: buildMissionPilotThoughtEntries({
			sessionId,
			events,
			activityEvents: projectedActivityEvents,
			messages: pilotMessages,
			conversationItems: agentItems,
			toolCalls,
		}),
		agent: agent
			? {
					sessionId: agent.sessionId,
					conversationRevision: agent.conversationRevision,
					visibleItems: projectMissionPilotAgentVisibleItems(agentItems),
				}
			: null,
	};
}

export async function getMissionPilotExecutionForTask(taskId: string) {
	const [session] = await db
		.select({ id: missionPilotSessions.id })
		.from(missionPilotSessions)
		.where(eq(missionPilotSessions.taskId, taskId))
		.limit(1);
	if (!session)
		throw new MissionPilotError(
			404,
			"MISSION_PILOT_NOT_FOUND",
			"Mission Pilot session not found",
		);
	return getMissionPilotExecution(session.id);
}

export async function getLatestMissionPilotVerificationSnapshot(
	sessionId: string,
) {
	const [row] = await db
		.select()
		.from(missionPilotVerificationSnapshots)
		.where(eq(missionPilotVerificationSnapshots.sessionId, sessionId))
		.orderBy(desc(missionPilotVerificationSnapshots.createdAt))
		.limit(1);
	return row ?? null;
}

export async function getLatestMissionPilotReviewDecision(sessionId: string) {
	const [row] = await db
		.select()
		.from(missionPilotReviewDecisions)
		.where(eq(missionPilotReviewDecisions.sessionId, sessionId))
		.orderBy(desc(missionPilotReviewDecisions.createdAt))
		.limit(1);
	return row ?? null;
}

export async function getLatestMissionPilotCloseout(sessionId: string) {
	const [row] = await db
		.select()
		.from(missionPilotCloseouts)
		.where(eq(missionPilotCloseouts.sessionId, sessionId))
		.orderBy(desc(missionPilotCloseouts.attempt))
		.limit(1);
	return row ?? null;
}

export async function reconcileMissionPilotExecution(sessionId: string) {
	return getMissionPilotExecution(sessionId);
}
