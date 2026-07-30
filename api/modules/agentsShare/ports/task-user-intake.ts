import type {
	SubmitTaskUserIntakeCommand,
	SubmitTaskUserIntakeResult,
} from "../contracts/task-user-intake";

export type SubmitTaskUserIntakeHandler = (
	command: SubmitTaskUserIntakeCommand,
) => Promise<SubmitTaskUserIntakeResult>;

let handler: SubmitTaskUserIntakeHandler | null = null;

export function registerTaskUserIntakeHandler(
	nextHandler: SubmitTaskUserIntakeHandler,
) {
	handler = nextHandler;
	return () => {
		if (handler === nextHandler) handler = null;
	};
}

export async function submitTaskUserIntake(
	command: SubmitTaskUserIntakeCommand,
) {
	if (!handler) throw new Error("Task user intake handler is not registered.");
	return handler(command);
}
