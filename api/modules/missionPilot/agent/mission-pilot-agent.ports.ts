import type {
	MissionPilotActionFailure,
	MissionPilotTaskEventType,
} from "../../../../shared/modules/missionPilot";
import type { TaskOperatorProjectionV1 } from "../../../../shared/modules/taskOperator";
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
	readTaskOperatorView(input: {
		taskId: string;
		sessionId: string;
	}): Promise<TaskOperatorProjectionV1>;
	readTaskResource(input: {
		taskId: string;
		sessionId: string;
		resourceKind: string;
		resourceId?: string;
		cursor?: number;
		limit?: number;
	}): Promise<unknown>;
	listAvailableTaskActions(input: {
		taskId: string;
		sessionId: string;
	}): Promise<
		Array<{
			id: string;
			title: string;
			description: string;
			availability: "available" | "confirmation_required";
			expectedRevision: number;
		}>
	>;
	readTaskActionContract(input: {
		taskId: string;
		sessionId: string;
		actionId: string;
	}): Promise<unknown>;
};
export type MissionPilotActionResult =
	| { ok: true; actionId: string; data: unknown; replayed?: boolean }
	| { ok: false; actionId: string; failure: MissionPilotActionFailure };
export type MissionPilotToolExecutionResult =
	| { ok: true; data: unknown; directive: "continue"; replayed?: boolean }
	| {
			ok: true;
			data: unknown;
			directive: "wait";
			waitFor: MissionPilotTaskEventType[];
			replayed?: boolean;
	  }
	| { ok: true; data: unknown; directive: "finish"; replayed?: boolean }
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
		signal: AbortSignal;
	}): Promise<MissionPilotActionResult>;
};
