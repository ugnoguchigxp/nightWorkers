import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import type { MissionPilotControlSummary } from "../../../shared/modules/missionPilot";
import type { Task } from "../nightworkers/types";
import {
	playMissionPilotTask,
	stopMissionPilotTask,
} from "./missionPilotCommands";
import {
	mergeMissionPilotSummary,
	optimisticMissionPilotSummary,
} from "./missionPilotQueries";
export function useMissionPilotControls(
	taskId: string,
	summary: MissionPilotControlSummary,
	_initialPrompt = "",
) {
	const queryClient = useQueryClient();
	const [pending, setPending] = useState<"play" | "stop" | null>(null);
	const [error, setError] = useState<string | null>(null);
	const run = useCallback(
		async (action: "play" | "stop") => {
			if (action === "stop")
				await queryClient.refetchQueries({
					queryKey: ["sessions"],
					type: "active",
				});
			const cachedSummary = queryClient
				.getQueryData<Task[]>(["sessions"])
				?.find((task) => task.id === taskId)?.missionPilot;
			const commandSummary =
				cachedSummary && cachedSummary.version >= summary.version
					? cachedSummary
					: summary;
			setPending(action);
			setError(null);
			queryClient.setQueryData<Task[]>(["sessions"], (current = []) =>
				mergeMissionPilotSummary(
					current,
					taskId,
					optimisticMissionPilotSummary(commandSummary, action),
				),
			);
			try {
				const response = await (action === "play"
					? playMissionPilotTask(taskId, commandSummary.version)
					: stopMissionPilotTask(taskId, commandSummary.version));
				const payload = (await response.json()) as {
					missionPilot?: MissionPilotControlSummary;
					error?: string;
					message?: string;
				};
				if (!response.ok || !payload.missionPilot)
					throw new Error(
						payload.message ||
							payload.error ||
							`Mission Pilot ${action} failed`,
					);
				const missionPilot = payload.missionPilot;
				queryClient.setQueryData<Task[]>(["sessions"], (current = []) =>
					mergeMissionPilotSummary(current, taskId, missionPilot),
				);
				await Promise.all([
					queryClient.invalidateQueries({ queryKey: ["sessions"] }),
					queryClient.invalidateQueries({ queryKey: ["taskMessages", taskId] }),
					queryClient.invalidateQueries({ queryKey: ["sessionRuns", taskId] }),
				]);
			} catch (cause) {
				setError(cause instanceof Error ? cause.message : String(cause));
				await Promise.all([
					queryClient.invalidateQueries({ queryKey: ["sessions"] }),
					queryClient.invalidateQueries({
						queryKey: ["taskMessages", taskId],
					}),
				]);
			} finally {
				setPending((current) => (current === action ? null : current));
			}
		},
		[queryClient, summary, taskId],
	);
	return { pending, error, play: () => run("play"), stop: () => run("stop") };
}
