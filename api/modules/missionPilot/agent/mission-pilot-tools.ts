import type { MissionPilotActionFailure } from "../../../../shared/modules/missionPilot";
import { AppError } from "../../../lib/errors";
import type {
	ProviderToolCall,
	ProviderToolDefinition,
} from "../../../services/structured-llm/public";
import { TASK_OPERATOR_RESOURCE_KINDS } from "../../taskOperator";
import type {
	MissionPilotTaskActionPort,
	MissionPilotTaskReadPort,
	MissionPilotToolExecutionResult,
} from "./mission-pilot-agent.ports";
import {
	executeMissionPilotAgentControlTool,
	isMissionPilotAgentControlTool,
	MISSION_PILOT_AGENT_CONTROL_TOOL_DEFINITIONS,
} from "./mission-pilot-agent-control-tools";
import { getMissionPilotActionDefinition } from "./mission-pilot-task-action.registry";

const taskOperatorTools: ProviderToolDefinition[] = [
	{
		name: "read_task_operator_view",
		description:
			"Task Goalと現在のresource ref、利用可能action IDを含むbounded head viewを読む。",
		inputSchema: {
			type: "object",
			properties: {},
			additionalProperties: false,
		},
	},
	{
		name: "read_task_resource",
		description:
			"Task Operator viewから選んだresource detailをpagingして読む。",
		inputSchema: {
			type: "object",
			properties: {
				resourceKind: {
					type: "string",
					enum: TASK_OPERATOR_RESOURCE_KINDS,
				},
				resourceId: { type: "string" },
				cursor: { type: "integer", minimum: 0 },
				limit: { type: "integer", minimum: 1, maximum: 100 },
			},
			required: ["resourceKind"],
			additionalProperties: false,
		},
	},
	{
		name: "list_available_task_actions",
		description: "現在利用可能なactionのIDと短い説明だけを読む。",
		inputSchema: {
			type: "object",
			properties: {},
			additionalProperties: false,
		},
	},
	{
		name: "read_task_action_contract",
		description: "選択したaction一件のinput contractを読む。",
		inputSchema: {
			type: "object",
			properties: { actionId: { type: "string" } },
			required: ["actionId"],
			additionalProperties: false,
		},
	},
	{
		name: "execute_task_action",
		description: "取得済みcontractに従ってTask actionを実行する。",
		inputSchema: {
			type: "object",
			properties: {
				actionId: { type: "string" },
				expectedTaskRevision: { type: "integer", minimum: 0 },
				idempotencyKey: { type: "string", minLength: 1 },
				arguments: { type: "object", additionalProperties: true },
			},
			required: [
				"actionId",
				"expectedTaskRevision",
				"idempotencyKey",
				"arguments",
			],
			additionalProperties: false,
		},
	},
];

export function missionPilotToolDefinitions() {
	return [
		...taskOperatorTools,
		...MISSION_PILOT_AGENT_CONTROL_TOOL_DEFINITIONS,
	];
}

