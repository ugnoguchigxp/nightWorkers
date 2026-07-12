import { eq } from "drizzle-orm";
import { db } from "../../db/client";
import {
	missionPilotPhaseRuns,
	missionPilotSessions,
} from "../../db/mission-pilot-schema";
import type { continueMissionPilotAfterRun } from "./mission-pilot-post-queue-coordinator.service";

type MissionPilotContinuation = Awaited<
	ReturnType<typeof continueMissionPilotAfterRun>
>;

export async function executeMissionPilotContinuation(
	continuation: MissionPilotContinuation,
) {
	if (continuation.kind === "start_test") {
		const { startTestModeRunFromArtifact } = await import(
			"../nightworkers/nightworkers.service"
		);
		await startTestModeRunFromArtifact({
			...continuation.input,
			mode: "test",
			action: "plan_and_implement_tests",
			rerun: true,
		});
		return;
	}
	if (continuation.kind === "start_review") {
		const { autoStartReviewSessionForRun, startReviewRunForSession } =
			await import("../review");
		const reviewSession = await autoStartReviewSessionForRun(
			continuation.input.anchorRunId,
		);
		await startReviewRunForSession(
			reviewSession.session.id,
			{
				codeReview: true,
				securityReview: true,
				applyFixes: false,
				commitChanges: false,
			},
			{
				targetRunIds: continuation.input.targetRunIds,
				missionPilot: continuation.input.missionPilot,
			},
		);
		return;
	}
	if (continuation.kind === "run_closeout") {
		const { executeMissionPilotCloseout } = await import(
			"./mission-pilot-closeout.service"
		);
		const result = await executeMissionPilotCloseout(continuation.sessionId);
		if (result.status === "rework_required") {
			await startImplementationRework(result.input);
		}
		return;
	}
	if (continuation.kind === "start_implementation_rework") {
		await startImplementationRework(continuation.input);
	}
}

export async function startImplementationRework(input: {
	taskId: string;
	missionPilot: Record<string, unknown>;
}) {
	const { startTaskRun } = await import(
		"../nightworkers/run-orchestration/start-task-run"
	);
	await startTaskRun(input.taskId, {
		executionMode: "implementation",
		executionModeSource: "explicit",
		runtimeOptionsPatch: { missionPilot: input.missionPilot },
	});
}

export async function markMissionPilotContinuationFailed(
	runId: string,
	error: unknown,
) {
	const [phaseRun] = await db
		.select()
		.from(missionPilotPhaseRuns)
		.where(eq(missionPilotPhaseRuns.runId, runId))
		.limit(1);
	if (!phaseRun) return;
	const message = error instanceof Error ? error.message : String(error);
	await db
		.update(missionPilotSessions)
		.set({
			phase: "attention",
			activeRunId: null,
			activePhaseRunId: null,
			lastErrorCode: "MISSION_PILOT_CONTINUATION_FAILED",
			lastErrorMessage: message,
			updatedAt: new Date(),
		})
		.where(eq(missionPilotSessions.id, phaseRun.sessionId));
}
