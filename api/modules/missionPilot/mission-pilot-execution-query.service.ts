import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "../../db/client";
import {
	missionPilotAgentSessions,
	missionPilotConversationItems,
} from "../../db/mission-pilot-agent-schema";
import {
	missionPilotArtifactCorrectionRuns,
	missionPilotCloseouts,
	missionPilotEvents,
	missionPilotPhaseRuns,
	missionPilotReviewDecisions,
	missionPilotSessions,
	missionPilotTestSnapshots,
} from "../../db/mission-pilot-schema";
import { activityEvents, taskMessages } from "../../db/schema";
import { MissionPilotError } from "./mission-pilot.errors";
import { releaseMissionPilotQueueHandoff } from "./mission-pilot-post-queue-coordinator.service";

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
		testSnapshots,
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
			.from(missionPilotTestSnapshots)
			.where(eq(missionPilotTestSnapshots.sessionId, sessionId))
			.orderBy(desc(missionPilotTestSnapshots.createdAt)),
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
	const pilotActivityEvents = await db
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
		);
	const pilotMessages = await db
		.select()
		.from(taskMessages)
		.where(
			and(
				eq(taskMessages.taskId, session.taskId),
				eq(taskMessages.traceOwner, "mission_pilot"),
				eq(taskMessages.traceChannel, "pilot_thought"),
			),
		)
		.orderBy(asc(taskMessages.createdAt), asc(taskMessages.id));
	const [agent] = await db
		.select({
			sessionId: missionPilotAgentSessions.sessionId,
			conversationRevision: missionPilotAgentSessions.conversationRevision,
		})
		.from(missionPilotAgentSessions)
		.where(eq(missionPilotAgentSessions.sessionId, sessionId))
		.limit(1);
	const agentItems = agent
		? await db
				.select()
				.from(missionPilotConversationItems)
				.where(eq(missionPilotConversationItems.sessionId, sessionId))
				.orderBy(asc(missionPilotConversationItems.sequence))
		: [];
	return {
		session,
		phaseRuns,
		testSnapshots,
		reviewDecisions,
		closeouts,
		events,
		activityEvents: attachArtifactCorrectionRequests(
			pilotActivityEvents,
			artifactCorrectionRuns,
		),
		messages: pilotMessages,
		agent: agent
			? {
					sessionId: agent.sessionId,
					conversationRevision: agent.conversationRevision,
					visibleItems: projectMissionPilotAgentVisibleItems(agentItems),
				}
			: null,
	};
}

export function projectMissionPilotAgentVisibleItems(
	items: ReadonlyArray<{ kind: string; sequence: number; bodyJson: unknown }>,
): Array<
	| { kind: "assistant"; sequence: number; content: string }
	| {
			kind: "wait";
			sequence: number;
			eventTypes: unknown[];
			reason: string;
	  }
	| { kind: "finish"; sequence: number; summary: string }
> {
	const projected: Array<
		| { kind: "assistant"; sequence: number; content: string }
		| {
				kind: "wait";
				sequence: number;
				eventTypes: unknown[];
				reason: string;
		  }
		| { kind: "finish"; sequence: number; summary: string }
	> = [];
	for (const item of items) {
		const body = asRecord(item.bodyJson);
		if (item.kind === "assistant") {
			const content = typeof body.content === "string" ? body.content : "";
			if (content)
				projected.push({ kind: "assistant", sequence: item.sequence, content });
			continue;
		}
		if (item.kind !== "tool_result" || typeof body.content !== "string")
			continue;
		try {
			const result = asRecord(JSON.parse(body.content));
			const data = asRecord(result.data);
			if (data.kind === "wait_for_event")
				projected.push({
					kind: "wait",
					sequence: item.sequence,
					eventTypes: Array.isArray(data.eventTypes) ? data.eventTypes : [],
					reason: typeof data.reason === "string" ? data.reason : "",
				});
			if (data.kind === "finish")
				projected.push({
					kind: "finish",
					sequence: item.sequence,
					summary: typeof data.summary === "string" ? data.summary : "",
				});
		} catch {}
	}
	return projected;
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
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

export async function getLatestMissionPilotTestSnapshot(sessionId: string) {
	const [row] = await db
		.select()
		.from(missionPilotTestSnapshots)
		.where(eq(missionPilotTestSnapshots.sessionId, sessionId))
		.orderBy(desc(missionPilotTestSnapshots.createdAt))
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
	await releaseMissionPilotQueueHandoff(session.taskId);
	return getMissionPilotExecution(sessionId);
}
