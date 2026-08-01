import type { QueryClient } from "@tanstack/react-query";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { codingAgentCommandResponseV1Schema } from "../../../../shared/modules/codingAgent";
import { nightWorkersHostRealtimeMessageSchema } from "../../../../shared/schemas/nightworkers/realtime.schema";
import {
	applyMissionPilotRealtimeExtension,
	parseMissionPilotRealtimeExtension,
} from "../../../composition/mission-pilot";
import { isCodingAgentChatTrace } from "../../codingAgent";
import {
	applyQuestionnaireStateChangedRealtimeMessage,
	invalidateQuestionnaireSessions,
} from "../../questionnaire";
import { planModeWorkspaceQueryKey } from "../../specification";
import { dedupeAndSortActivityEvents } from "../activityTranscript";
import { isPlanModeWorkspaceMessage } from "../hooks/nightWorkersRealtimeModel";
import { shouldCompletePendingChat } from "../realtimeChatCompletion";
import {
	dedupeAndSortRunEvents,
	getRealtimeMessageDedupeKey,
	isTerminalRunStatus,
	mergeRealtimeRunDetails,
	mergeRealtimeRunList,
	mergeRealtimeTodoIntoRunDetails,
	readReviewRunSnapshot,
} from "../realtimeEvents";
import type {
	ActivityEvent,
	ActivityReplay,
	ProjectFileEntry,
	RunDetails,
	Task,
	TaskEvent,
	TaskMessage,
	TaskRun,
	TaskRunTodo,
} from "../types";
import type { NightWorkersRealtimeMessage } from "./nightWorkersRealtimeConnection";

const emptyActivityReplay: ActivityReplay = { events: [], artifacts: [] };

export type ParsedNightWorkersRealtimeMessage =
	| {
			owner: "host";
			message: ReturnType<typeof nightWorkersHostRealtimeMessageSchema.parse>;
	  }
	| {
			owner: "coding_agent";
			message: ReturnType<typeof codingAgentCommandResponseV1Schema.parse>;
	  }
	| { owner: "mission_pilot"; message: unknown };

export function parseNightWorkersRealtimeMessage(
	message: unknown,
): ParsedNightWorkersRealtimeMessage | null {
	const host = nightWorkersHostRealtimeMessageSchema.safeParse(message);
	if (host.success) return { owner: "host", message: host.data };
	const codingAgent = codingAgentCommandResponseV1Schema.safeParse(message);
	if (codingAgent.success)
		return { owner: "coding_agent", message: codingAgent.data };
	const missionPilot = parseMissionPilotRealtimeExtension(message);
	if (missionPilot) return { owner: "mission_pilot", message: missionPilot };
	return null;
}

export type NightWorkersRealtimeProjectorInput = {
	activeSessionId: string | null;
	queryClient: QueryClient;
	latestRunSubscriptionRef: MutableRefObject<{
		runId: string | null;
		afterSeq?: number;
	}>;
	processedRealtimeMessageKeysRef: MutableRefObject<Set<string>>;
	pendingChatRunIdRef: MutableRefObject<string | null>;
	pendingAssistantTaskIdRef: MutableRefObject<string | null>;
	chatSubmitStartedAtRef: MutableRefObject<number | null>;
	setBufferedEventsByRun: Dispatch<SetStateAction<Record<string, TaskEvent[]>>>;
	setStreamingTextByTask: Dispatch<SetStateAction<Record<string, string>>>;
	setIsChatSubmitting: Dispatch<SetStateAction<boolean>>;
	setPendingChatRunId: Dispatch<SetStateAction<string | null>>;
	setPendingAssistantTaskId: Dispatch<SetStateAction<string | null>>;
	setProjectFileEntriesByDirectory: Dispatch<
		SetStateAction<Record<string, ProjectFileEntry[]>>
	>;
};

