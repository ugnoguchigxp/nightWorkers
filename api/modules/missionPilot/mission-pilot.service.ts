import type { TaskRunStatus } from "../../db/schema";
import { buildMissionPilotSystemContext } from "../../services/structured-generation/prompts/mission-pilot-system-context";
import * as nightworkersRepo from "../nightworkers/nightworkers.repository";
import {
	getActiveTaskRun,
	recoverStaleActiveRuns,
} from "../nightworkers/nightworkers.run-query.service";
import { registerQuestionnaireReadyListener } from "../questionnaire/questionnaire-events";
import { cancelPendingMissionPilotToolCalls } from "./agent/mission-pilot-agent-lifecycle.repository";
import {
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
import { scheduleMissionPilotAgentWake } from "./agent/mission-pilot-agent-wake.service";
import { seedMissionPilotConversation } from "./agent/mission-pilot-conversation.repository";
import { recordMissionPilotQuestionnaireReady } from "./agent/mission-pilot-task-event.adapter";
import { appendMissionPilotTaskEvent } from "./agent/mission-pilot-task-event.repository";
import { MissionPilotError } from "./mission-pilot.errors";
import * as repo from "./mission-pilot.repository";
import { recoverInterruptedIntakeSessions } from "./mission-pilot-intake-recovery.repository";
import { startOrResumeMissionPilotPlanIntake } from "./mission-pilot-plan-intake.port";
import { releaseMissionPilotQueueHandoff } from "./mission-pilot-post-queue-coordinator.service";
import {
	markMissionPilotPreQueueAttention,
	reconcileMissionPilotPreQueueSessions,
} from "./mission-pilot-pre-queue-recovery.service";
import {
	initializeMissionPilotQuestionnaireAutonomy,
	resumeQuestionnaireCountdown,
} from "./mission-pilot-questionnaire.service";
import { MissionPilotPreQueueError } from "./mission-pilot-queue-handoff.service";
import { claimQueueHandoffResume } from "./mission-pilot-queue-resume.repository";
import {
	publishMissionPilotInitialPrompt,
	publishMissionPilotUpdated,
} from "./mission-pilot-realtime";
import { recoverMissionPilotPostQueueSessions } from "./mission-pilot-recovery.service";
import {
	registerTaskRunUpdatedListener,
	stopTaskRun,
} from "./mission-pilot-workbench.port";

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
			const terminal = terminalRunStatuses.has(run.status);
			if (!terminal && run.status !== "running") return;
			const task = await nightworkersRepo.getTask(run.taskId);
			if (!task) return;
			await appendMissionPilotTaskEvent({
				taskId: run.taskId,
				eventType: terminal ? "task_run.terminal" : "task_run.started",
				sourceEventId: `task-run:${run.id}:${run.status}`,
				taskRevision: task.updatedAt.getTime(),
				payload: terminal
					? { runId: run.id, status: run.status }
					: { runId: run.id, status: run.status },
			});
			if (session.desiredState === "playing")
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
initializeMissionPilotQuestionnaireAutonomy();

let agentQuestionnaireReadyRegistered = false;
function initializeMissionPilotAgentQuestionnaireEvents() {
	if (agentQuestionnaireReadyRegistered) return;
	agentQuestionnaireReadyRegistered = true;
	registerQuestionnaireReadyListener(async (questionnaire) => {
		const session = await repo.getSessionByTaskId(questionnaire.taskId);
		if (
			session?.desiredState !== "playing" ||
			!(await isMissionPilotAgentSession(session.id))
		)
			return;
		await recordMissionPilotQuestionnaireReady(questionnaire);
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
	for (const { session } of await listPlayingAgentSessions())
		scheduleMissionPilotAgentWake({ sessionId: session.id });
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
	const resumed = await resumeQuestionnaireCountdown(taskId);
	const activeClaim = resumed ?? claimed;
	publishMissionPilotUpdated(taskId, repo.toControlSummary(activeClaim));
	let intakeVersion = activeClaim.version;
	try {
		const promptEvidence = await repo.ensureInitialPromptMessage(taskId);
		if (!promptEvidence) throw new Error("Initial prompt could not be claimed");
		if (promptEvidence.inserted && promptEvidence.message) {
			publishMissionPilotInitialPrompt(promptEvidence.message);
		}
		intakeVersion = promptEvidence.row.version;
		const initialized = await repo.finishPlay(taskId, null);
		if (!initialized)
			throw new Error("Mission Pilot state changed during Plan intake");
		intakeVersion = initialized.version;
		await startOrResumeMissionPilotPlanIntake({
			taskId,
			initialPrompt: activeClaim.initialPromptSnapshot,
			sessionId: activeClaim.id,
		});
		const finished = await repo.getSessionByTaskId(taskId);
		if (!finished) throw new Error("Mission Pilot state changed during intake");
		const missionPilot = repo.toControlSummary(finished);
		publishMissionPilotUpdated(taskId, missionPilot);
		return {
			missionPilot,
			run: null,
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
		const activeRun = await getActiveTaskRun(taskId);
		const claimed = await claimAgentStop(taskId, expectedVersion);
		if (!claimed)
			throw new MissionPilotError(
				409,
				"MISSION_PILOT_VERSION_CONFLICT",
				"Mission Pilot state changed; refresh and retry",
			);
		stopMissionPilotAgentRuntime(claimed.id);
		await cancelPendingMissionPilotToolCalls(claimed.id);
		let stoppedRun: unknown = null;
		let stopError: string | undefined;
		if (activeRun)
			try {
				stoppedRun = await stopTaskRun(activeRun.id);
			} catch (error) {
				stopError = error instanceof Error ? error.message : String(error);
			}
		const finished = await repo.finishStop(taskId, claimed.version, stopError);
		if (!finished)
			throw new MissionPilotError(
				404,
				"MISSION_PILOT_NOT_FOUND",
				"Mission Pilot session not found",
			);
		const missionPilot = repo.toControlSummary(finished);
		publishMissionPilotUpdated(taskId, missionPilot);
		return { missionPilot, stoppedRun };
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
			404,
			"MISSION_PILOT_NOT_FOUND",
			"Mission Pilot session not found",
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
