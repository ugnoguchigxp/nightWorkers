import type { MissionPilotActionFailure } from "../../../../shared/schemas/mission-pilot-agent.schema";
import type {
	ProviderToolCall,
	ProviderToolDefinition,
} from "../../../services/structured-llm/public";
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
import {
	getMissionPilotActionByToolName,
	missionPilotActionToolDefinitions,
} from "./mission-pilot-task-action.registry";

const pageSchema = {
	type: "object",
	properties: {
		cursor: { type: "integer", minimum: 0 },
		maxChars: { type: "integer", minimum: 1000, maximum: 24000 },
	},
	additionalProperties: false,
};
const readTools: ProviderToolDefinition[] = [
	{
		name: "read_task_workspace",
		description:
			"Task Goal、完了条件、Project、Questionnaire、Artifact、Queue、Run outcome、利用可能actionを読む。worker transcriptは返さない。",
		inputSchema: {
			type: "object",
			properties: {},
			additionalProperties: false,
		},
	},
	{
		name: "read_current_specification",
		description: "現在のSpecificationをdigestとpaging情報付きで読む。",
		inputSchema: pageSchema,
	},
	{
		name: "read_questionnaire_decisions",
		description: "確定済みQuestionnaire Decisionsを読む。",
		inputSchema: {
			type: "object",
			properties: {},
			additionalProperties: false,
		},
	},
	{
		name: "read_plan_artifact",
		description: "指定Artifactをdigestとpaging情報付きで読む。",
		inputSchema: {
			...pageSchema,
			properties: {
				artifactId: { type: "string" },
				cursor: { type: "integer", minimum: 0 },
				maxChars: { type: "integer", minimum: 1000, maximum: 24000 },
			},
			required: ["artifactId"],
		},
	},
	{
		name: "read_run_outcome",
		description:
			"Runのterminal final report、blocker、verification summaryを読む。",
		inputSchema: {
			...pageSchema,
			properties: {
				runId: { type: "string", format: "uuid" },
				cursor: { type: "integer", minimum: 0 },
				maxChars: { type: "integer", minimum: 1000, maximum: 24000 },
			},
			required: ["runId"],
		},
	},
	{
		name: "read_run_change_summary",
		description: "Runのユーザー可視変更summaryを読む。",
		inputSchema: {
			type: "object",
			properties: { runId: { type: "string", format: "uuid" } },
			required: ["runId"],
			additionalProperties: false,
		},
	},
	{
		name: "read_run_verification",
		description: "Runのverification summaryを読む。",
		inputSchema: {
			type: "object",
			properties: {
				runId: { type: "string", format: "uuid" },
				cursor: { type: "integer", minimum: 0 },
				limit: { type: "integer", minimum: 1, maximum: 50 },
			},
			required: ["runId"],
			additionalProperties: false,
		},
	},
	{
		name: "list_available_task_actions",
		description:
			"現在のauthorizationとpreconditionで利用できるaction catalogを読む。",
		inputSchema: {
			type: "object",
			properties: {},
			additionalProperties: false,
		},
	},
];
export function missionPilotToolDefinitions(input?: {
	availableActionIds?: ReadonlySet<string>;
}) {
	return [
		...readTools,
		...missionPilotActionToolDefinitions(input),
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
		input.signal.throwIfAborted();
		if (read) return { ok: true, data: read, directive: "continue" };
		if (isMissionPilotAgentControlTool(input.call.name))
			return executeMissionPilotAgentControlTool({
				call: input.call,
				toolCallId: input.toolCallId,
				turnId: input.turnId,
				leaseOwner: input.leaseOwner,
				sessionId: input.sessionId,
				taskId: input.taskId,
			});
		const definition = getMissionPilotActionByToolName(input.call.name);
		if (!definition)
			return {
				ok: false,
				failure: toolFailure(
					input.call.name,
					"invalid_request",
					"Unknown tool",
				),
				directive: "continue",
			};
		const revision = expectedTaskRevision(input.call.arguments);
		if (revision === null)
			return {
				ok: false,
				failure: toolFailure(
					definition.actionId,
					"schema_validation",
					"expectedTaskRevision must be a non-negative integer",
					input.idempotencyKey,
				),
				directive: "continue",
			};
		const result = await input.actionPort.execute({
			toolCallId: input.toolCallId,
			leaseOwner: input.leaseOwner,
			taskId: input.taskId,
			sessionId: input.sessionId,
			actionId: definition.actionId,
			arguments: input.call.arguments,
			expectedTaskRevision: revision,
			idempotencyKey: input.idempotencyKey,
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
		const stopped = input.signal.aborted;
		return {
			ok: false,
			directive: "continue",
			failure: toolFailure(
				input.call.name,
				"domain_precondition",
				stopped
					? "Mission Pilot was stopped while the tool was running."
					: error instanceof Error
						? error.message
						: String(error),
			),
		};
	}
}
function expectedTaskRevision(argumentsJson: Record<string, unknown>) {
	const value = argumentsJson.expectedTaskRevision;
	if (typeof value !== "number" || !Number.isInteger(value) || value < 0)
		return null;
	return value;
}
async function executeReadTool(input: {
	call: ProviderToolCall;
	taskId: string;
	sessionId: string;
	readPort: MissionPilotTaskReadPort;
}) {
	const page = {
		cursor: numberArg(input.call, "cursor"),
		maxChars: numberArg(input.call, "maxChars"),
	};
	switch (input.call.name) {
		case "read_task_workspace":
			return input.readPort.readTaskWorkspace({
				taskId: input.taskId,
				sessionId: input.sessionId,
			});
		case "read_current_specification":
			return input.readPort.readCurrentSpecification(input.taskId, page);
		case "read_questionnaire_decisions":
			return input.readPort.readQuestionnaireDecisions(input.taskId);
		case "read_plan_artifact":
			return input.readPort.readPlanArtifact(
				input.taskId,
				textArg(input.call, "artifactId"),
				page,
			);
		case "read_run_outcome":
			return input.readPort.readRunOutcome(
				input.taskId,
				textArg(input.call, "runId"),
				page,
			);
		case "read_run_change_summary":
			return input.readPort.readRunChangeSummary(
				input.taskId,
				textArg(input.call, "runId"),
			);
		case "read_run_verification":
			return input.readPort.readRunVerification(
				input.taskId,
				textArg(input.call, "runId"),
				{
					cursor: page.cursor,
					limit: numberArg(input.call, "limit"),
				},
			);
		case "list_available_task_actions":
			return input.readPort.listAvailableTaskActions({
				taskId: input.taskId,
				sessionId: input.sessionId,
			});
		default:
			return null;
	}
}
function textArg(call: ProviderToolCall, key: string) {
	const value = call.arguments[key];
	if (typeof value !== "string" || !value)
		throw new Error(`${key} must be a non-empty string`);
	return value;
}
function numberArg(call: ProviderToolCall, key: string) {
	const value = call.arguments[key];
	return typeof value === "number" && Number.isInteger(value)
		? value
		: undefined;
}
function toolFailure(
	actionId: string,
	kind: MissionPilotActionFailure["kind"],
	message: string,
	idempotencyKey: string | null = null,
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
		idempotencyKey,
	};
}
