import type { TaskRunStatus } from "../../db/schema";
import * as nightworkersRepo from "../nightworkers/nightworkers.repository";
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
		if (!terminalRunStatuses.has(run.status)) return;
		const updated = await repo.syncCompletedRun(run.taskId, run.id);
		if (updated) {
			publishMissionPilotUpdated(run.taskId, repo.toControlSummary(updated));
		}
	});
}

initializeMissionPilotRunSync();
initializeMissionPilotQuestionnaireAutonomy();

export async function reconcileMissionPilotStartup() {
	const provisioned = await repo.backfillMissingTaskSessions();
	const classified = await reconcileMissionPilotPreQueueSessions();
	const recovered = await recoverInterruptedIntakeSessions();
	const postQueueRecovered = await recoverMissionPilotPostQueueSessions();
	for (const session of recovered) {
		publishMissionPilotUpdated(session.taskId, repo.toControlSummary(session));
	}
	return provisioned + classified + recovered.length + postQueueRecovered;
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
			!recovered ||
			recovered.desiredState !== "playing" ||
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
