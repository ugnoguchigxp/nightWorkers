import type { TaskOperatorCommandContext } from "../../../../shared/modules/taskOperator";
import { resumeCodingAgentRunTodo } from "../../agentsShare";
import { sendTaskOperatorUserMessage } from "../../task";
import { taskOperatorRequestProvenance } from "./task-operator-command-provenance";

export async function executeTaskOperatorTodoResume(input: {
	taskId: string;
	runId: string;
	todoId: string;
	expectedTodoRevision: number;
	userContext: string;
	context: TaskOperatorCommandContext;
}) {
	const message = await sendTaskOperatorUserMessage(
		input.taskId,
		input.userContext,
		{
			source: "task_operator",
			intent: "todo_resume_request",
			actor: input.context.principal,
			commandProvenance: {
				requestId: input.context.requestId,
				idempotencyKey: input.context.idempotencyKey,
			},
		},
		input.context.requestId,
	);
	const run = await resumeCodingAgentRunTodo({
		runId: input.runId,
		todoId: input.todoId,
		expectedTodoRevision: input.expectedTodoRevision,
		userContext: input.userContext,
		requestProvenance: taskOperatorRequestProvenance(input.context),
	});
	return { ...run, messageId: message?.id ?? null };
}
