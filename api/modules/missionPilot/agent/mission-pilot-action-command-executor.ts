import type { TaskOperatorPrincipal } from "../../../../shared/modules/taskOperator";
import { executeTaskOperatorCommand } from "../../taskOperator";
import { buildMissionPilotTaskOperatorRuntime } from "./mission-pilot-task-operator-runtime.adapter";

export type MissionPilotActionCommandContext = {
	sessionId: string;
	toolCallId: string;
	idempotencyKey: string;
	expectedTaskRevision: number;
	principal: Extract<TaskOperatorPrincipal, { kind: "delegated_user" }>;
	signal?: AbortSignal;
};

export async function executeMissionPilotAction(
	taskId: string,
	actionId: string,
	args: Record<string, unknown>,
	context: MissionPilotActionCommandContext,
) {
	context.signal?.throwIfAborted();
	return executeTaskOperatorCommand({
		taskId,
		actionId,
		expectedTaskRevision: context.expectedTaskRevision,
		arguments: args,
		context: {
			principal: context.principal,
			requestId: context.toolCallId,
			idempotencyKey: context.idempotencyKey,
		},
		runtime: buildMissionPilotTaskOperatorRuntime({
			sessionId: context.sessionId,
			toolCallId: context.toolCallId,
			idempotencyKey: context.idempotencyKey,
			signal: context.signal,
		}),
	});
}