export function createNightWorkersRealtimeProjector(
	input: NightWorkersRealtimeProjectorInput,
) {
	const latestQuestionnaireRevisionBySession = new Map<
		string,
		{ revision: number; stateDigest: string }
	>();
	return (rawMessage: NightWorkersRealtimeMessage, byteSize: number) => {
		const parsed = parseNightWorkersRealtimeMessage(rawMessage);
		if (!parsed) {
			warnAndReconcileUnknownMessage(input, rawMessage, byteSize);
			return;
		}
		if (parsed.owner === "coding_agent") return;
		if (parsed.owner === "mission_pilot") {
			applyMissionPilotRealtimeExtension(parsed.message, input.queryClient);
			return;
		}
		const msg = parsed.message;
		applyQuestionnaireStateChangedRealtimeMessage({
			message: msg,
			activeTaskId: input.activeSessionId,
			latestRevisionBySession: latestQuestionnaireRevisionBySession,
			queryClient: input.queryClient,
		});
		if (msg.type === "plan_mode.routing_changed") {
			if (msg.taskId === input.activeSessionId)
				void input.queryClient.invalidateQueries({
					queryKey: planModeWorkspaceQueryKey(msg.taskId),
				});
			return;
		}
		if (msg.type === "activity_event_created") {
			projectActivityEvent(input, msg.payload.event);
			return;
		}
		if (msg.type === "task_llm_delta") {
			projectLlmDelta(input, msg);
			return;
		}
		if (msg.type === "task_event_created") {
			projectTaskEvent(input, msg);
			return;
		}
		if (msg.type === "task_message_created") {
			projectTaskMessage(input, msg.payload.message as TaskMessage);
			return;
		}
		if (msg.type === "error") {
			projectError(input, msg.message);
			return;
		}
		if (msg.type === "task_run_updated") {
			if (msg.payload.run) projectTaskRun(input, msg.payload.run);
			if (msg.payload.todo) projectTaskTodo(input, msg.payload.todo);
			for (const todo of msg.payload.todos ?? []) projectTaskTodo(input, todo);
			return;
		}
		if (msg.type === "task_status_updated") {
			projectTaskStatus(input, msg.payload.task);
		}
	};
}

function projectActivityEvent(
	input: NightWorkersRealtimeProjectorInput,
	incoming: ActivityEvent,
) {
	if (input.activeSessionId && incoming.taskId !== input.activeSessionId)
		return;
	if (!isCodingAgentChatTrace(incoming)) {
		if (incoming.kind === "llm.usage")
			void input.queryClient.invalidateQueries({
				queryKey: ["llmUsage", incoming.taskId],
			});
		return;
	}
	input.queryClient.setQueryData<ActivityReplay>(
		["activityReplay", incoming.taskId],
		(previous = emptyActivityReplay) => ({
			...previous,
			events: dedupeAndSortActivityEvents([...previous.events, incoming]),
		}),
	);
	if (incoming.artifactId)
		void input.queryClient.invalidateQueries({
			queryKey: ["activityReplay", incoming.taskId],
		});
	if (incoming.kind === "llm.usage")
		void input.queryClient.invalidateQueries({
			queryKey: ["llmUsage", incoming.taskId],
		});
}

function projectLlmDelta(
	input: NightWorkersRealtimeProjectorInput,
	msg: Extract<
		ReturnType<typeof nightWorkersHostRealtimeMessageSchema.parse>,
		{ type: "task_llm_delta" }
	>,
) {
	if (!input.activeSessionId || msg.taskId !== input.activeSessionId) return;
	const messageKey = getRealtimeMessageDedupeKey(msg);
	if (messageKey) {
		if (input.processedRealtimeMessageKeysRef.current.has(messageKey)) return;
		input.processedRealtimeMessageKeysRef.current.add(messageKey);
		if (input.processedRealtimeMessageKeysRef.current.size > 5000) {
			input.processedRealtimeMessageKeysRef.current.clear();
			input.processedRealtimeMessageKeysRef.current.add(messageKey);
		}
	}
	input.setStreamingTextByTask((previous) => ({
		...previous,
		[msg.taskId]: `${previous[msg.taskId] || ""}${msg.payload.text}`,
	}));
}

