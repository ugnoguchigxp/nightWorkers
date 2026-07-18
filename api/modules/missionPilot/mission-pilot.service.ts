import type { TaskRunStatus } from "../../db/schema";
import {
	isFailureLikeTaskRunStatus,
	registerTaskRunTerminalListener,
} from "../agentsShare";
import * as nightworkersRepo from "../nightworkers/nightworkers.repository";
import { registerTaskMessageCreatedListener } from "../nightworkers/nightworkers.task-message-events";
import { registerQuestionnaireStateChangedListener } from "../questionnaire/questionnaire-events";
import { readTaskOperatorProjection } from "../taskOperator";
import { markMissionPilotAgentTaskActive } from "./agent/mission-pilot-agent-active-registry";
import {
	cancelPendingMissionPilotToolCalls,
	cancelRunningMissionPilotToolCalls,
} from "./agent/mission-pilot-agent-lifecycle.repository";
import {
	isMissionPilotAgentRuntimeActive,
	reconcileInterruptedMissionPilotAgentSessions,
	stopMissionPilotAgentRuntime,
} from "./agent/mission-pilot-agent-runtime";
import {
	backfillStoppedMissionPilotAgentSessions,
	claimAgentPlay,
	claimAgentStop,
	getMissionPilotSessionById,
	isMissionPilotAgentSession,
	listPlayingAgentSessions,
} from "./agent/mission-pilot-agent-session.repository";
import {
	cancelScheduledMissionPilotAgentWake,
	scheduleMissionPilotAgentWake,
} from "./agent/mission-pilot-agent-wake.service";
import { seedMissionPilotConversation } from "./agent/mission-pilot-conversation.repository";
import {
	recordMissionPilotQuestionnaireStateChanged,
	recordMissionPilotTaskEvent,
} from "./agent/mission-pilot-task-event.adapter";
import { appendMissionPilotTaskEvent } from "./agent/mission-pilot-task-event.repository";
import { MissionPilotError } from "./mission-pilot.errors";
import * as repo from "./mission-pilot.repository";
import { publishMissionPilotUpdated } from "./mission-pilot-realtime";
import { registerTaskRunUpdatedListener } from "./mission-pilot-workbench.port";
import { buildMissionPilotSystemContext } from "./prompts/mission-pilot-system-context";

const terminalRunStatuses = new Set<TaskRunStatus>([
	"completed",
	"failed",
	"cancelled",
	"needs_review",
	"blocked",
	"timed_out",
	"needs_human",
]);

let runSyncRegistered = false;

export function initializeMissionPilotRunSync() {
	if (runSyncRegistered) return;
	runSyncRegistered = true;
	registerTaskRunUpdatedListener(async (run) => {
		const session = await repo.getSessionByTaskId(run.taskId);
		if (session && (await isMissionPilotAgentSession(session.id))) {
			if (session.desiredState !== "playing") return;
			const terminal = terminalRunStatuses.has(run.status);
			if (terminal || run.status !== "running") return;
			const task = await nightworkersRepo.getTask(run.taskId);
			if (!task) return;
			const failed = [
				"failed",
				"timed_out",
				"cancelled",
				"blocked",
				"needs_human",
			].includes(run.status);
			await appendMissionPilotTaskEvent({
				taskId: run.taskId,
				eventType: failed
					? "task_run.failed"
					: terminal
						? "task_run.terminal"
						: "task_run.started",
				sourceEventId: `task-run:${run.id}:${run.status}`,
				taskRevision: task.updatedAt.getTime(),
				payload: terminal
					? { runId: run.id, status: run.status }
					: { runId: run.id, status: run.status },
			});
			scheduleMissionPilotAgentWake({ sessionId: session.id });
			return;
		}
	});
}

initializeMissionPilotRunSync();

