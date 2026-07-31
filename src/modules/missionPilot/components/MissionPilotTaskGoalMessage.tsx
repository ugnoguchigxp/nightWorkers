import type { MissionPilotControlSummary } from "@nightworkers/mission-pilot/contracts";
import { ThreadMessage } from "../../nightworkers/components/ThreadMessage";
import type { TaskMessage } from "../../nightworkers/types";
import { useMissionPilotControl } from "../missionPilotQueries";

export function MissionPilotTaskGoalMessage({
	objective,
	taskId,
	summary: initialSummary,
	taskMessages,
}: {
	taskId: string;
	objective?: string | null;
	summary?: MissionPilotControlSummary | null;
	taskMessages: readonly TaskMessage[];
}) {
	const { summary } = useMissionPilotControl(taskId, initialSummary);
	const taskGoal = objective?.trim() ?? "";
	if (
		!taskGoal ||
		summary?.initialPromptState !== "sent" ||
		taskMessages.some((message) => message.content.trim() === taskGoal)
	)
		return null;
	return (
		<ThreadMessage messageRole="user">
			<span data-mission-pilot-task-goal>{taskGoal}</span>
		</ThreadMessage>
	);
}
