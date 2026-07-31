import * as missionPilotRepo from "@nightworkers/mission-pilot/backend";
import {
	type MissionPilotPlanProgress,
	missionPilotPlanProgressSchema,
} from "@nightworkers/mission-pilot/contracts";
import {
	humanTaskOperatorQueryContext,
	readTaskOperatorProjection,
} from "../taskOperator";

export async function getMissionPilotPlanProgress(
	taskId: string,
): Promise<MissionPilotPlanProgress | null> {
	const session = await missionPilotRepo.getSessionByTaskId(taskId);
	if (!session) return null;
	const projection = await readTaskOperatorProjection(
		taskId,
		humanTaskOperatorQueryContext(),
	);
	return missionPilotPlanProgressSchema.parse({
		taskId: session.taskId,
		sessionId: session.id,
		phase: session.phase,
		desiredState: session.desiredState,
		version: session.version,
		contextRevision: session.contextRevision,
		currentStepKey: null,
		steps: [],
		review: {
			status: "pending",
			attempt: 0,
			reviewId: null,
			advisories: [],
		},
		activeCorrection: null,
		queueAdmission: {
			status: projection.queue ? "admitted" : "blocked",
		},
		lastError: session.lastErrorMessage ?? null,
		updatedAt: session.updatedAt.toISOString(),
	});
}
