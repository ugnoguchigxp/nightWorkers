import { registerQuestionnaireStateChangedListener } from "../questionnaire/questionnaire-events";
import { registerTaskMessageCreatedListener } from "../task";
import {
	humanTaskOperatorPrincipal,
	humanTaskOperatorQueryContext,
	initializeTaskOperatorExecutionEvents,
	readTaskOperatorProjection,
	readTaskOperatorResource,
	registerTaskOperatorExecutionEventListener,
} from "../taskOperator";
import { markMissionPilotAgentTaskActive } from "./agent/mission-pilot-agent-active-registry";
import {
	cancelPendingMissionPilotToolCalls,
	cancelRunningMissionPilotToolCalls,
} from "./agent/mission-pilot-agent-lifecycle.repository";
import {
	isMissionPilotAgentRuntimeActive,
	reconcileInterruptedMissionPilotAgentSessions,
	stopMissionPilotAgentRuntime,
} from "./agent/mission-pilot-agent-runtime";
import {
	backfillStoppedMissionPilotAgentSessions,
	claimAgentPlay,
	claimAgentStop,
	completeAgentInitialPromptDispatch,
	getMissionPilotSessionById,
	isMissionPilotAgentSession,
	listPlayingAgentSessions,
} from "./agent/mission-pilot-agent-session.repository";
import {
	cancelScheduledMissionPilotAgentWake,
	scheduleMissionPilotAgentWake,
} from "./agent/mission-pilot-agent-wake.service";
import { preflightMissionPilotProviderToolTurn } from "./agent/mission-pilot-provider.port";
import {
	recordMissionPilotQuestionnaireStateChanged,
	recordMissionPilotTaskEvent,
} from "./agent/mission-pilot-task-event.adapter";
import {
	appendMissionPilotTaskEvent,
	projectMissionPilotExecutionEvent,
} from "./agent/mission-pilot-task-event.repository";
import { MissionPilotError } from "./mission-pilot.errors";
import * as repo from "./mission-pilot.repository";
import { createMissionPilotTaskOperatorAccess } from "./mission-pilot-delegation";
import { dispatchMissionPilotInitialPrompt } from "./mission-pilot-initial-prompt.service";
import { publishMissionPilotUpdated } from "./mission-pilot-realtime";
import { buildMissionPilotSystemContext } from "./prompts/mission-pilot-system-context";

let runSyncRegistered = false;

export function initializeMissionPilotRunSync() {
	if (runSyncRegistered) return;
	runSyncRegistered = true;
	initializeTaskOperatorExecutionEvents();
	registerTaskOperatorExecutionEventListener(async (event) => {
		const session = await repo.getSessionByTaskId(event.taskRef.id);
		if (
			session?.desiredState !== "playing" ||
			!(await isMissionPilotAgentSession(session.id))
		)
			return;
		const projected = await projectMissionPilotExecutionEvent({
			taskId: event.taskRef.id,
			type: event.type,
			runId: event.resourceRef.id,
		});
		if (projected)
			publishMissionPilotUpdated(
				event.taskRef.id,
				repo.toControlSummary(projected),
			);
		if (event.type === "task.run.started") return;
		await appendMissionPilotTaskEvent({
			taskId: event.taskRef.id,
			eventType:
				event.type === "task.run.failed"
					? "task_run.failed"
					: "task_run.terminal",
			sourceEventId: event.eventId,
			taskRevision: event.taskRef.revision,
			payload: {
				runId: event.resourceRef.id,
				runRevision: event.resourceRef.revision,
				status: event.status,
				occurredAt: event.occurredAt,
			},
		});
		scheduleMissionPilotAgentWake({ sessionId: session.id });
	});
}

initializeMissionPilotRunSync();