let terminalRunEventsRegistered = false;
export function initializeMissionPilotTerminalRunEvents() {
	if (terminalRunEventsRegistered) return;
	terminalRunEventsRegistered = true;
	registerTaskRunTerminalListener(async (event) => {
		const run = await nightworkersRepo.getTaskRun(event.runId);
		if (!run) return;
		const session = await repo.getSessionByTaskId(event.taskId);
		if (session && (await isMissionPilotAgentSession(session.id))) {
			if (session.desiredState !== "playing") return;
			const task = await nightworkersRepo.getTask(event.taskId);
			if (!task) return;
			await appendMissionPilotTaskEvent({
				taskId: event.taskId,
				eventType: isFailureLikeTaskRunStatus(event.status)
					? "task_run.failed"
					: "task_run.terminal",
				sourceEventId: event.eventId,
				taskRevision: task.updatedAt.getTime(),
				payload: { runId: event.runId, status: event.status },
			});
			scheduleMissionPilotAgentWake({ sessionId: session.id });
			return;
		}
	});
}
initializeMissionPilotTerminalRunEvents();

let agentTaskMessageCreatedRegistered = false;
function initializeMissionPilotAgentTaskMessageEvents() {
	if (agentTaskMessageCreatedRegistered) return;
	agentTaskMessageCreatedRegistered = true;
	registerTaskMessageCreatedListener(async (message) => {
		if (message.role !== "user") return;
		const metadata =
			message.metadataJson &&
			typeof message.metadataJson === "object" &&
			!Array.isArray(message.metadataJson)
				? (message.metadataJson as Record<string, unknown>)
				: {};
		if (metadata.source === "mission_pilot") return;
		const session = await repo.getSessionByTaskId(message.taskId);
		if (
			session?.desiredState !== "playing" ||
			!(await isMissionPilotAgentSession(session.id))
		)
			return;
		const task = await nightworkersRepo.getTask(message.taskId);
		if (!task) return;
		await recordMissionPilotTaskEvent({
			taskId: message.taskId,
			type: "task.user_message_added",
			sourceEventId: `task-message:${message.id}`,
			taskRevision: task.updatedAt.getTime(),
			payload: { messageId: message.id },
		});
	});
}
initializeMissionPilotAgentTaskMessageEvents();

let agentQuestionnaireEventsRegistered = false;
export function initializeMissionPilotAgentQuestionnaireEvents() {
	if (agentQuestionnaireEventsRegistered) return;
	agentQuestionnaireEventsRegistered = true;
	registerQuestionnaireStateChangedListener(async (questionnaire) => {
		await recordMissionPilotQuestionnaireStateChanged(questionnaire);
	});
}
initializeMissionPilotAgentQuestionnaireEvents();

export async function reconcileMissionPilotStartup() {
	const provisioned = await repo.backfillMissingTaskSessions();
	const migrated = await backfillStoppedMissionPilotAgentSessions();
	const interruptedAgentSessions =
		await reconcileInterruptedMissionPilotAgentSessions();
	for (const session of interruptedAgentSessions) {
		if (session.desiredState === "playing") {
			await appendMissionPilotTaskEvent({
				taskId: session.taskId,
				eventType: "mission_pilot.resume_requested",
				sourceEventId: `startup-resume:${session.id}:${session.version}`,
				taskRevision: session.version,
				payload: { reason: "process_restart" },
			});
			scheduleMissionPilotAgentWake({ sessionId: session.id });
		}
	}
	for (const { session } of await listPlayingAgentSessions()) {
		markMissionPilotAgentTaskActive(session.taskId);
		scheduleMissionPilotAgentWake({ sessionId: session.id });
	}
	return provisioned + migrated + interruptedAgentSessions.length;
}

export async function play(taskId: string, expectedVersion: number) {
	const session = await repo.getSessionByTaskId(taskId);
	if (!session)
		throw new MissionPilotError(
			404,
			"MISSION_PILOT_NOT_FOUND",
			"Mission Pilot session not found",
		);
	if (!(await isMissionPilotAgentSession(session.id)))
		throw new MissionPilotError(
			409,
			"MISSION_PILOT_AGENT_MIGRATION_REQUIRED",
			"Mission Pilot agent migration has not completed",
		);
	const projection = await readTaskOperatorProjection(taskId, {
		principal: {
			kind: "human",
			actorId: "mission-pilot-control",
			authorizationRef: "task-owner",
		},
	});
	if (!(projection.task.objective?.text ?? "").trim())
		throw new MissionPilotError(
			400,
			"MISSION_PILOT_INITIAL_PROMPT_REQUIRED",
			"Mission Pilot requires a non-empty Task Goal",
		);
	return playAgentSession(
		session.id,
		taskId,
		expectedVersion,
		projection.task.revision,
		projection.sourceDigest,
	);
}

