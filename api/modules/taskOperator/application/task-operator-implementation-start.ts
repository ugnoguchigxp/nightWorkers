import type {
	TaskOperatorCommandContext,
	TaskOperatorProjectionV1,
} from "../../../../shared/modules/taskOperator";
import { startCodingAgentRun } from "../../agentsShare";
import { sendTaskOperatorUserMessage } from "../../task";
import { taskOperatorRequestProvenance } from "./task-operator-command-provenance";

export async function executeTaskOperatorImplementationStart(input: {
	taskId: string;
	request: string;
	projection: TaskOperatorProjectionV1;
	context: TaskOperatorCommandContext;
}) {
	const message = await sendTaskOperatorUserMessage(
		input.taskId,
		input.request,
		{
			source: "task_operator",
			intent: "implementation_request",
			actor: input.context.principal,
			commandProvenance: {
				requestId: input.context.requestId,
				idempotencyKey: input.context.idempotencyKey,
			},
		},
		input.context.requestId,
	);
	const run = await startCodingAgentRun({
		taskId: input.taskId,
		taskRef: {
			id: input.projection.task.id,
			revision: input.projection.task.revision,
		},
		instruction: input.request,
		artifactRefs: input.projection.artifactIndex.latestByKind,
		repositoryRef: {
			id: input.projection.project.id,
			revision: input.projection.project.revision,
		},
		requestProvenance: taskOperatorRequestProvenance(input.context),
	});
	return { ...run, messageId: message?.id ?? null };
}
