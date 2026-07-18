import { missionPilotPlanRoutingToolCallSchema } from "../../../../shared/schemas/plan-mode-routing.schema";
import { missionPilotThoughtTrace } from "../../nightworkers/nightworkers.trace-provenance";
import type { TaskOperatorCommandRuntime } from "../../taskOperator";
import { missionPilotArtifactProviderExecutionPolicy } from "../adapters/mission-pilot-provider.adapter";
import { missionPilotArtifactTrace } from "../mission-pilot-trace-provenance";

export function buildMissionPilotTaskOperatorRuntime(input: {
	sessionId: string;
	toolCallId: string;
	idempotencyKey: string;
	signal?: AbortSignal;
}): TaskOperatorCommandRuntime {
	return {
		signal: input.signal,
		structuredLlmRole: "mission_pilot",
		providerExecutionPolicy: missionPilotArtifactProviderExecutionPolicy,
		usageTrace: missionPilotThoughtTrace({ sessionId: input.sessionId }),
		artifactTrace: missionPilotArtifactTrace({ sessionId: input.sessionId }),
		messageTrace: missionPilotThoughtTrace({ sessionId: input.sessionId }),
		messageMetadata: {
			source: "mission_pilot",
			missionPilotSessionId: input.sessionId,
			intent: "chat",
			missionPilotAction: {
				idempotencyKey: input.idempotencyKey,
				toolCallId: input.toolCallId,
			},
		},
		executeQuestionnaireDraft: async ({
			taskId,
			arguments: args,
			idempotencyKey,
		}) => {
			const { saveAgentQuestionnaireDraft } = await import(
				"./mission-pilot-agent-questionnaire.service"
			);
			return saveAgentQuestionnaireDraft({
				taskId,
				questionnaireSessionId: requiredText(args.questionnaireSessionId),
				answers: Array.isArray(args.answers) ? args.answers : [],
				answerEvidence: Array.isArray(args.answerEvidence)
					? (args.answerEvidence as Array<{
							questionId: string;
							reason: string;
						}>)
					: [],
				idempotencyKey,
			});
		},
		executePlanRouting: async ({ taskId, arguments: args }) => {
			const toolCall = missionPilotPlanRoutingToolCallSchema.parse({
				tool: "edit_plan_artifact_routing",
				expectedRevision: args.expectedRevision,
				idempotencyKey: args.idempotencyKey,
				changes: args.changes,
			});
			const { executeMissionPilotPlanRoutingTool } = await import(
				"../planning/plan-mode-routing.service"
			);
			return executeMissionPilotPlanRoutingTool(taskId, toolCall);
		},
	};
}

function requiredText(value: unknown) {
	if (typeof value !== "string" || value.length === 0)
		throw new Error("A non-empty string is required.");
	return value;
}
