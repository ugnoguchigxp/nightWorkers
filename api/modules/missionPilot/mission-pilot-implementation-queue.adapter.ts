import type { implementationQueueEntries } from "../../db/schema";
import { registerImplementationQueueHandoffResolver } from "../agentsShare";
import {
	holdBlockedMissionPilotImplementationStart,
	resolveMissionPilotImplementationStart,
} from "./mission-pilot-implementation-todo-projection.service";
import { associateMissionPilotImplementationRun } from "./mission-pilot-run-association.service";

type QueueEntry = typeof implementationQueueEntries.$inferSelect;

registerImplementationQueueHandoffResolver(async (value) => {
	const entry = value as QueueEntry;
	const resolution = await resolveMissionPilotImplementationStart(entry);
	if (resolution.kind === "not_mission_pilot") return null;
	if (resolution.kind === "blocked") {
		return {
			kind: "blocked",
			code: resolution.code,
			message: resolution.message,
			hold: async () => {
				await holdBlockedMissionPilotImplementationStart({
					entry,
					code: resolution.code,
					message: resolution.message,
					sessionGuard: resolution.sessionGuard,
				});
			},
		};
	}
	return {
		kind: "ready",
		codingAgentInvocationSource: "mission_pilot",
		implementationPlanConstraint: resolution.implementationPlanProvenance,
		runtimeOptionsPatch: { missionPilot: resolution.envelope },
		associate: async ({ taskId, runId }) => {
			const associated = await associateMissionPilotImplementationRun({
				taskId,
				runId,
				missionPilot: resolution.envelope,
			});
			if (!associated) {
				throw new Error(
					"Mission Pilot could not claim the prepared Implementation run.",
				);
			}
		},
	};
});
