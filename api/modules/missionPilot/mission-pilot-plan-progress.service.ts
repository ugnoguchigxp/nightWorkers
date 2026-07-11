import {
	type MissionPilotPlanProgress,
	missionPilotPlanProgressSchema,
} from "../../../shared/schemas/mission-pilot-plan-progress.schema";
import * as missionPilotRepo from "./mission-pilot.repository";
import * as planRepo from "./mission-pilot-plan.repository";

function iso(value: Date | null) {
	return value ? value.toISOString() : null;
}

export async function getMissionPilotPlanProgress(
	taskId: string,
): Promise<MissionPilotPlanProgress | null> {
	const session = await missionPilotRepo.getSessionByTaskId(taskId);
	if (!session) return null;
	const steps = await planRepo.listPlanSteps(session.id);
	const updatedAt = new Date(
		Math.max(
			session.updatedAt.getTime(),
			...steps.map((step) => step.updatedAt.getTime()),
		),
	);
	return missionPilotPlanProgressSchema.parse({
		taskId: session.taskId,
		sessionId: session.id,
		phase: session.phase,
		desiredState: session.desiredState,
		version: session.version,
		contextRevision: session.contextRevision,
		currentStepKey:
			steps.find((step) => step.status === "running")?.stepKey ?? null,
		steps: steps.map((step) => ({
			key: step.stepKey,
			ordinal: step.ordinal,
			kind: step.evidenceJson.kind,
			view:
				typeof step.evidenceJson.view === "string"
					? step.evidenceJson.view
					: null,
			status: step.status,
			attempt: step.attempt,
			artifactMessageId: step.artifactMessageId ?? null,
			lastError: step.lastError ?? null,
			startedAt: iso(step.startedAt),
			finishedAt: iso(step.finishedAt),
		})),
		lastError: session.lastErrorMessage ?? null,
		updatedAt: updatedAt.toISOString(),
	});
}
