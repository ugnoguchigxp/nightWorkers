import type {
	MissionPilotActionFailure,
	MissionPilotTaskActionDescriptor,
	MissionPilotTaskEventType,
	MissionPilotTaskReadModel,
} from "../../../../shared/schemas/mission-pilot-agent.schema";
import type {
	ProviderToolDefinition,
	ProviderToolMessage,
	ProviderToolTurnResult,
} from "../../../services/structured-llm/public";
import type { MissionPilotCurrentStepContext } from "./mission-pilot-current-step-context";

export type MissionPilotProviderPort = {
	nextTurn(input: {
		sessionId: string;
		systemContext: string;
		messages: ProviderToolMessage[];
		tools: ProviderToolDefinition[];
		providerEndpointId: string | null;
		model: string | null;
		thinkingDepth: string | null;
		taskId: string;
		signal: AbortSignal;
		currentStepContext?: MissionPilotCurrentStepContext;
	}): Promise<ProviderToolTurnResult>;
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
		taskId: string,
		runId: string,
		options?: { cursor?: number; maxChars?: number },
	): Promise<unknown>;
	readRunChangeSummary(taskId: string, runId: string): Promise<unknown>;
	readRunVerification(
		taskId: string,
		runId: string,
		options?: { cursor?: number; limit?: number },
	): Promise<unknown>;
	listAvailableTaskActions(input: {
		taskId: string;
		sessionId: string;
	}): Promise<MissionPilotTaskActionDescriptor[]>;
};
export type MissionPilotActionResult =
	| { ok: true; actionId: string; data: unknown }
	| { ok: false; actionId: string; failure: MissionPilotActionFailure };
export type MissionPilotToolExecutionResult =
	| { ok: true; data: unknown; directive: "continue" }
	| {
			ok: true;
			data: unknown;
			directive: "wait";
			waitFor: MissionPilotTaskEventType[];
	  }
	| { ok: true; data: unknown; directive: "finish" }
	| { ok: false; failure: MissionPilotActionFailure; directive: "continue" };
export type MissionPilotTaskActionPort = {
	execute(input: {
		toolCallId: string;
		leaseOwner: string;
		taskId: string;
		sessionId: string;
		actionId: string;
		arguments: Record<string, unknown>;
		expectedTaskRevision: number;
		idempotencyKey: string;
	}): Promise<MissionPilotActionResult>;
};
