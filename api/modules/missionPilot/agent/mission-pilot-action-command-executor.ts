import { executeTaskOperatorCommand } from "../../taskOperator";
import { buildMissionPilotTaskOperatorRuntime } from "./mission-pilot-task-operator-runtime.adapter";

export type MissionPilotActionCommandContext = {
	sessionId: string;
	toolCallId: string;
	idempotencyKey: string;
	expectedTaskRevision: number;
	sourceRunId: string | null;
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
			principal: {
				kind: "automation",
				actorId: context.sessionId,
				authorizationRef: context.sessionId,
			},
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