export async function stop(taskId: string, expectedVersion: number) {
	const current = await repo.getSessionByTaskId(taskId);
	if (!current)
		throw new MissionPilotError(
			404,
			"MISSION_PILOT_NOT_FOUND",
			"Mission Pilot session not found",
		);
	if (!(await isMissionPilotAgentSession(current.id)))
		throw new MissionPilotError(
			409,
			"MISSION_PILOT_AGENT_MIGRATION_REQUIRED",
			"Mission Pilot agent migration has not completed",
		);
	if (
		current.desiredState === "stopped" &&
		!isMissionPilotAgentRuntimeActive(current.id) &&
		current.lastErrorCode !== "MISSION_PILOT_RUNTIME_STOP_TIMEOUT"
	)
		return { missionPilot: repo.toControlSummary(current), stoppedRun: null };
	const claimed = await claimAgentStop(taskId, expectedVersion);
	if (!claimed)
		throw new MissionPilotError(
			409,
			"MISSION_PILOT_VERSION_CONFLICT",
			"Mission Pilot state changed; refresh and retry",
		);
	publishMissionPilotUpdated(taskId, repo.toControlSummary(claimed));
	const runtimeStop = stopMissionPilotAgentRuntime(claimed.id);
	await cancelScheduledMissionPilotAgentWake(claimed.id);
	const runtimeStopResult = await runtimeStop;
	await cancelPendingMissionPilotToolCalls(claimed.id);
	if (runtimeStopResult.quiesced)
		await cancelRunningMissionPilotToolCalls(claimed.id);
	const stopError = runtimeStopResult.quiesced
		? undefined
		: "Mission Pilot runtime did not acknowledge the stop request in time.";
	const stopErrorCode = runtimeStopResult.quiesced
		? undefined
		: "MISSION_PILOT_RUNTIME_STOP_TIMEOUT";
	const finished = await repo.finishStop(
		taskId,
		claimed.version,
		stopError,
		null,
		stopErrorCode,
	);
	if (!finished)
		throw new MissionPilotError(
			409,
			"MISSION_PILOT_VERSION_CONFLICT",
			"Mission Pilot state changed while finalizing Stop; refresh and retry",
		);
	const missionPilot = repo.toControlSummary(finished);
	publishMissionPilotUpdated(taskId, missionPilot);
	return { missionPilot, stoppedRun: null };
}

async function playAgentSession(
	sessionId: string,
	taskId: string,
	expectedVersion: number,
	taskRevision: number,
	taskSourceDigest: string,
) {
	const claimed = await claimAgentPlay(taskId, expectedVersion);
	if (!claimed)
		throw new MissionPilotError(
			409,
			"MISSION_PILOT_VERSION_CONFLICT",
			"Mission Pilot state changed; refresh and retry",
		);
	await seedMissionPilotConversation({
		sessionId,
		systemContext: buildMissionPilotSystemContext({
			authorization: claimed.authorizationJson,
			pushPolicy: claimed.authorizationJson?.pushPolicy ?? null,
		}),
		initialPrompt: JSON.stringify({
			type: "task_operator_activation",
			taskRef: { id: taskId, revision: taskRevision },
			sourceDigest: taskSourceDigest,
		}),
	});
	await appendMissionPilotTaskEvent({
		taskId,
		eventType: "mission_pilot.resume_requested",
		sourceEventId: `play:${claimed.id}:${claimed.version}`,
		taskRevision,
		payload: { reason: "play" },
	});
	scheduleMissionPilotAgentWake({ sessionId: claimed.id });
	const current = (await getMissionPilotSessionById(claimed.id)) ?? claimed;
	const missionPilot = repo.toControlSummary(current);
	publishMissionPilotUpdated(taskId, missionPilot);
	return { missionPilot, run: null, messages: [] };
}

export async function listTasksWithMissionPilot() {
	const tasks = await nightworkersRepo.listTasks();
	const summaries = await repo.listSessionSummariesByTaskIds(
		tasks.map((task) => task.id),
	);
	return tasks.map((task) => {
		const missionPilot = summaries.get(task.id);
		if (!missionPilot) {
			throw new MissionPilotError(
				500,
				"MISSION_PILOT_INTEGRITY_ERROR",
				`Task ${task.id} is missing its Mission Pilot session`,
			);
		}
		return { ...task, missionPilot };
	});
}
