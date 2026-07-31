import type {
	MissionPilotActionFailure,
	MissionPilotTaskEventType,
} from "../contracts";
import type { MissionPilotSessionRecord } from "./storage/repository";

export type MissionPilotAgentRecord = {
	sessionId: string;
	runtimeState: string;
	conversationRevision: number;
	leaseOwner: string | null;
	currentTurnId: string | null;
	[key: string]: unknown;
};

export type MissionPilotConversationItemRecord = {
	id: string;
	sessionId: string;
	sequence: number;
	kind: string;
	turnId: string | null;
	toolCallId: string | null;
	bodyJson: unknown;
	sourceKind: string | null;
	sourceId: string | null;
	createdAt: Date;
};

export type MissionPilotToolCallRecord = {
	id: string;
	sessionId: string;
	turnId: string;
	providerCallId: string;
	actionId: string;
	argumentsJson: unknown;
	status: "pending" | "running" | "succeeded" | "failed" | "cancelled";
	idempotencyKey: string;
	expectedTaskRevision: number | null;
	resultJson: unknown;
	failureJson: MissionPilotActionFailure | null;
	startedAt: Date | null;
	finishedAt: Date | null;
	createdAt: Date;
	[key: string]: unknown;
};

export type MissionPilotActionExecutionRecord = {
	id: string;
	sessionId: string;
	taskId: string;
	toolCallId: string;
	actionId: string;
	idempotencyKey: string;
	status: "pending" | "executing" | "outcome_unknown" | "succeeded" | "failed";
	resultJson: unknown;
	failureJson: MissionPilotActionFailure | null;
	[key: string]: unknown;
};

export type MissionPilotTaskEventRecord = {
	id: string;
	sessionId: string;
	taskId: string;
	sequence: number;
	eventType: MissionPilotTaskEventType;
	sourceEventId: string;
	taskRevision: number;
	payloadJson: unknown;
	availableAt: Date;
	consumedAt: Date | null;
	createdAt: Date;
	[key: string]: unknown;
};

export type MissionPilotConversationCheckpoint = {
	revision: number;
	sourceThroughSequence: number;
};

export type MissionPilotTaskActionState = {
	session: MissionPilotSessionRecord | null;
	toolCall: MissionPilotToolCallRecord | null;
	agent: MissionPilotAgentRecord | null;
};
