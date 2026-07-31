import type {
	MissionPilotControlSummary,
	MissionPilotPlanProgress,
} from "../contracts";
import {
	missionPilotPlanProgressRealtimeEventSchema,
	missionPilotRealtimeEventSchema,
} from "../contracts";
import { mergeMissionPilotControl } from "./missionPilotQueries";

export type MissionPilotRealtimeCache = {
	setControl(
		taskId: string,
		update: (
			current: MissionPilotControlSummary | null | undefined,
		) => MissionPilotControlSummary,
	): void;
	setPlanProgress(taskId: string, progress: MissionPilotPlanProgress): void;
};

export function handleMissionPilotRealtimeEvent(
	event: unknown,
	cache: MissionPilotRealtimeCache,
) {
	const planProgress =
		missionPilotPlanProgressRealtimeEventSchema.safeParse(event);
	if (planProgress.success) {
		cache.setPlanProgress(
			planProgress.data.taskId,
			planProgress.data.payload.progress,
		);
		return true;
	}
	const parsed = missionPilotRealtimeEventSchema.safeParse(event);
	if (!parsed.success) return false;
	const incoming =
		"missionPilot" in parsed.data.payload
			? parsed.data.payload.missionPilot
			: parsed.data.payload;
	cache.setControl(parsed.data.taskId, (current) =>
		mergeMissionPilotControl(current, incoming),
	);
	return true;
}
