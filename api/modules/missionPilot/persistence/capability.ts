import {
	isMissionPilotPersistenceRequest,
	type MissionPilotPersistenceOperation,
	type MissionPilotPersistenceRequest,
} from "@nightworkers/mission-pilot/contracts";
import {
	claimMissionPilotActionExecution,
	completeMissionPilotActionExecution,
	createMissionPilotActionExecutionIntent,
	getLatestSucceededMissionPilotImplementationRunId,
	getMissionPilotActionExecutionByToolCall,
	listMissionPilotActionExecutionReceipts,
	reconcileMissionPilotActionExecutionReceipts,
} from "./agent/action-execution.repository";
import { executeMissionPilotAgentControlTool } from "./agent/agent-control-tools";
import {
	cancelPendingMissionPilotToolCalls,
	cancelRunningMissionPilotToolCalls,
} from "./agent/agent-lifecycle.repository";
import {
	backfillStoppedMissionPilotAgentSessions,
	claimAgentPlay,
	claimAgentStop,
	completeAgentInitialPromptDispatch,
	getMissionPilotAgentSessionById,
	getMissionPilotSessionById,
	isMissionPilotAgentSession,
	listPlayingAgentSessions,
} from "./agent/agent-session.repository";
import {
	claimMissionPilotAgentTurn,
	claimMissionPilotToolCall,
	completeMissionPilotToolCall,
	persistMissionPilotProviderTurn,
	renewMissionPilotAgentTurnLease,
	reprojectMissionPilotTerminalToolCall,
} from "./agent/conversation.repository";
import {
	finishMissionPilotAgentTurn,
	getMissionPilotConversationCheckpoint,
	listMissionPilotConversation,
	loadMissionPilotProviderMessages,
	reconcileInterruptedMissionPilotAgentSessions,
} from "./agent/conversation-query.repository";
import {
	appendMissionPilotConversationItem,
	appendMissionPilotRuntimeFailure,
	appendMissionPilotUserMessage,
	compactMissionPilotConversation,
	seedMissionPilotConversation,
} from "./agent/conversation-write.repository";
import { buildMissionPilotCurrentStepContext } from "./agent/current-step-context";
import {
	isAgentMissionPilotRuntime,
	resolveMissionPilotRuntimeOwnership,
} from "./agent/runtime-ownership";
import {
	listMissionPilotToolCalls,
	prepareExpiredMissionPilotRuntimeFixture,
	readMissionPilotTaskActionState,
} from "./agent/runtime-query.repository";
import {
	appendMissionPilotTaskEvent,
	cancelMissionPilotProviderRetryEvents,
	consumeMissionPilotTaskEventBySource,
	consumePendingMissionPilotQuestionnaireEvents,
	getNextMissionPilotTaskEventAt,
	hasConsumedMissionPilotQuestionnaireAnsweringEvent,
	listPendingMissionPilotTaskEvents,
	projectMissionPilotExecutionEvent,
	projectMissionPilotNextWakeAt,
} from "./agent/task-event.repository";
import { getOrCreateSession, getSessionByTaskId } from "./repository";
import { claimStop, finishStop } from "./stop-repository";

// This is deliberately a semantic operation map. It never accepts SQL, table
// names, or a database handle from the package.
const operationHandlers = {
	getOrCreateSession,
	getSessionByTaskId,
	claimStop,
	finishStop,
	createMissionPilotActionExecutionIntent,
	getMissionPilotActionExecutionByToolCall,
	getLatestSucceededMissionPilotImplementationRunId,
	claimMissionPilotActionExecution,
	completeMissionPilotActionExecution,
	listMissionPilotActionExecutionReceipts,
	reconcileMissionPilotActionExecutionReceipts,
	backfillStoppedMissionPilotAgentSessions,
	isMissionPilotAgentSession,
	getMissionPilotAgentSessionById,
	claimAgentPlay,
	completeAgentInitialPromptDispatch,
	claimAgentStop,
	getMissionPilotSessionById,
	listPlayingAgentSessions,
	claimMissionPilotAgentTurn,
	renewMissionPilotAgentTurnLease,
	persistMissionPilotProviderTurn,
	claimMissionPilotToolCall,
	completeMissionPilotToolCall,
	reprojectMissionPilotTerminalToolCall,
	finishMissionPilotAgentTurn,
	loadMissionPilotProviderMessages,
	getMissionPilotConversationCheckpoint,
	listMissionPilotConversation,
	reconcileInterruptedMissionPilotAgentSessions,
	seedMissionPilotConversation,
	appendMissionPilotUserMessage,
	appendMissionPilotRuntimeFailure,
	appendMissionPilotConversationItem,
	compactMissionPilotConversation,
	appendMissionPilotTaskEvent,
	projectMissionPilotNextWakeAt,
	projectMissionPilotExecutionEvent,
	listPendingMissionPilotTaskEvents,
	getNextMissionPilotTaskEventAt,
	consumeMissionPilotTaskEventBySource,
	consumePendingMissionPilotQuestionnaireEvents,
	hasConsumedMissionPilotQuestionnaireAnsweringEvent,
	cancelMissionPilotProviderRetryEvents,
	executeMissionPilotAgentControlTool,
	cancelPendingMissionPilotToolCalls,
	cancelRunningMissionPilotToolCalls,
	buildMissionPilotCurrentStepContext,
	resolveMissionPilotRuntimeOwnership,
	isAgentMissionPilotRuntime,
	readMissionPilotTaskActionState,
	listMissionPilotToolCalls,
	prepareExpiredMissionPilotRuntimeFixture,
} as const satisfies Record<
	MissionPilotPersistenceOperation,
	(...args: never[]) => unknown
>;

export type MissionPilotPersistenceCapability = Readonly<{
	execute(request: MissionPilotPersistenceRequest): Promise<unknown>;
}>;

/**
 * Creates the in-process capability injected only into the Mission Pilot
 * package composition. The factory is intentionally not re-exported by the
 * module index or any HTTP router.
 */
export function createMissionPilotPersistenceCapability(): MissionPilotPersistenceCapability {
	return Object.freeze({
		async execute(request: MissionPilotPersistenceRequest) {
			if (!isMissionPilotPersistenceRequest(request))
				throw new Error("Invalid Mission Pilot persistence operation.");
			const handler = operationHandlers[request.operation] as (
				...args: readonly unknown[]
			) => unknown;
			return await handler(...request.args);
		},
	});
}
