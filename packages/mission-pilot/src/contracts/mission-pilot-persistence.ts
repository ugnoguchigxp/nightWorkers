export const MISSION_PILOT_PERSISTENCE_OPERATIONS = Object.freeze([
	"getOrCreateSession",
	"getSessionByTaskId",
	"claimStop",
	"finishStop",
	"createMissionPilotActionExecutionIntent",
	"getMissionPilotActionExecutionByToolCall",
	"getLatestSucceededMissionPilotImplementationRunId",
	"claimMissionPilotActionExecution",
	"completeMissionPilotActionExecution",
	"listMissionPilotActionExecutionReceipts",
	"reconcileMissionPilotActionExecutionReceipts",
	"backfillStoppedMissionPilotAgentSessions",
	"isMissionPilotAgentSession",
	"getMissionPilotAgentSessionById",
	"claimAgentPlay",
	"completeAgentInitialPromptDispatch",
	"claimAgentStop",
	"getMissionPilotSessionById",
	"listPlayingAgentSessions",
	"claimMissionPilotAgentTurn",
	"renewMissionPilotAgentTurnLease",
	"persistMissionPilotProviderTurn",
	"claimMissionPilotToolCall",
	"completeMissionPilotToolCall",
	"reprojectMissionPilotTerminalToolCall",
	"finishMissionPilotAgentTurn",
	"loadMissionPilotProviderMessages",
	"getMissionPilotConversationCheckpoint",
	"listMissionPilotConversation",
	"reconcileInterruptedMissionPilotAgentSessions",
	"seedMissionPilotConversation",
	"appendMissionPilotUserMessage",
	"appendMissionPilotRuntimeFailure",
	"appendMissionPilotConversationItem",
	"compactMissionPilotConversation",
	"appendMissionPilotTaskEvent",
	"projectMissionPilotNextWakeAt",
	"projectMissionPilotExecutionEvent",
	"listPendingMissionPilotTaskEvents",
	"getNextMissionPilotTaskEventAt",
	"consumeMissionPilotTaskEventBySource",
	"consumePendingMissionPilotQuestionnaireEvents",
	"hasConsumedMissionPilotQuestionnaireAnsweringEvent",
	"cancelMissionPilotProviderRetryEvents",
	"executeMissionPilotAgentControlTool",
	"cancelPendingMissionPilotToolCalls",
	"cancelRunningMissionPilotToolCalls",
	"buildMissionPilotCurrentStepContext",
	"resolveMissionPilotRuntimeOwnership",
	"isAgentMissionPilotRuntime",
	"readMissionPilotTaskActionState",
	"listMissionPilotToolCalls",
	"prepareExpiredMissionPilotRuntimeFixture",
] as const);

export type MissionPilotPersistenceOperation =
	(typeof MISSION_PILOT_PERSISTENCE_OPERATIONS)[number];

export type MissionPilotPersistenceRequest = Readonly<{
	operation: MissionPilotPersistenceOperation;
	args: readonly unknown[];
}>;

const operationSet = new Set<string>(MISSION_PILOT_PERSISTENCE_OPERATIONS);

export function isMissionPilotPersistenceRequest(
	value: unknown,
): value is MissionPilotPersistenceRequest {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const request = value as Record<string, unknown>;
	return (
		typeof request.operation === "string" &&
		operationSet.has(request.operation) &&
		Array.isArray(request.args)
	);
}