let agentTaskMessageCreatedRegistered = false;
function initializeMissionPilotAgentTaskMessageEvents() {
	if (agentTaskMessageCreatedRegistered) return;
	agentTaskMessageCreatedRegistered = true;
	registerTaskMessageCreatedListener(async (message) => {
		if (message.role !== "user") return;
		const metadata =
			message.metadataJson &&
			typeof message.metadataJson === "object" &&
			!Array.isArray(message.metadataJson)
				? (message.metadataJson as Record<string, unknown>)
				: {};
		const session = await repo.getSessionByTaskId(message.taskId);
		if (
			session?.desiredState !== "playing" ||
			!(await isMissionPilotAgentSession(session.id))
		)
			return;
		if (
			metadata.source === "mission_pilot" ||
			isDelegatedUserMessageFromSession(metadata, session.id)
		)
			return;
		const access = await createMissionPilotTaskOperatorAccess({
			sessionId: session.id,
			taskId: message.taskId,
		});
		const projection = await readTaskOperatorProjection(
			message.taskId,
			access.context,
			access.delegatedAuthorization,
		);
		await recordMissionPilotTaskEvent({
			taskId: message.taskId,
			type: "task.user_message_added",
			sourceEventId: `task-message:${message.id}`,
			taskRevision: projection.task.revision,
			payload: { messageId: message.id, content: message.content },
		});
	});
}
initializeMissionPilotAgentTaskMessageEvents();

function isDelegatedUserMessageFromSession(
	metadata: Record<string, unknown>,
	sessionId: string,
) {
	const actor =
		metadata.actor &&
		typeof metadata.actor === "object" &&
		!Array.isArray(metadata.actor)
			? (metadata.actor as Record<string, unknown>)
			: {};
	return actor.kind === "delegated_user" && actor.actorId === sessionId;
}

let agentQuestionnaireEventsRegistered = false;
export function initializeMissionPilotAgentQuestionnaireEvents() {
	if (agentQuestionnaireEventsRegistered) return;
	agentQuestionnaireEventsRegistered = true;
	registerQuestionnaireStateChangedListener(async (questionnaire) => {
		await recordMissionPilotQuestionnaireStateChanged(questionnaire);
	});
}
initializeMissionPilotAgentQuestionnaireEvents();

export async function reconcileMissionPilotStartup() {
	const migrated = await backfillStoppedMissionPilotAgentSessions();
	const interruptedAgentSessions =
		await reconcileInterruptedMissionPilotAgentSessions();
	for (const session of interruptedAgentSessions) {
		if (session.desiredState === "playing") {
			await appendMissionPilotTaskEvent({
				taskId: session.taskId,
				eventType: "mission_pilot.resume_requested",
				sourceEventId: `startup-resume:${session.id}:${session.version}`,
				taskRevision: session.version,
				payload: { reason: "process_restart" },
			});
			scheduleMissionPilotAgentWake({ sessionId: session.id });
		}
	}
	for (const { session } of await listPlayingAgentSessions()) {
		markMissionPilotAgentTaskActive(session.taskId);
		scheduleMissionPilotAgentWake({ sessionId: session.id });
	}
	return migrated + interruptedAgentSessions.length;
}

export async function play(
	taskId: string,
	expectedVersion: number,
	options: {
		providerPreflight?: typeof preflightMissionPilotProviderToolTurn;
	} = {},
) {
	const session = await repo.getSessionByTaskId(taskId);
	if (!session)
		throw new MissionPilotError(
			404,
			"MISSION_PILOT_NOT_FOUND",
			"Mission Pilot session not found",
		);
	if (!(await isMissionPilotAgentSession(session.id)))
		throw new MissionPilotError(
			409,
			"MISSION_PILOT_AGENT_MIGRATION_REQUIRED",
			"Mission Pilot agent migration has not completed",
		);
	const projection = await readTaskOperatorProjection(
		taskId,
		humanTaskOperatorQueryContext(),
	);
	const [taskGoal, acceptanceCriteria] = await Promise.all([
		readCompleteTaskText(taskId, "objective"),
		readCompleteTaskText(taskId, "acceptance_criteria"),
	]);
	if (
		taskGoal.sourceRevision !== projection.task.revision ||
		acceptanceCriteria.sourceRevision !== projection.task.revision
	)
		throw new MissionPilotError(
			409,
			"MISSION_PILOT_VERSION_CONFLICT",
			"Task changed while Mission Pilot was reading the Task Goal; refresh and retry",
		);
	if (!taskGoal.text.trim())
		throw new MissionPilotError(
			400,
			"MISSION_PILOT_INITIAL_PROMPT_REQUIRED",
			"Mission Pilot requires a non-empty Task Goal",
		);
	const providerPreflight = (
		options.providerPreflight ?? preflightMissionPilotProviderToolTurn
	)();
	if (!providerPreflight.ok)
		throw new MissionPilotError(
			422,
			providerPreflight.code,
			providerPreflight.message,
		);
	return playAgentSession(
		session.id,
		taskId,
		expectedVersion,
		projection.task.revision,
		taskGoal.text,
		acceptanceCriteria.text || null,
	);
}

