import { missionPilotControlSummarySchema } from "../../../../shared/schemas/mission-pilot.schema";
import type { missionPilotSessions } from "../../../db/mission-pilot-schema";

type SessionRow = typeof missionPilotSessions.$inferSelect;

export function toControlSummary(row: SessionRow) {
	const activityState =
		row.runtimeKind === "agent"
			? row.runtimeState === "running"
				? "running"
				: row.runtimeState === "attention"
					? "attention"
					: "idle"
			: row.phase === "attention"
				? "attention"
				: row.phase === "starting"
					? "starting"
					: row.phase === "stopping"
						? "stopping"
						: row.activeRunId
							? "running"
							: "idle";
	return missionPilotControlSummarySchema.parse({
		taskId: row.taskId,
		runtimeKind: row.runtimeKind,
		runtimeState: row.runtimeState,
		desiredState: row.desiredState,
		activityState,
		phase: row.runtimeKind === "agent" ? row.runtimeState : row.phase,
		authorizationVersion: row.authorizationVersion ?? null,
		initialPromptState: row.initialPromptState,
		initialPromptMessageId: row.initialPromptMessageId ?? null,
		activeRunId: row.activeRunId ?? null,
		nextWakeAt: row.nextWakeAt ?? null,
		version: row.version,
		lastErrorCode: row.lastErrorCode ?? null,
		lastError: row.lastErrorMessage ?? null,
		stoppedAt: row.stoppedAt ?? null,
		queueHandoff: row.queueHandoffJson ?? null,
		preQueueDiagnostic: row.preQueueDiagnosticJson ?? null,
		updatedAt: row.updatedAt,
	});
}
