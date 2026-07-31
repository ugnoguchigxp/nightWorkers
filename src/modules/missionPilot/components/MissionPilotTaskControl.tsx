import { MissionPilotControlPanel } from "./MissionPilotControlPanel";

export function MissionPilotTaskControl({
	taskId,
	initialPrompt,
}: {
	taskId: string;
	initialPrompt?: string;
}) {
	return (
		<MissionPilotControlPanel
			taskId={taskId}
			initialPrompt={initialPrompt}
			placement="sidebar"
		/>
	);
}
