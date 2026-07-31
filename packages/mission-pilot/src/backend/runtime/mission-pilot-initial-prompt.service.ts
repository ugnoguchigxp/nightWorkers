import { submitTaskUserIntake } from "../agentsShare";
import { MissionPilotError } from "./mission-pilot.errors";
import { createMissionPilotTaskOperatorAccess } from "./mission-pilot-delegation";

export async function dispatchMissionPilotInitialPrompt(input: {
	sessionId: string;
	taskId: string;
	taskRevision: number;
	initialPrompt: string;
}) {
	const access = await createMissionPilotTaskOperatorAccess({
		sessionId: input.sessionId,
		taskId: input.taskId,
	});
	const requestId = [
		"mission-pilot-initial-prompt",
		input.sessionId,
		input.taskRevision,
	].join(":");
	const delivered = await submitTaskUserIntake({
		taskId: input.taskId,
		prompt: input.initialPrompt,
		requestId,
		idempotencyKey: requestId,
		actor: {
			kind: "delegated_user",
			actorId: access.context.principal.actorId,
		},
	});
	if (!delivered.messageId)
		throw new MissionPilotError(
			500,
			"MISSION_PILOT_INITIAL_PROMPT_MESSAGE_MISSING",
			"Mission Pilotの初期Promptをユーザーメッセージとして保存できませんでした",
		);
	return {
		taskId: delivered.taskId,
		initialPromptMessageId: delivered.messageId,
	};
}