function projectTaskEvent(
	input: NightWorkersRealtimeProjectorInput,
	msg: Extract<
		ReturnType<typeof nightWorkersHostRealtimeMessageSchema.parse>,
		{ type: "task_event_created" }
	>,
) {
	const eventPayload = { ...msg.event, runId: msg.runId } as TaskEvent;
	input.setBufferedEventsByRun((previous) => ({
		...previous,
		[msg.runId]: dedupeAndSortRunEvents([
			...(previous[msg.runId] || []),
			eventPayload,
		]),
	}));
	const subscription = input.latestRunSubscriptionRef.current;
	if (subscription.runId === msg.runId) {
		subscription.afterSeq = Math.max(subscription.afterSeq ?? 0, msg.event.seq);
	}
	void input.queryClient.invalidateQueries({
		queryKey: ["runDetails", msg.runId],
	});
	const eventType = String(eventPayload.type || eventPayload.eventType || "");
	const eventTaskId =
		(eventPayload as { taskId?: string }).taskId || input.activeSessionId;
	if (eventType.startsWith("review.") && eventTaskId) {
		void input.queryClient.invalidateQueries({
			queryKey: ["reviewSession", eventTaskId],
		});
		void input.queryClient.invalidateQueries({
			queryKey: ["gitCloseout", msg.runId],
		});
	}
	if (eventType.startsWith("git.closeout")) {
		void input.queryClient.invalidateQueries({
			queryKey: ["gitCloseout", msg.runId],
		});
		void input.queryClient.invalidateQueries({
			queryKey: ["implementationQueue"],
		});
		if (eventTaskId)
			void input.queryClient.invalidateQueries({
				queryKey: ["sessionRuns", eventTaskId],
			});
	}
}

function projectTaskMessage(
	input: NightWorkersRealtimeProjectorInput,
	incoming: TaskMessage,
) {
	void input.queryClient.invalidateQueries({
		queryKey: ["evidenceCheck", "latest", incoming.taskId],
	});
	void input.queryClient.invalidateQueries({
		queryKey: ["llmUsage", incoming.taskId],
	});
	if (isPlanModeWorkspaceMessage(incoming))
		void input.queryClient.invalidateQueries({
			queryKey: planModeWorkspaceQueryKey(incoming.taskId),
		});
	input.queryClient.setQueryData<TaskMessage[]>(
		["taskMessages", incoming.taskId],
		(previous = []) => {
			const withoutOptimistic =
				incoming.role === "user"
					? previous.filter(
							(message) =>
								!(
									message.id.startsWith("optimistic-") &&
									message.role === "user" &&
									message.content === incoming.content
								),
						)
					: previous;
			return withoutOptimistic.some((message) => message.id === incoming.id)
				? withoutOptimistic
				: [...withoutOptimistic, incoming];
		},
	);
	if (
		shouldCompletePendingChat({
			message: incoming,
			pendingTaskId: input.pendingAssistantTaskIdRef.current,
			pendingRunId: input.pendingChatRunIdRef.current,
		})
	) {
		input.setStreamingTextByTask((previous) => {
			const next = { ...previous };
			delete next[incoming.taskId];
			return next;
		});
		input.setIsChatSubmitting(false);
		input.chatSubmitStartedAtRef.current = null;
		input.pendingChatRunIdRef.current = null;
		input.setPendingChatRunId(null);
		input.pendingAssistantTaskIdRef.current = null;
		input.setPendingAssistantTaskId(null);
	}
}

function projectError(
	input: NightWorkersRealtimeProjectorInput,
	message: string,
) {
	input.setIsChatSubmitting(false);
	input.chatSubmitStartedAtRef.current = null;
	input.pendingChatRunIdRef.current = null;
	input.setPendingChatRunId(null);
	input.pendingAssistantTaskIdRef.current = null;
	input.setPendingAssistantTaskId(null);
	if (!input.activeSessionId) return;
	const errorMessage: TaskMessage = {
		id: `chat-error-${Date.now()}`,
		taskId: input.activeSessionId,
		role: "system",
		content: message || "送信に失敗しました。接続状態を確認してください。",
		messageType: "text",
		traceOwner: "system",
		traceChannel: "chat",
		createdAt: new Date().toISOString(),
	};
	input.queryClient.setQueryData<TaskMessage[]>(
		["taskMessages", input.activeSessionId],
		(previous = []) => [...previous, errorMessage],
	);
}

