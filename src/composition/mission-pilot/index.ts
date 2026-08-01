import {
	configureMissionPilotFrontendHost,
	handleMissionPilotRealtimeEvent,
	type MissionPilotControlSummary,
	type MissionPilotFrontendHost,
	type MissionPilotPlanProgress,
	missionPilotPlanProgressRealtimeEventSchema,
	missionPilotRealtimeEventSchema,
} from "@nightworkers/mission-pilot/frontend";
import type { QueryClient } from "@tanstack/react-query";
import { apiFetch } from "../../lib/api-base";
import { ThreadMessage } from "../../modules/nightworkers/components/ThreadMessage";
import { AgentDebugEventCard } from "../../modules/nightworkers/components/ThreadTimelineAgentCards";
import { getRelativeTimestamp } from "../../modules/nightworkers/utils/time";

configureMissionPilotFrontendHost({
	request: apiFetch,
	ThreadMessage: ThreadMessage as MissionPilotFrontendHost["ThreadMessage"],
	AgentDebugEventCard:
		AgentDebugEventCard as MissionPilotFrontendHost["AgentDebugEventCard"],
	formatRelativeTimestamp: getRelativeTimestamp,
});

export * from "@nightworkers/mission-pilot/frontend";

export function parseMissionPilotRealtimeExtension(event: unknown) {
	const progress = missionPilotPlanProgressRealtimeEventSchema.safeParse(event);
	if (progress.success) return progress.data;
	const control = missionPilotRealtimeEventSchema.safeParse(event);
	return control.success ? control.data : null;
}

export function applyMissionPilotRealtimeExtension(
	event: unknown,
	queryClient: QueryClient,
) {
	return handleMissionPilotRealtimeEvent(event, {
		setControl(taskId, update) {
			queryClient.setQueryData<MissionPilotControlSummary | null>(
				["missionPilotControl", taskId],
				update,
			);
		},
		setPlanProgress(taskId, progress) {
			queryClient.setQueryData<MissionPilotPlanProgress>(
				["missionPilotPlanProgress", taskId],
				progress,
			);
		},
	});
}
