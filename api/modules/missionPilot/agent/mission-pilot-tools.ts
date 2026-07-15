import type { MissionPilotActionFailure } from "../../../../shared/schemas/mission-pilot-agent.schema";
import type {
	ProviderToolCall,
	ProviderToolDefinition,
} from "../../../services/structured-llm/public";
import type {
	MissionPilotTaskActionPort,
	MissionPilotTaskReadPort,
} from "./mission-pilot-agent.ports";
import {
	getMissionPilotActionByToolName,
	missionPilotActionToolDefinitions,
} from "./mission-pilot-task-action.registry";

const readTools: ProviderToolDefinition[] = [
	{
		name: "read_task_workspace",
		description:
			"Task goal、Project、current UI view、Questionnaire、Plan Artifact、Queue、Run outcome、利用可能actionを読む。worker transcriptは返さない。",
		inputSchema: {
			type: "object",
			properties: {},
			additionalProperties: false,
		},
	},
	{
		name: "read_current_specification",
		description:
			"current Specificationの本文、revision、digest、source refsをpage単位で読む。",
		inputSchema: pagedContentSchema(),
	},
	{
		name: "read_questionnaire_decisions",
		description:
			"確定済みQuestionnaire Decisionsを採用answerとsource revision付きで読む。",
		inputSchema: {
			type: "object",
			properties: {},
			additionalProperties: false,
		},
	},
	{
		name: "read_plan_artifact",
		description: "指定したcurrent Plan ArtifactをIDとpageで読む。",
		inputSchema: {
			...pagedContentSchema(),
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
			"指定Runのterminal final report、blocker、verification summaryをpage単位で読む。",
		inputSchema: {
			...pagedContentSchema(),
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
		description:
			"指定Runの変更ファイル、追加削除行数、diff digest、stage/commit状態を読む。diff本文は返さない。",
		inputSchema: {
			type: "object",
			properties: { runId: { type: "string", format: "uuid" } },
			required: ["runId"],
			additionalProperties: false,
		},
	},
	{
		name: "read_run_verification",
		description:
			"指定Runの検証command、exit code、test集計、duration、evidence参照、失敗診断をpage単位で読む。",
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
			"現在のauthorizationとpreconditionで選択可能なTask actionを列挙する。",
		inputSchema: {
			type: "object",
			properties: {},
			additionalProperties: false,
		},
	},
];

export function missionPilotToolDefinitions() {
	return [...readTools, ...missionPilotActionToolDefinitions()];
}

export async function executeMissionPilotToolCall(input: {
	toolCallId: string;
	call: ProviderToolCall;
	taskId: string;
	sessionId: string;
	idempotencyKey: string;
	readPort: MissionPilotTaskReadPort;
	actionPort: MissionPilotTaskActionPort;
}): Promise<
	| { ok: true; data: unknown }
	| { ok: false; failure: MissionPilotActionFailure }
> {
	try {
		const readResult = await executeReadTool(input);
		if (readResult) return { ok: true, data: readResult.data };
		const definition = getMissionPilotActionByToolName(input.call.name);
		if (!definition)
			return {
				ok: false,
				failure: toolFailure(
					input.call.name,
					"invalid_request",
					"Unknown tool",
				),
			};
		const result = await input.actionPort.execute({
			toolCallId: input.toolCallId,
			taskId: input.taskId,
			sessionId: input.sessionId,
			actionId: definition.actionId,
			arguments: input.call.arguments,
			idempotencyKey: input.idempotencyKey,
		});
		return result.ok
			? { ok: true, data: result.data }
			: { ok: false, failure: result.failure };
	} catch (error) {
		return {
			ok: false,
			failure: toolFailure(
				input.call.name,
				"domain_precondition",
				error instanceof Error ? error.message : String(error),
			),
		};
	}
}

async function executeReadTool(input: {
	call: ProviderToolCall;
	taskId: string;
	sessionId: string;
	readPort: MissionPilotTaskReadPort;
}) {
	const page = {
		cursor: optionalIntegerArg(input.call, "cursor"),
		maxChars: optionalIntegerArg(input.call, "maxChars"),
	};
	switch (input.call.name) {
		case "read_task_workspace":
			return {
				data: await input.readPort.readTaskWorkspace({
					taskId: input.taskId,
					sessionId: input.sessionId,
				}),
			};
		case "read_current_specification":
			return {
				data: await input.readPort.readCurrentSpecification(input.taskId, page),
			};
		case "read_questionnaire_decisions":
			return {
				data: await input.readPort.readQuestionnaireDecisions(input.taskId),
			};
		case "read_plan_artifact":
			return {
				data: await input.readPort.readPlanArtifact(
					input.taskId,
					textArg(input.call, "artifactId"),
					page,
				),
			};
		case "read_run_outcome":
			return {
				data: await input.readPort.readRunOutcome(
					textArg(input.call, "runId"),
					page,
				),
			};
		case "read_run_change_summary":
			return {
				data: await input.readPort.readRunChangeSummary(
					textArg(input.call, "runId"),
				),
			};
		case "read_run_verification":
			return {
				data: await input.readPort.readRunVerification(
					textArg(input.call, "runId"),
					{
						cursor: page.cursor,
						limit: optionalIntegerArg(input.call, "limit"),
					},
				),
			};
		case "list_available_task_actions":
			return {
				data: await input.readPort.listAvailableTaskActions({
					taskId: input.taskId,
					sessionId: input.sessionId,
				}),
			};
		default:
			return null;
	}
}

function pagedContentSchema() {
	return {
		type: "object",
		properties: {
			cursor: { type: "integer", minimum: 0 },
			maxChars: { type: "integer", minimum: 1000, maximum: 24000 },
		},
		additionalProperties: false,
	};
}

function textArg(call: ProviderToolCall, key: string) {
	const value = call.arguments[key];
	if (typeof value !== "string" || !value)
		throw new Error(`${key} must be a non-empty string`);
	return value;
}

function optionalIntegerArg(call: ProviderToolCall, key: string) {
	const value = call.arguments[key];
	return typeof value === "number" && Number.isInteger(value)
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
