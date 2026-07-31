import { MissionPilotControlPanel } from "./MissionPilotControlPanel";

export function MissionPilotComposerControls({
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
			placement="composer"
		/>
	);
}
