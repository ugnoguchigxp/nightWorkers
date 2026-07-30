export type TaskUserIntakeActor = {
	kind: "human" | "delegated_user";
	actorId: string;
};

/**
 * A user-visible Task message submitted through the same intake boundary as the
 * Workbench composer. The receiver owns Plan Mode / Coding Agent routing.
 */
export type SubmitTaskUserIntakeCommand = {
	taskId: string;
	prompt: string;
	requestId: string;
	idempotencyKey: string;
	actor: TaskUserIntakeActor;
};

export type SubmitTaskUserIntakeResult = {
	taskId: string;
	messageId: string;
};
