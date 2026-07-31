import { asc, eq } from "drizzle-orm";
import { db } from "../../db/client";
import {
	missionPilotAgentSessions,
	missionPilotConversationItems,
	missionPilotSessions,
	missionPilotToolCalls,
} from "../storage";
import { readTaskActivityEvents } from "../task";
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
	if (!session) throw notFound();
	const [agentRows, conversationItems, toolCalls, activityEvents] =
		await Promise.all([
			db
				.select({
					sessionId: missionPilotAgentSessions.sessionId,
					conversationRevision: missionPilotAgentSessions.conversationRevision,
				})
				.from(missionPilotAgentSessions)
				.where(eq(missionPilotAgentSessions.sessionId, sessionId))
				.limit(1),
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
			readTaskActivityEvents(session.taskId, {
				traceOwner: "mission_pilot",
				traceChannel: "pilot_thought",
			}),
		]);
	const agent = agentRows[0] ?? null;
	return {
		version: 2 as const,
		executionModel: "task_operator_v1" as const,
		session,
		activityEvents,
		entries: buildMissionPilotThoughtEntries({
			sessionId,
			events: [],
			activityEvents,
			messages: [],
			conversationItems,
			toolCalls,
		}),
		agent: agent
			? {
					sessionId: agent.sessionId,
					conversationRevision: agent.conversationRevision,
					visibleItems: projectMissionPilotAgentVisibleItems(conversationItems),
				}
			: null,
		legacyPostQueueState: {
			status: "retired" as const,
			retiredFields: [
				"phaseRuns",
				"verificationSnapshots",
				"reviewDecisions",
				"closeouts",
				"events",
				"messages",
			],
			replacement: {
				execution: "task_operator_v1",
				resources: ["run_outcome", "task_timeline", "task_message"],
			},
		},
	};
}

export async function getMissionPilotExecutionForTask(taskId: string) {
	const [session] = await db
		.select({ id: missionPilotSessions.id })
		.from(missionPilotSessions)
		.where(eq(missionPilotSessions.taskId, taskId))
		.limit(1);
	if (!session) throw notFound();
	return getMissionPilotExecution(session.id);
}

export async function getLatestMissionPilotVerificationSnapshot(
	sessionId: string,
) {
	await assertSession(sessionId);
	throw legacyEndpointRetired("run_outcome");
}

export async function getLatestMissionPilotReviewDecision(sessionId: string) {
	await assertSession(sessionId);
	throw legacyEndpointRetired("run_outcome");
}

export async function getLatestMissionPilotCloseout(sessionId: string) {
	await assertSession(sessionId);
	throw legacyEndpointRetired("run_outcome");
}

export async function reconcileMissionPilotExecution(sessionId: string) {
	return getMissionPilotExecution(sessionId);
}

async function assertSession(sessionId: string) {
	const [session] = await db
		.select({ id: missionPilotSessions.id })
		.from(missionPilotSessions)
		.where(eq(missionPilotSessions.id, sessionId));
	if (!session) throw notFound();
}

function notFound() {
	return new MissionPilotError(
		404,
		"MISSION_PILOT_NOT_FOUND",
		"Mission Pilot session not found",
	);
}

function legacyEndpointRetired(replacementResourceKind: string) {
	return new MissionPilotError(
		410,
		"MISSION_PILOT_LEGACY_ENDPOINT_RETIRED",
		"Legacy Mission Pilot post-Queue state has been retired.",
		{
			replacement: {
				execution: "task_operator_v1",
				resourceKind: replacementResourceKind,
			},
		},
	);
}
