import {
	type MissionPilotSourceRef,
	missionPilotAuthorizationV2Schema,
} from "../../../shared/schemas/mission-pilot.schema";
import type { TaskRunStatus } from "../../db/schema";
import * as nightworkersRepo from "../nightworkers/nightworkers.repository";
import { MissionPilotError } from "./mission-pilot.errors";
import * as repo from "./mission-pilot.repository";
import {
	initializeMissionPilotQuestionnaireAutonomy,
	resumeQuestionnaireCountdown,
} from "./mission-pilot-questionnaire.service";
import {
	publishMissionPilotInitialPrompt,
	publishMissionPilotUpdated,
} from "./mission-pilot-realtime";
import { createMissionPilotTask } from "./mission-pilot-taskization.port";
import {
	registerTaskRunUpdatedListener,
	resumeWorkbenchIntakeMessage,
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
	const recovered = await repo.recoverInterruptedStartingSessions();
	for (const session of recovered) {
		publishMissionPilotUpdated(session.taskId, repo.toControlSummary(session));
	}
	return recovered.length;
}

export async function createFromSourceRef(input: {
	repositoryId: string;
	sourceRef: MissionPilotSourceRef;
}) {
	try {
		const task = await createMissionPilotTask(
			input.repositoryId,
			input.sourceRef,
		);
		if (!task)
			throw new MissionPilotError(
				409,
				"MISSION_PILOT_CREATE_CONFLICT",
				"Mission Pilot task was not created",
			);
		const session = await repo.getSessionByTaskId(task.id);
		if (!session)
			throw new MissionPilotError(
				409,
				"MISSION_PILOT_CREATE_CONFLICT",
				"Mission Pilot session was not created",
			);
		const missionPilot = repo.toControlSummary(session);
		publishMissionPilotUpdated(task.id, missionPilot);
		return { task: { ...task, missionPilot } };
	} catch (error) {
		if (error instanceof MissionPilotError) throw error;
		throw new MissionPilotError(
			409,
			"MISSION_PILOT_CREATE_CONFLICT",
			"Mission Pilot task creation conflicted with current source state",
		);
	}
}

export async function play(taskId: string, expectedVersion: number) {
	const session = await repo.getSessionByTaskId(taskId);
	if (!session)
		throw new MissionPilotError(
			404,
			"MISSION_PILOT_NOT_FOUND",
			"Mission Pilot session not found",
		);
	if (!session.initialPromptSnapshot.trim())
		throw new MissionPilotError(
			400,
			"MISSION_PILOT_INITIAL_PROMPT_REQUIRED",
			"Mission Pilot requires a non-empty initial prompt",
		);
	const authorization =
		session.authorizationJson ??
		missionPilotAuthorizationV2Schema.parse({
			version: 2,
			sessionId: session.id,
			taskId,
			sourceRef: { source: session.sourceKind, id: session.sourceId },
			grantedByAction: "mission_pilot_play",
			grantedAt: new Date().toISOString(),
			scopes: {
				plan: true,
				queue: true,
				implementation: true,
				testMutation: true,
				review: true,
				localCommit: true,
				taskComplete: true,
				taskArchive: true,
				push: false,
			},
			pushPolicy: "never",
		});
	const claimed = await repo.claimPlay(taskId, expectedVersion, authorization);
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
		const result = await resumeWorkbenchIntakeMessage(
			taskId,
			activeClaim.initialPromptSnapshot,
			{ waitForIntake: true },
		);
		const runId =
			result.run &&
			typeof result.run === "object" &&
			"id" in result.run &&
			typeof result.run.id === "string"
				? result.run.id
				: null;
		const finished = await repo.finishPlay(taskId, runId);
		if (!finished) throw new Error("Mission Pilot state changed during intake");
		const missionPilot = repo.toControlSummary(finished);
		publishMissionPilotUpdated(taskId, missionPilot);
		return { missionPilot, ...result };
	} catch (error) {
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
	return tasks.map((task) => ({
		...task,
		missionPilot: summaries.get(task.id) ?? null,
	}));
}
