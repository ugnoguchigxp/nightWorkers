import type { MissionPilotControlSummary } from "../../contracts";
import {
	getMissionPilotFrontendHost,
	type MissionPilotTaskMessage,
} from "../host";
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
	taskMessages: readonly MissionPilotTaskMessage[];
}) {
	const { ThreadMessage } = getMissionPilotFrontendHost();
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
