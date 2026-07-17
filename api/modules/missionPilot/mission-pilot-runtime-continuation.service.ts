import { eq } from "drizzle-orm";
import { db } from "../../db/client";
import {
	missionPilotPhaseRuns,
	missionPilotSessions,
} from "../../db/mission-pilot-schema";
import { AppError } from "../../lib/errors";
import type { StartTaskRunOptions } from "../nightworkers/run-orchestration/start-task-run-types";
import type { continueMissionPilotAfterRun } from "./mission-pilot-post-queue-coordinator.service";
import {
	buildMissionPilotReworkTodos,
	formatMissionPilotReworkPacket,
	parseMissionPilotReworkPacket,
} from "./mission-pilot-rework";
import { buildMissionPilotRunAssociationRequest } from "./mission-pilot-run-association.service";

type MissionPilotContinuation = Awaited<
	ReturnType<typeof continueMissionPilotAfterRun>
>;

export async function executeMissionPilotContinuation(
	continuation: MissionPilotContinuation,
) {
	for (let attempt = 1; attempt <= 2; attempt += 1) {
		try {
			await executeMissionPilotContinuationOnce(continuation);
			return;
		} catch (error) {
			if (attempt >= 2 || !isRetryableContinuationError(error)) throw error;
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
	}
}

async function executeMissionPilotContinuationOnce(
	continuation: MissionPilotContinuation,
) {
	if (continuation.kind === "start_test") {
		const { startVerificationRunFromArtifact } = await import(
			"../nightworkers/nightworkers.service"
		);
		await startVerificationRunFromArtifact({
			...continuation.input,
			mode: "test",
			action: "plan_and_implement_tests",
			rerun: true,
			runAssociation: buildMissionPilotRunAssociationRequest({
				phase: "test",
				missionPilot: continuation.input.missionPilot,
			}),
		});
		return;
	}
	if (continuation.kind === "start_review") {
		const anchorRun = await import(
			"../nightworkers/nightworkers.repository"
		).then((module) => module.getTaskRun(continuation.input.anchorRunId));
		if (!anchorRun)
			throw new AppError(404, "RUN_NOT_FOUND", "Anchor run not found");
		const { autoStartReviewSessionForRun } = await import(
			"../review/review-mode.service"
		);
		const { startReviewRunForSession } = await import(
			"../review/review-run.service"
		);
		const reviewSession = await autoStartReviewSessionForRun(anchorRun.id);
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
				targetManifestContext: continuation.input.targetManifestContext,
				missionPilot: continuation.input.missionPilot,
				runAssociation: buildMissionPilotRunAssociationRequest({
					phase: "review",
					missionPilot: continuation.input.missionPilot,
				}),
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

function isRetryableContinuationError(error: unknown) {
	if (!(error instanceof AppError)) return true;
	if (error.statusCode === 409 || error.statusCode === 429) return true;
	return error.statusCode >= 500;
}

export async function startImplementationRework(input: {
	taskId: string;
	missionPilot: Record<string, unknown>;
}) {
	const reworkPacket = parseMissionPilotReworkPacket(
		input.missionPilot.reworkPacket,
	);
	if (!reworkPacket) {
		throw new Error("Mission Pilot rework packet is missing or invalid.");
	}
	const { startTaskRun } = await import(
		"../nightworkers/run-orchestration/start-task-run"
	);
	await startTaskRun(input.taskId, {
		executionMode: "implementation",
		executionModeSource: "explicit",
		runAssociation: buildMissionPilotRunAssociationRequest({
			phase: "implementation",
			missionPilot: { ...input.missionPilot, reworkPacket },
		}),
		initialTodos: buildMissionPilotReworkTodos(reworkPacket),
		latestUserMessageOverride: [
			"Review指摘限定のImplementation correctionを開始してください。",
			"対象外の機能追加、リファクタリング、テスト範囲の拡張は行わないでください。",
			formatMissionPilotReworkPacket(reworkPacket),
		].join("\n\n"),
		runtimeOptionsPatch: {
			missionPilot: { ...input.missionPilot, reworkPacket },
		},
	});
}

export async function resumeInterruptedImplementation(input: {
	taskId: string;
	missionPilot: Record<string, unknown>;
}) {
	const { startTaskRun } = await import(
		"../nightworkers/run-orchestration/start-task-run"
	);
	await startTaskRun(
		input.taskId,
		buildInterruptedImplementationResumeOptions(input.missionPilot),
	);
}

export function buildInterruptedImplementationResumeOptions(
	missionPilot: Record<string, unknown>,
): StartTaskRunOptions {
	return {
		executionMode: "implementation",
		executionModeSource: "explicit",
		runAssociation: buildMissionPilotRunAssociationRequest({
			phase: "implementation",
			missionPilot,
		}),
		latestUserMessageOverride: "再開してください。",
		runtimeOptionsPatch: { missionPilot },
	};
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
	const [session] = await db
		.select()
		.from(missionPilotSessions)
		.where(eq(missionPilotSessions.id, phaseRun.sessionId))
		.limit(1);
	if (!session || session.activeRunId) return;
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
