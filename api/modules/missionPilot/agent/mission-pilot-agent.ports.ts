import type {
	MissionPilotActionResult,
	MissionPilotRunOutcome,
	MissionPilotTaskActionDescriptor,
	MissionPilotTaskReadModel,
} from "../../../../shared/schemas/mission-pilot-agent.schema";
import type {
	ProviderToolDefinition,
	ProviderToolMessage,
	ProviderToolTurnResult,
} from "../../../services/structured-llm/public";

export type MissionPilotProviderTurn = ProviderToolTurnResult;

export type MissionPilotProviderPort = {
	nextTurn(input: {
		systemContext: string;
		messages: ProviderToolMessage[];
		tools: ProviderToolDefinition[];
		providerEndpointId: string | null;
		model: string | null;
		thinkingDepth: string | null;
		taskId: string;
		signal: AbortSignal;
	}): Promise<MissionPilotProviderTurn>;
};

export type MissionPilotTaskReadPort = {
	readTaskWorkspace(input: {
		taskId: string;
		sessionId: string;
	}): Promise<MissionPilotTaskReadModel>;
	readCurrentSpecification(
		taskId: string,
		options?: { cursor?: number; maxChars?: number },
	): Promise<unknown>;
	readQuestionnaireDecisions(taskId: string): Promise<unknown>;
	readPlanArtifact(
		taskId: string,
		artifactId: string,
		options?: { cursor?: number; maxChars?: number },
	): Promise<unknown>;
	readRunOutcome(
		runId: string,
		options?: { cursor?: number; maxChars?: number },
	): Promise<MissionPilotRunOutcome>;
	readRunChangeSummary(runId: string): Promise<unknown>;
	readRunVerification(
		runId: string,
		options?: { cursor?: number; limit?: number },
	): Promise<unknown>;
	listAvailableTaskActions(input: {
		taskId: string;
		sessionId: string;
	}): Promise<MissionPilotTaskActionDescriptor[]>;
};

export type MissionPilotTaskActionPort = {
	execute(input: {
		toolCallId: string;
		taskId: string;
		sessionId: string;
		actionId: string;
		arguments: Record<string, unknown>;
		idempotencyKey: string;
	}): Promise<MissionPilotActionResult>;
};