function projectTaskRun(
	input: NightWorkersRealtimeProjectorInput,
	incomingRun: TaskRun,
) {
	void input.queryClient.invalidateQueries({ queryKey: ["evidenceCheck"] });
	void input.queryClient.invalidateQueries({
		queryKey: ["llmUsage", incomingRun.taskId],
	});
	input.queryClient.setQueryData<TaskRun[]>(
		["sessionRuns", incomingRun.taskId],
		(previous = []) => mergeRealtimeRunList(previous, incomingRun),
	);
	input.queryClient.setQueryData<RunDetails | null>(
		["runDetails", incomingRun.id],
		(previous) => mergeRealtimeRunDetails(previous, incomingRun) ?? previous,
	);
	void input.queryClient.invalidateQueries({
		queryKey: ["runDetails", incomingRun.id],
	});
	void input.queryClient.invalidateQueries({
		queryKey: ["implementationQueue"],
	});
	if (isTerminalRunStatus(incomingRun.status) && incomingRun.repositoryId) {
		input.setProjectFileEntriesByDirectory({});
		void input.queryClient.invalidateQueries({
			queryKey: ["projectFiles", incomingRun.repositoryId],
		});
		input.queryClient.removeQueries({
			queryKey: ["projectFile", incomingRun.repositoryId],
		});
	}
	if (!isTerminalRunStatus(incomingRun.status)) return;
	const reviewRun = readReviewRunSnapshot(incomingRun.contextSnapshot);
	if (reviewRun?.reviewSessionId)
		void input.queryClient.invalidateQueries({
			queryKey: ["reviewSession", incomingRun.taskId],
		});
	if (reviewRun?.reviewedRunId)
		void input.queryClient.invalidateQueries({
			queryKey: ["gitCloseout", reviewRun.reviewedRunId],
		});
}

function projectTaskTodo(
	input: NightWorkersRealtimeProjectorInput,
	incomingTodo: TaskRunTodo,
) {
	input.queryClient.setQueryData<RunDetails | null>(
		["runDetails", incomingTodo.runId],
		(previous) =>
			mergeRealtimeTodoIntoRunDetails(previous, incomingTodo) ?? previous,
	);
}

function projectTaskStatus(
	input: NightWorkersRealtimeProjectorInput,
	incomingTask: Task,
) {
	input.queryClient.setQueryData<Task[]>(["sessions"], (previous = []) => {
		const next = [...previous];
		const index = next.findIndex((task) => task.id === incomingTask.id);
		if (index >= 0) next[index] = incomingTask;
		else next.unshift(incomingTask);
		return next;
	});
	void input.queryClient.invalidateQueries({
		queryKey: ["implementationQueue"],
	});
	void input.queryClient.invalidateQueries({
		queryKey: ["taskOperatorView", incomingTask.id],
	});
}

function warnAndReconcileUnknownMessage(
	input: NightWorkersRealtimeProjectorInput,
	message: NightWorkersRealtimeMessage,
	byteSize: number,
) {
	console.warn("Unknown or malformed NightWorkers realtime message", {
		type: typeof message.type === "string" ? message.type : null,
		byteSize,
	});
	const taskId = input.activeSessionId;
	if (!taskId) return;
	void input.queryClient.invalidateQueries({
		queryKey: ["taskOperatorView", taskId],
	});
	void input.queryClient.invalidateQueries({
		queryKey: ["taskMessages", taskId],
	});
	void input.queryClient.invalidateQueries({
		queryKey: ["sessionRuns", taskId],
	});
	const runId = input.latestRunSubscriptionRef.current.runId;
	if (runId)
		void input.queryClient.invalidateQueries({
			queryKey: ["runDetails", runId],
		});
	void invalidateQuestionnaireSessions(input.queryClient, taskId);
	void input.queryClient.invalidateQueries({
		queryKey: planModeWorkspaceQueryKey(taskId),
	});
	void input.queryClient.invalidateQueries({
		queryKey: ["missionPilotControl", taskId],
	});
	void input.queryClient.invalidateQueries({
		queryKey: ["missionPilotPlanProgress", taskId],
	});
}