async function readCompleteTaskText(
	taskId: string,
	field: "objective" | "acceptance_criteria",
) {
	let cursor: number | undefined;
	let sourceDigest: string | null = null;
	let sourceRevision: number | null = null;
	let text = "";
	for (let pageCount = 0; pageCount < 64; pageCount += 1) {
		const page = await readTaskOperatorResource({
			taskId,
			resourceKind: "task_text",
			resourceId: field,
			cursor,
			context: humanTaskOperatorQueryContext(),
		});
		if (
			(sourceDigest !== null && page.sourceDigest !== sourceDigest) ||
			(sourceRevision !== null && page.sourceRevision !== sourceRevision)
		)
			throw new MissionPilotError(
				409,
				"MISSION_PILOT_TASK_TEXT_CHANGED",
				"Task text changed while it was being paged; refresh and retry",
			);
		sourceDigest = page.sourceDigest;
		sourceRevision = page.sourceRevision;
		const content = page.content as { text?: unknown };
		if (typeof content.text !== "string")
			throw new MissionPilotError(
				500,
				"MISSION_PILOT_TASK_TEXT_INVALID",
				"Task Operator returned an invalid task text page",
			);
		text += content.text;
		if (page.nextCursor === null)
			return { text, sourceRevision: sourceRevision ?? 0 };
		cursor = page.nextCursor;
	}
	throw new MissionPilotError(
		413,
		"MISSION_PILOT_TASK_TEXT_TOO_LARGE",
		"Task text exceeds the Mission Pilot activation paging limit",
	);
}

export async function stop(taskId: string, expectedVersion: number) {
	const current = await repo.getSessionByTaskId(taskId);
	if (!current)
		throw new MissionPilotError(
			404,
			"MISSION_PILOT_NOT_FOUND",
			"Mission Pilot session not found",
		);
	if (!(await isMissionPilotAgentSession(current.id)))
		throw new MissionPilotError(
			409,
			"MISSION_PILOT_AGENT_MIGRATION_REQUIRED",
			"Mission Pilot agent migration has not completed",
		);
	if (
		current.desiredState === "stopped" &&
		!isMissionPilotAgentRuntimeActive(current.id) &&
		current.lastErrorCode !== "MISSION_PILOT_RUNTIME_STOP_TIMEOUT"
	)
		return { missionPilot: repo.toControlSummary(current), stoppedRun: null };
	const claimed = await claimAgentStop(taskId, expectedVersion);
	if (!claimed)
		throw new MissionPilotError(
			409,
			"MISSION_PILOT_VERSION_CONFLICT",
			"Mission Pilot state changed; refresh and retry",
		);
	publishMissionPilotUpdated(taskId, repo.toControlSummary(claimed));
	const runtimeStop = stopMissionPilotAgentRuntime(claimed.id);
	await cancelScheduledMissionPilotAgentWake(claimed.id);
	const runtimeStopResult = await runtimeStop;
	await cancelPendingMissionPilotToolCalls(claimed.id);
	if (runtimeStopResult.quiesced)
		await cancelRunningMissionPilotToolCalls(claimed.id);
	const stopError = runtimeStopResult.quiesced
		? undefined
		: "Mission Pilot runtime did not acknowledge the stop request in time.";
	const stopErrorCode = runtimeStopResult.quiesced
		? undefined
		: "MISSION_PILOT_RUNTIME_STOP_TIMEOUT";
	const finished = await repo.finishStop(
		taskId,
		claimed.version,
		stopError,
		null,
		stopErrorCode,
	);
	if (!finished)
		throw new MissionPilotError(
			409,
			"MISSION_PILOT_VERSION_CONFLICT",
			"Mission Pilot state changed while finalizing Stop; refresh and retry",
		);
	const missionPilot = repo.toControlSummary(finished);
	publishMissionPilotUpdated(taskId, missionPilot);
	return { missionPilot, stoppedRun: null };
}

