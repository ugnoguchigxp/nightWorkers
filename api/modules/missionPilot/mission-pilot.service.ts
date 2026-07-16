import { missionPilotAgentRunProvenanceSchema } from "../../../shared/modules/missionPilot";
import type { TaskRunStatus } from "../../db/schema";
import {
	isFailureLikeTaskRunStatus,
	registerTaskRunTerminalListener,
} from "../agentsShare";
import * as nightworkersRepo from "../nightworkers/nightworkers.repository";
import { recoverStaleActiveRuns } from "../nightworkers/nightworkers.run-query.service";
import { registerTaskMessageCreatedListener } from "../nightworkers/nightworkers.task-message-events";
import { registerQuestionnaireStateChangedListener } from "../questionnaire/questionnaire-events";
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
import { resolveMissionPilotRuntimeOwnership } from "./agent/mission-pilot-runtime-ownership.service";
import {
	recordMissionPilotQuestionnaireStateChanged,
	recordMissionPilotTaskEvent,
} from "./agent/mission-pilot-task-event.adapter";
import { appendMissionPilotTaskEvent } from "./agent/mission-pilot-task-event.repository";
import { MissionPilotError } from "./mission-pilot.errors";
import * as repo from "./mission-pilot.repository";
import { recoverInterruptedIntakeSessions } from "./mission-pilot-intake-recovery.repository";
import { releaseMissionPilotQueueHandoff } from "./mission-pilot-post-queue-coordinator.service";
import {
	markMissionPilotPreQueueAttention,
	reconcileMissionPilotPreQueueSessions,
} from "./mission-pilot-pre-queue-recovery.service";
import { MissionPilotPreQueueError } from "./mission-pilot-queue-handoff.service";
import { claimQueueHandoffResume } from "./mission-pilot-queue-resume.repository";
import {
	publishMissionPilotInitialPrompt,
	publishMissionPilotUpdated,
} from "./mission-pilot-realtime";
import { recoverMissionPilotPostQueueSessions } from "./mission-pilot-recovery.service";
import {
	registerTaskRunUpdatedListener,
	startTaskRun,
	stopTaskRun,
} from "./mission-pilot-workbench.port";
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
		if (!terminalRunStatuses.has(run.status)) return;
		const updated = await repo.syncCompletedRun(run.taskId, run.id);
		if (updated) {
			publishMissionPilotUpdated(run.taskId, repo.toControlSummary(updated));
			if (["failed", "timed_out", "cancelled"].includes(run.status)) {
				await recoverMissionPilotPostQueueSessions().catch(() => undefined);
			}
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
		const updated = await repo.syncCompletedRun(event.taskId, event.runId);
		if (updated) {
			publishMissionPilotUpdated(event.taskId, repo.toControlSummary(updated));
			if (["failed", "timed_out", "cancelled"].includes(event.status)) {
				await recoverMissionPilotPostQueueSessions().catch(() => undefined);
			}
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
		const ownership = await resolveMissionPilotRuntimeOwnership({
			taskId: message.taskId,
		});
		if (ownership.kind !== "agent") return;
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
	const classified = await reconcileMissionPilotPreQueueSessions();
	const recovered = await recoverInterruptedIntakeSessions();
	const activePostQueueSessions =
		await repo.listPlayingSessionsWithActiveRuns();
	for (const session of activePostQueueSessions) {
		await recoverStaleActiveRuns(session.taskId, { force: true });
	}
	const postQueueRecovered = await recoverMissionPilotPostQueueSessions();
	for (const session of recovered) {
		publishMissionPilotUpdated(session.taskId, repo.toControlSummary(session));
	}
	return (
		provisioned +
		classified +
		recovered.length +
		postQueueRecovered +
		interruptedAgentSessions.length
	);
}

export async function play(taskId: string, expectedVersion: number) {
	const [session, task] = await Promise.all([
		repo.getSessionByTaskId(taskId),
		nightworkersRepo.getTask(taskId),
	]);
	if (!session)
		throw new MissionPilotError(
			404,
			"MISSION_PILOT_NOT_FOUND",
			"Mission Pilot session not found",
		);
	if (!task)
		throw new MissionPilotError(404, "TASK_NOT_FOUND", "Task not found");
	if (!(task.objective ?? "").trim())
		throw new MissionPilotError(
			400,
			"MISSION_PILOT_INITIAL_PROMPT_REQUIRED",
			"Mission Pilot requires a non-empty initial prompt",
		);
	if (await isMissionPilotAgentSession(session.id))
		return playAgentSession(
			session.id,
			taskId,
			expectedVersion,
			task.updatedAt.getTime(),
		);
	if (
		session.phase === "attention" &&
		session.queueHandoffJson &&
		!session.activeRunId &&
		!session.activePhaseRunId &&
		!session.activeTestSnapshotId
	) {
		const resumed = await claimQueueHandoffResume(taskId, expectedVersion);
		if (!resumed)
			throw new MissionPilotError(
				409,
				"MISSION_PILOT_VERSION_CONFLICT",
				"Mission Pilot state changed; refresh and retry",
			);
		await reconcileMissionPilotPreQueueSessions();
		const recovered = await repo.getSessionByTaskId(taskId);
		if (
			recovered?.desiredState !== "playing" ||
			!["queued", "repository_bootstrapping"].includes(recovered.phase)
		) {
			throw new MissionPilotError(
				409,
				recovered?.lastErrorCode ??
					"MISSION_PILOT_QUEUE_HANDOFF_EVIDENCE_MISSING",
				recovered?.lastErrorMessage ?? "Queue handoff recovery failed",
			);
		}
		if (recovered.phase === "queued") {
			await releaseMissionPilotQueueHandoff(taskId);
		}
		const current = (await repo.getSessionByTaskId(taskId)) ?? recovered;
		const missionPilot = repo.toControlSummary(current);
		publishMissionPilotUpdated(taskId, missionPilot);
		return { missionPilot, run: null, messages: [] };
	}
	if (
		["paused", "attention"].includes(session.phase) &&
		session.resumePhase &&
		!session.resumePhase.startsWith("initial_") &&
		!session.resumePhase.startsWith("plan_")
	) {
		const resumedPostQueue = await repo.claimPostQueueResume(
			taskId,
			expectedVersion,
		);
		if (!resumedPostQueue)
			throw new MissionPilotError(
				409,
				"MISSION_PILOT_VERSION_CONFLICT",
				"Mission Pilot state changed; refresh and retry",
			);
		await recoverMissionPilotPostQueueSessions();
		const current = (await repo.getSessionByTaskId(taskId)) ?? resumedPostQueue;
		const missionPilot = repo.toControlSummary(current);
		publishMissionPilotUpdated(taskId, missionPilot);
		return { missionPilot, run: null, messages: [] };
	}
	const claimed = await repo.claimPlay(taskId, expectedVersion);
	if (!claimed)
		throw new MissionPilotError(
			409,
			"MISSION_PILOT_VERSION_CONFLICT",
			"Mission Pilot state changed; refresh and retry",
		);
	const activeClaim = claimed;
	publishMissionPilotUpdated(taskId, repo.toControlSummary(activeClaim));
	let intakeVersion = activeClaim.version;
	try {
		const promptEvidence = await repo.ensureInitialPromptMessage(taskId);
		if (!promptEvidence) throw new Error("Initial prompt could not be claimed");
		if (promptEvidence.inserted && promptEvidence.message) {
			publishMissionPilotInitialPrompt(promptEvidence.message);
		}
		intakeVersion = promptEvidence.row.version;
		const run = await startTaskRun(taskId, {
			executionModeSource: "explicit",
			latestUserMessageOverride: activeClaim.initialPromptSnapshot,
		});
		const initialized = await repo.finishPlay(taskId, run.id);
		if (!initialized)
			throw new Error(
				"Mission Pilot state changed while starting Coding Agent",
			);
		intakeVersion = initialized.version;
		const finished = await repo.getSessionByTaskId(taskId);
		if (!finished)
			throw new Error(
				"Mission Pilot state changed after starting Coding Agent",
			);
		const missionPilot = repo.toControlSummary(finished);
		publishMissionPilotUpdated(taskId, missionPilot);
		return {
			missionPilot,
			run,
			messages: [],
		};
	} catch (error) {
		if (error instanceof MissionPilotPreQueueError) {
			const failed = await markMissionPilotPreQueueAttention(taskId, error);
			if (failed) {
				publishMissionPilotUpdated(taskId, repo.toControlSummary(failed));
			}
			throw new MissionPilotError(409, error.code, error.message);
		}
		if (error instanceof repo.MissionPilotStateConflictError) {
			const current = await repo.getSessionByTaskId(taskId);
			if (current) {
				publishMissionPilotUpdated(taskId, repo.toControlSummary(current));
			}
			throw new MissionPilotError(
				409,
				"MISSION_PILOT_VERSION_CONFLICT",
				error.message,
			);
		}
		if (error instanceof MissionPilotError) {
			const failed = await repo.markAttention(
				taskId,
				intakeVersion,
				error.code,
				error.message,
			);
			if (failed) {
				publishMissionPilotUpdated(taskId, repo.toControlSummary(failed));
			}
			throw error;
		}
		const current = await repo.getSessionByTaskId(taskId);
		if (current?.phase === "waiting_intervention" && current.nextWakeAt) {
			const missionPilot = repo.toControlSummary(current);
			publishMissionPilotUpdated(taskId, missionPilot);
			return { missionPilot, run: null, messages: [] };
		}
		const message = error instanceof Error ? error.message : String(error);
		const failed = await repo.markAttention(
			taskId,
			intakeVersion,
			"MISSION_PILOT_INTAKE_FAILED",
			message,
		);
		if (failed)
			publishMissionPilotUpdated(taskId, repo.toControlSummary(failed));
		throw new MissionPilotError(502, "MISSION_PILOT_INTAKE_FAILED", message);
	}
}

export async function stop(taskId: string, expectedVersion: number) {
	const current = await repo.getSessionByTaskId(taskId);
	if (!current)
		throw new MissionPilotError(
			404,
			"MISSION_PILOT_NOT_FOUND",
			"Mission Pilot session not found",
		);
	if (await isMissionPilotAgentSession(current.id)) {
		const activeRuns = await listMissionPilotOwnedActiveRuns(
			taskId,
			current.id,
		);
		if (
			current.desiredState === "stopped" &&
			!current.activeRunId &&
			activeRuns.length === 0 &&
			!isMissionPilotAgentRuntimeActive(current.id) &&
			current.lastErrorCode !== "MISSION_PILOT_RUNTIME_STOP_TIMEOUT"
		)
			return {
				missionPilot: repo.toControlSummary(current),
				stoppedRun: null,
			};
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
		const stoppedRuns: unknown[] = [];
		const stopErrors: string[] = [];
		if (!runtimeStopResult.quiesced)
			stopErrors.push(
				"Mission Pilot runtime did not acknowledge the stop request in time.",
			);
		for (const activeRun of await listMissionPilotOwnedActiveRuns(
			taskId,
			claimed.id,
		)) {
			try {
				stoppedRuns.push(await stopTaskRun(activeRun.id));
			} catch (error) {
				stopErrors.push(error instanceof Error ? error.message : String(error));
			}
		}
		const remainingRuns = await listMissionPilotOwnedActiveRuns(
			taskId,
			claimed.id,
		);
		if (remainingRuns.length > 0)
			stopErrors.push(
				`Active Task Run remains after stop: ${remainingRuns.map((run) => run.id).join(", ")}`,
			);
		const stopError =
			stopErrors.length > 0 ? [...new Set(stopErrors)].join("\n") : undefined;
		const stopErrorCode = !runtimeStopResult.quiesced
			? "MISSION_PILOT_RUNTIME_STOP_TIMEOUT"
			: undefined;
		const finished = await repo.finishStop(
			taskId,
			claimed.version,
			stopError,
			remainingRuns[0]?.id ?? null,
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
		return {
			missionPilot,
			stoppedRun: stoppedRuns[0] ?? null,
		};
	}
	if (current.desiredState === "stopped" && !current.activeRunId)
		return { missionPilot: repo.toControlSummary(current), stoppedRun: null };
	const claimed = await repo.claimStop(taskId, expectedVersion);
	if (!claimed)
		throw new MissionPilotError(
			409,
			"MISSION_PILOT_VERSION_CONFLICT",
			"Mission Pilot state changed; refresh and retry",
		);
	publishMissionPilotUpdated(taskId, repo.toControlSummary(claimed));
	let stoppedRun: unknown = null;
	let stopError: string | undefined;
	if (claimed.activeRunId) {
		try {
			stoppedRun = await stopTaskRun(claimed.activeRunId);
		} catch (error) {
			stopError = error instanceof Error ? error.message : String(error);
		}
	}
	const finished = await repo.finishStop(taskId, claimed.version, stopError);
	if (!finished)
		throw new MissionPilotError(
			409,
			"MISSION_PILOT_VERSION_CONFLICT",
			"Mission Pilot state changed while finalizing Stop; refresh and retry",
		);
	const missionPilot = repo.toControlSummary(finished);
	publishMissionPilotUpdated(taskId, missionPilot);
	return { missionPilot, stoppedRun };
}

async function playAgentSession(
	sessionId: string,
	taskId: string,
	expectedVersion: number,
	taskRevision: number,
) {
	const claimed = await claimAgentPlay(taskId, expectedVersion);
	if (!claimed)
		throw new MissionPilotError(
			409,
			"MISSION_PILOT_VERSION_CONFLICT",
			"Mission Pilot state changed; refresh and retry",
		);
	const promptEvidence = await repo.ensureInitialPromptMessage(taskId);
	if (!promptEvidence)
		throw new MissionPilotError(
			409,
			"MISSION_PILOT_INITIAL_PROMPT_FAILED",
			"Mission Pilot initial prompt could not be persisted",
		);
	if (promptEvidence.inserted && promptEvidence.message)
		publishMissionPilotInitialPrompt(promptEvidence.message);
	await seedMissionPilotConversation({
		sessionId,
		systemContext: buildMissionPilotSystemContext({
			authorization: claimed.authorizationJson,
			pushPolicy: claimed.authorizationJson?.pushPolicy ?? null,
		}),
		initialPrompt: promptEvidence.row.initialPromptSnapshot,
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

async function listMissionPilotOwnedActiveRuns(
	taskId: string,
	sessionId: string,
) {
	const activeRuns = await nightworkersRepo.listActiveTaskRunsForTask(taskId);
	return activeRuns.filter((run) => {
		const provenance = missionPilotAgentRunProvenanceSchema.safeParse(
			readRecord(run.contextSnapshot).missionPilotAgent,
		);
		return provenance.success && provenance.data.sessionId === sessionId;
	});
}

function readRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}
