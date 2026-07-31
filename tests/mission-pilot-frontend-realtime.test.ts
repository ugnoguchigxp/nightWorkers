import { missionPilotControlSummarySchema } from "@nightworkers/mission-pilot/contracts";
import {
	handleMissionPilotRealtimeEvent,
	type MissionPilotControlSummary,
} from "@nightworkers/mission-pilot/frontend";
import { describe, expect, it, vi } from "vitest";

const taskId = "11111111-1111-4111-8111-111111111111";

function summary(version: number): MissionPilotControlSummary {
	return missionPilotControlSummarySchema.parse({
		taskId,
		desiredState: "playing",
		activityState: "running",
		phase: "waiting_for_questionnaire",
		authorizationVersion: 4,
		initialPromptState: "sent",
		initialPromptMessageId: null,
		activeRunId: null,
		nextWakeAt: "2026-07-31T05:00:20.000Z",
		version,
		lastError: null,
		updatedAt: "2026-07-31T05:00:00.000Z",
	});
}

describe("Mission Pilot frontend realtime extension", () => {
	it("updates only the package-owned control cache and ignores stale snapshots", () => {
		let control: MissionPilotControlSummary | null = summary(3);
		const setPlanProgress = vi.fn();
		const cache = {
			setControl(
				receivedTaskId: string,
				update: (
					current: MissionPilotControlSummary | null | undefined,
				) => MissionPilotControlSummary,
			) {
				expect(receivedTaskId).toBe(taskId);
				control = update(control);
			},
			setPlanProgress,
		};

		expect(
			handleMissionPilotRealtimeEvent(
				{
					type: "mission_pilot.updated",
					taskId,
					payload: summary(2),
				},
				cache,
			),
		).toBe(true);
		expect(control?.version).toBe(3);
		expect(setPlanProgress).not.toHaveBeenCalled();
		expect(
			handleMissionPilotRealtimeEvent(
				{ type: "task_status_updated", taskId, payload: {} },
				cache,
			),
		).toBe(false);
	});
});