async function playAgentSession(
	sessionId: string,
	taskId: string,
	expectedVersion: number,
	taskRevision: number,
	taskGoal: string,
	acceptanceCriteria: string | null,
) {
	const claimed = await claimAgentPlay(
		taskId,
		expectedVersion,
		humanTaskOperatorPrincipal(),
		{
			systemContext: (authorization) =>
				buildMissionPilotSystemContext({
					authorization,
					pushPolicy: authorization.pushPolicy,
				}),
			initialPrompt: taskGoal,
			acceptanceCriteria,
			taskRevision,
			sourceEventId: `play:${sessionId}:${expectedVersion + 1}`,
		},
	);
	if (!claimed)
		throw new MissionPilotError(
			409,
			"MISSION_PILOT_VERSION_CONFLICT",
			"Mission Pilot state changed; refresh and retry",
		);
	let initialPromptDispatch: Awaited<
		ReturnType<typeof dispatchMissionPilotInitialPrompt>
	> | null = null;
	if (claimed.initialPromptState === "dispatching") {
		try {
			initialPromptDispatch = await dispatchMissionPilotInitialPrompt({
				sessionId,
				taskId,
				taskRevision,
				initialPrompt: taskGoal,
			});
			const completed = await completeAgentInitialPromptDispatch({
				taskId,
				expectedVersion: claimed.version,
				messageId: initialPromptDispatch.initialPromptMessageId,
				activeRunId: null,
				phase: "initial_intake",
			});
			if (!completed)
				throw new MissionPilotError(
					409,
					"MISSION_PILOT_VERSION_CONFLICT",
					"Mission Pilot state changed while dispatching the initial prompt",
				);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const stopped = await claimAgentStop(taskId, claimed.version);
			if (stopped)
				await repo.finishStop(
					taskId,
					stopped.version,
					message,
					null,
					"MISSION_PILOT_INITIAL_PROMPT_DISPATCH_FAILED",
					"failed",
				);
			const current = await repo.getSessionByTaskId(taskId);
			if (current)
				publishMissionPilotUpdated(taskId, repo.toControlSummary(current));
			if (error instanceof MissionPilotError) throw error;
			throw new MissionPilotError(
				502,
				"MISSION_PILOT_INITIAL_PROMPT_DISPATCH_FAILED",
				message,
			);
		}
	}
	if (claimed.initialPromptState !== "dispatching")
		scheduleMissionPilotAgentWake({ sessionId: claimed.id });
	const current = (await getMissionPilotSessionById(claimed.id)) ?? claimed;
	const missionPilot = repo.toControlSummary(current);
	publishMissionPilotUpdated(taskId, missionPilot);
	return { missionPilot, run: null, messages: [] };
}

export async function listTasksWithMissionPilot<T extends { id: string }>(
	tasks: readonly T[],
) {
	const summaries = await repo.listSessionSummariesByTaskIds(
		tasks.map((task) => task.id),
	);
	return tasks.map((task) => {
		const missionPilot = summaries.get(task.id);
		if (!missionPilot) {
			throw new MissionPilotError(
				500,
				"MISSION_PILOT_INTEGRITY_ERROR",
				`Task ${task.id} is missing its Mission Pilot session`,
			);
		}
		return { ...task, missionPilot };
	});
}
