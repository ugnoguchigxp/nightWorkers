import type { MissionPilotControlSummary } from "../../../../shared/modules/missionPilot";
import { MissionPilotControlPanel } from "./MissionPilotControlPanel";

export function MissionPilotComposerControls({
	taskId,
	summary,
	initialPrompt,
}: {
	taskId: string;
	summary: MissionPilotControlSummary;
	initialPrompt?: string;
}) {
	return (
		<MissionPilotControlPanel
			taskId={taskId}
			summary={summary}
			initialPrompt={initialPrompt}
			placement="composer"
		/>
	);
}
