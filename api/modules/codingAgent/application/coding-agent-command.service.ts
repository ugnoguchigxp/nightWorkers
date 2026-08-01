import type {
	CodingAgentCommandData,
	CodingAgentCommandRequestV1,
	CodingAgentCommandResponseV1,
} from "../../../../shared/modules/codingAgent";
import type {
	TaskOperatorCommandReceipt,
	TaskOperatorPrincipal,
} from "../../../../shared/modules/taskOperator";
import { taskOperatorCommandFailureResponse } from "../../commandDelivery";
import { readLatestTaskRunReference } from "../../run";
import {
	readLatestTaskUserMessageAfter,
	readTaskOperatorTask,
} from "../../task";
import {
	executeTaskOperatorCommand,
	humanTaskOperatorCommandContext,
} from "../../taskOperator";

export type DirectTaskOperatorPrincipal = Exclude<
	TaskOperatorPrincipal,
	{ kind: "delegated_user" }
>;

export type CodingAgentCommandExecution = {
	receipt: TaskOperatorCommandReceipt;
	data: CodingAgentCommandData;
};

export async function executeCodingAgentCommand(
	request: CodingAgentCommandRequestV1,
	principal: DirectTaskOperatorPrincipal,
): Promise<CodingAgentCommandExecution> {
	const context = {
		...humanTaskOperatorCommandContext({
			requestId: request.requestId,
			idempotencyKey: request.idempotencyKey,
		}),
		principal,
	};

	switch (request.actionId) {
		case "run.implementation.start": {
			const result = await executeTaskOperatorCommand({
				taskId: request.taskId,
				actionId: request.actionId,
				expectedTaskRevision: request.expectedTaskRevision,
				arguments: request.arguments,
				resolveArgumentsForExecution: async () => ({
					request:
						request.arguments.request ??
						(await resolveCodingAgentImplementationRequest(request.taskId)),
				}),
				context,
			});
			return {
				receipt: result.receipt,
				data: { taskId: request.taskId, runId: result.data.runId },
			};
		}
		case "run.stop": {
			const result = await executeTaskOperatorCommand({
				taskId: request.taskId,
				actionId: request.actionId,
				expectedTaskRevision: request.expectedTaskRevision,
				arguments: request.arguments,
				context,
			});
			return {
				receipt: result.receipt,
				data: { taskId: request.taskId, runId: result.data.id },
			};
		}
		case "run.todo.resume": {
			const result = await executeTaskOperatorCommand({
				taskId: request.taskId,
				actionId: request.actionId,
				expectedTaskRevision: request.expectedTaskRevision,
				arguments: request.arguments,
				context,
			});
			return {
				receipt: result.receipt,
				data: { taskId: request.taskId, runId: result.data.runId },
			};
		}
	}
}

export async function executeCodingAgentTransportCommand(
	request: CodingAgentCommandRequestV1,
	principal: DirectTaskOperatorPrincipal,
): Promise<{
	statusCode: number;
	response: CodingAgentCommandResponseV1;
}> {
	try {
		const result = await executeCodingAgentCommand(request, principal);
		return {
			statusCode: 200,
			response: {
				version: 1,
				type: "coding_agent.command.result",
				requestId: request.requestId,
				result: { ok: true, ...result },
			},
		};
	} catch (error) {
		const failure = taskOperatorCommandFailureResponse(error);
		return {
			statusCode: failure.statusCode,
			response: {
				version: 1,
				type: "coding_agent.command.result",
				requestId: request.requestId,
				result: { ok: false, error: failure.failure },
			},
		};
	}
}

export async function resolveCodingAgentImplementationRequest(taskId: string) {
	const [task, latestRun] = await Promise.all([
		readTaskOperatorTask(taskId),
		readLatestTaskRunReference(taskId),
	]);
	if (latestRun) {
		const retryMessage = await readLatestTaskUserMessageAfter({
			taskId,
			after: latestRun.updatedAt,
		});
		const retryRequest = retryMessage?.content.trim();
		if (retryRequest) return retryRequest;
	}
	const objective = task.objective?.trim();
	return (
		objective || `Task「${task.title}」を実装し、検証まで完了してください。`
	);
}