export async function executeMissionPilotToolCall(input: {
	call: ProviderToolCall;
	toolCallId: string;
	leaseOwner: string;
	taskId: string;
	sessionId: string;
	turnId?: string;
	idempotencyKey: string;
	readPort: MissionPilotTaskReadPort;
	actionPort: MissionPilotTaskActionPort;
	signal: AbortSignal;
}): Promise<MissionPilotToolExecutionResult> {
	try {
		input.signal.throwIfAborted();
		const read = await executeReadTool(input);
		if (read !== null) return { ok: true, data: read, directive: "continue" };
		if (isMissionPilotAgentControlTool(input.call.name))
			return executeMissionPilotAgentControlTool({
				call: input.call,
				toolCallId: input.toolCallId,
				turnId: input.turnId,
				leaseOwner: input.leaseOwner,
				sessionId: input.sessionId,
				taskId: input.taskId,
			});
		if (input.call.name !== "execute_task_action")
			return failureResult(input.call.name, "invalid_request", "Unknown tool");
		const actionId = textArg(input.call, "actionId");
		const definition = getMissionPilotActionDefinition(actionId);
		if (!definition)
			return failureResult(actionId, "invalid_request", "Unknown Task action");
		const revision = nullableRevision(
			input.call.arguments.expectedTaskRevision,
		);
		if (revision === undefined)
			return failureResult(
				actionId,
				"schema_validation",
				"expectedTaskRevision must be a non-negative integer",
			);
		if (revision === null)
			return failureResult(
				actionId,
				"schema_validation",
				"expectedTaskRevision must not be null",
			);
		const argumentsJson = recordArg(input.call, "arguments");
		const result = await input.actionPort.execute({
			toolCallId: input.toolCallId,
			leaseOwner: input.leaseOwner,
			taskId: input.taskId,
			sessionId: input.sessionId,
			actionId,
			arguments: argumentsJson,
			expectedTaskRevision: revision,
			idempotencyKey: textArg(input.call, "idempotencyKey"),
			signal: input.signal,
		});
		return result.ok
			? {
					ok: true,
					data: result.data,
					directive: "continue",
					replayed: result.replayed,
				}
			: { ok: false, failure: result.failure, directive: "continue" };
	} catch (error) {
		if (error instanceof AppError)
			return {
				ok: false,
				directive: "continue",
				failure: {
					...toolFailure(
						input.call.name,
						error.statusCode === 401 || error.statusCode === 403
							? "permission"
							: "domain_precondition",
						error.message,
					),
					providerCode: error.code,
					httpStatus: error.statusCode,
					details: error.details ?? null,
				},
			};
		return failureResult(
			input.call.name,
			"domain_precondition",
			input.signal.aborted
				? "Mission Pilot was stopped while the tool was running."
				: error instanceof Error
					? error.message
					: String(error),
		);
	}
}

async function executeReadTool(input: {
	call: ProviderToolCall;
	taskId: string;
	sessionId: string;
	readPort: MissionPilotTaskReadPort;
}) {
	switch (input.call.name) {
		case "read_task_operator_view":
			return input.readPort.readTaskOperatorView({
				taskId: input.taskId,
				sessionId: input.sessionId,
			});
		case "read_task_resource":
			return input.readPort.readTaskResource({
				taskId: input.taskId,
				sessionId: input.sessionId,
				resourceKind: textArg(input.call, "resourceKind"),
				resourceId: optionalTextArg(input.call, "resourceId"),
				cursor: numberArg(input.call, "cursor"),
				limit: numberArg(input.call, "limit"),
			});
		case "list_available_task_actions":
			return input.readPort.listAvailableTaskActions({
				taskId: input.taskId,
				sessionId: input.sessionId,
			});
		case "read_task_action_contract":
			return input.readPort.readTaskActionContract({
				taskId: input.taskId,
				sessionId: input.sessionId,
				actionId: textArg(input.call, "actionId"),
			});
		default:
			return null;
	}
}

function failureResult(
	actionId: string,
	kind: MissionPilotActionFailure["kind"],
	message: string,
): Extract<MissionPilotToolExecutionResult, { ok: false }> {
	return {
		ok: false,
		directive: "continue",
		failure: toolFailure(actionId, kind, message),
	};
}
function textArg(call: ProviderToolCall, key: string) {
	const value = call.arguments[key];
	if (typeof value !== "string" || !value)
		throw new Error(`${key} must be a non-empty string`);
	return value;
}
function optionalTextArg(call: ProviderToolCall, key: string) {
	const value = call.arguments[key];
	return typeof value === "string" && value ? value : undefined;
}
function numberArg(call: ProviderToolCall, key: string) {
	const value = call.arguments[key];
	return typeof value === "number" && Number.isInteger(value)
		? value
		: undefined;
}
function recordArg(call: ProviderToolCall, key: string) {
	const value = call.arguments[key];
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error(`${key} must be an object`);
	return value as Record<string, unknown>;
}
function nullableRevision(value: unknown) {
	if (value === null) return null;
	return typeof value === "number" && Number.isInteger(value) && value >= 0
		? value
		: undefined;
}
function toolFailure(
	actionId: string,
	kind: MissionPilotActionFailure["kind"],
	message: string,
): MissionPilotActionFailure {
	return {
		kind,
		retryable: false,
		providerCode: null,
		httpStatus: null,
		message,
		retryAfterMs: null,
		attempt: 1,
		actionId,
		idempotencyKey: null,
	};
}
