import {
	registerTaskUserIntakeHandler,
	type SubmitTaskUserIntakeCommand,
} from "../agentsShare";
import { appendWorkbenchMessage } from "./nightworkers.workbench-message.service";

let unregister: (() => void) | null = null;

export function initializeTaskUserIntakeHandler() {
	if (unregister) return unregister;
	unregister = registerTaskUserIntakeHandler(handleTaskUserIntake);
	return unregister;
}

export async function handleTaskUserIntake(
	command: SubmitTaskUserIntakeCommand,
) {
	const result = await appendWorkbenchMessage(command.taskId, {
		prompt: command.prompt,
		intent: "intake",
		waitForIntake: false,
		source: "workbench",
		commandContext: {
			requestId: command.requestId,
			idempotencyKey: command.idempotencyKey,
			actor: command.actor,
		},
	});
	const message = result.messages.find((candidate) => {
		const metadata =
			candidate.metadataJson &&
			typeof candidate.metadataJson === "object" &&
			!Array.isArray(candidate.metadataJson)
				? (candidate.metadataJson as Record<string, unknown>)
				: {};
		const provenance =
			metadata.commandProvenance &&
			typeof metadata.commandProvenance === "object" &&
			!Array.isArray(metadata.commandProvenance)
				? (metadata.commandProvenance as Record<string, unknown>)
				: {};
		return (
			candidate.role === "user" &&
			provenance.idempotencyKey === command.idempotencyKey
		);
	});
	if (!message)
		throw new Error("Task intake did not persist the user-visible message.");
	return { taskId: command.taskId, messageId: message.id };
}
