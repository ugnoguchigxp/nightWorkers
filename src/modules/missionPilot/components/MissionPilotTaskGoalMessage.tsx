import type { MissionPilotControlSummary } from "../../../../shared/modules/missionPilot";
import { ThreadMessage } from "../../nightworkers/components/ThreadMessage";
import type { TaskMessage } from "../../nightworkers/types";

export function MissionPilotTaskGoalMessage({
	objective,
	summary,
	taskMessages,
}: {
	objective?: string | null;
	summary?: MissionPilotControlSummary | null;
	taskMessages: readonly TaskMessage[];
}) {
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
