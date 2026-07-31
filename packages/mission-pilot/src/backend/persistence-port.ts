import { callMissionPilotHost } from "./host-bindings";

export const MISSION_PILOT_PERSISTENCE_OPERATIONS = [
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
] as const;

export type MissionPilotPersistenceOperation =
	(typeof MISSION_PILOT_PERSISTENCE_OPERATIONS)[number];

// The dynamic return type is contained at this private host boundary. Every
// operation name is fixed by the package and checked again by the host.
// biome-ignore lint/suspicious/noExplicitAny: in-process host boundary adapter
export function callMissionPilotPersistence<T = any>(
	operation: MissionPilotPersistenceOperation,
	...args: unknown[]
): Promise<T> {
	return callMissionPilotHost("executeMissionPilotPersistence", {
		operation,
		args,
	});
}
