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
import type { MissionPilotAgentPlayHostInput } from "./agent/agent-session.repository";
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

export type MissionPilotPersistenceHostInput = Readonly<{
	prepareAgentPlay(input: {
		sessionId: string;
		taskId: string;
		principal: {
			kind: "human";
			actorId: string;
			authorizationRef: string;
		};
		grantedAt: string;
	}): Promise<MissionPilotAgentPlayHostInput>;
	resolveProviderToolCallActions(input: {
		toolCalls: ReadonlyArray<{
			id: string;
			name: string;
			arguments: Record<string, unknown>;
		}>;
	}): Promise<Readonly<Record<string, string>>>;
}>;

/**
 * Creates the in-process capability injected only into the Mission Pilot
 * package composition. The factory is intentionally not re-exported by the
 * module index or any HTTP router.
 */
export function createMissionPilotPersistenceCapability(
	host: MissionPilotPersistenceHostInput,
): MissionPilotPersistenceCapability {
	return Object.freeze({
		async execute(request: MissionPilotPersistenceRequest) {
			if (!isMissionPilotPersistenceRequest(request))
				throw new Error("Invalid Mission Pilot persistence operation.");
			if (request.operation === "claimAgentPlay") {
				const [taskId, expectedVersion, requestedPrincipal, activation] =
					request.args as [
						string,
						number,
						(
							| {
									kind: "human";
									actorId: string;
									authorizationRef: string;
							  }
							| undefined
						),
						unknown,
					];
				const session = await getSessionByTaskId(taskId);
				if (!session) return null;
				const principal = requestedPrincipal ?? {
					kind: "human" as const,
					actorId: "local-task-operator-user",
					authorizationRef: "local-user",
				};
				const grantedAt = new Date().toISOString();
				const hostInput = await host.prepareAgentPlay({
					sessionId: session.id,
					taskId,
					principal,
					grantedAt,
				});
				return claimAgentPlay(
					taskId,
					expectedVersion,
					principal,
					activation as Parameters<typeof claimAgentPlay>[3],
					hostInput,
				);
			}
			if (request.operation === "persistMissionPilotProviderTurn") {
				const [input] = request.args as [
					Parameters<typeof persistMissionPilotProviderTurn>[0],
				];
				return persistMissionPilotProviderTurn({
					...input,
					resolvedActionIds: await host.resolveProviderToolCallActions({
						toolCalls: input.toolCalls,
					}),
				});
			}
			const handler = operationHandlers[request.operation] as (
				...args: readonly unknown[]
			) => unknown;
			return await handler(...request.args);
		},
	});
}
