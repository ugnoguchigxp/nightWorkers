import type { QueryClient } from "@tanstack/react-query";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useEffect } from "react";
import { devWsFallbackPath, wsPath } from "../../../lib/api-base";
import { invalidateQuestionnaireSessions } from "../../questionnaire";
import { planModeWorkspaceQueryKey } from "../../specification";
import { NightWorkersRealtimeConnection } from "../realtime/nightWorkersRealtimeConnection";
import { createNightWorkersRealtimeProjector } from "../realtime/nightWorkersRealtimeProjector";
import type { ProjectFileEntry, TaskEvent } from "../types";

type RealtimeStatus =
	| "initializing"
	| "connecting"
	| "connected"
	| "disconnected";

type UseNightWorkersRealtimeInput = {
	activeSessionId: string | null;
	queryClient: QueryClient;
	connectionRef: MutableRefObject<NightWorkersRealtimeConnection | null>;
	latestRunSubscriptionRef: MutableRefObject<{
		runId: string | null;
		afterSeq?: number;
	}>;
	processedRealtimeMessageKeysRef: MutableRefObject<Set<string>>;
	pendingChatRunIdRef: MutableRefObject<string | null>;
	pendingAssistantTaskIdRef: MutableRefObject<string | null>;
	chatSubmitStartedAtRef: MutableRefObject<number | null>;
	setIsRealtimeConnected: Dispatch<SetStateAction<boolean>>;
	setRealtimeStatus: Dispatch<SetStateAction<RealtimeStatus>>;
	setBufferedEventsByRun: Dispatch<SetStateAction<Record<string, TaskEvent[]>>>;
	setStreamingTextByTask: Dispatch<SetStateAction<Record<string, string>>>;
	setIsChatSubmitting: Dispatch<SetStateAction<boolean>>;
	setPendingChatRunId: Dispatch<SetStateAction<string | null>>;
	setPendingAssistantTaskId: Dispatch<SetStateAction<string | null>>;
	setProjectFileEntriesByDirectory: Dispatch<
		SetStateAction<Record<string, ProjectFileEntry[]>>
	>;
};

export function useNightWorkersRealtime(input: UseNightWorkersRealtimeInput) {
	const {
		activeSessionId,
		queryClient,
		connectionRef,
		latestRunSubscriptionRef,
		processedRealtimeMessageKeysRef,
		pendingChatRunIdRef,
		pendingAssistantTaskIdRef,
		chatSubmitStartedAtRef,
		setIsRealtimeConnected,
		setRealtimeStatus,
		setBufferedEventsByRun,
		setStreamingTextByTask,
		setIsChatSubmitting,
		setPendingChatRunId,
		setPendingAssistantTaskId,
		setProjectFileEntriesByDirectory,
	} = input;
	useEffect(() => {
		setRealtimeStatus("connecting");
		const proxyUrl = wsPath("/api/ws/nightworkers");
		const devDirectUrl = devWsFallbackPath("/api/ws/nightworkers");
		const projector = createNightWorkersRealtimeProjector({
			activeSessionId,
			queryClient,
			latestRunSubscriptionRef,
			processedRealtimeMessageKeysRef,
			pendingChatRunIdRef,
			pendingAssistantTaskIdRef,
			chatSubmitStartedAtRef,
			setBufferedEventsByRun,
			setStreamingTextByTask,
			setIsChatSubmitting,
			setPendingChatRunId,
			setPendingAssistantTaskId,
			setProjectFileEntriesByDirectory,
		});
		const connection = new NightWorkersRealtimeConnection({
			primaryUrl: devDirectUrl ?? proxyUrl,
			fallbackUrl: devDirectUrl && devDirectUrl !== proxyUrl ? proxyUrl : null,
			onConnectionStateChange: (connected) => {
				setIsRealtimeConnected(connected);
				setRealtimeStatus(connected ? "connected" : "disconnected");
			},
			onReconnectExhausted: () => setIsChatSubmitting(false),
			onOpen: () => {
				const taskId = activeSessionId;
				if (!taskId) return;
				void queryClient.invalidateQueries({
					queryKey: ["taskMessages", taskId],
				});
				void queryClient.invalidateQueries({
					queryKey: ["taskOperatorView", taskId],
				});
				void queryClient.invalidateQueries({
					queryKey: ["sessionRuns", taskId],
				});
				void queryClient.invalidateQueries({
					queryKey: planModeWorkspaceQueryKey(taskId),
				});
				void invalidateQuestionnaireSessions(queryClient, taskId);
				void queryClient.invalidateQueries({
					queryKey: ["missionPilotControl", taskId],
				});
				void queryClient.invalidateQueries({
					queryKey: ["missionPilotPlanProgress", taskId],
				});
				const subscription = latestRunSubscriptionRef.current;
				connection.send({
					type: "subscribe_task",
					taskId,
					...(subscription.runId ? { runId: subscription.runId } : {}),
					...(typeof subscription.afterSeq === "number"
						? { afterSeq: subscription.afterSeq }
						: {}),
				});
			},
			onMessage: projector,
		});
		connectionRef.current = connection;
		connection.start();

		return () => {
			if (activeSessionId)
				connection.send({
					type: "unsubscribe_task",
					taskId: activeSessionId,
				});
			connection.dispose();
			if (connectionRef.current === connection) connectionRef.current = null;
		};
	}, [
		activeSessionId,
		queryClient,
		connectionRef,
		latestRunSubscriptionRef,
		processedRealtimeMessageKeysRef,
		pendingChatRunIdRef,
		pendingAssistantTaskIdRef,
		chatSubmitStartedAtRef,
		setIsRealtimeConnected,
		setRealtimeStatus,
		setBufferedEventsByRun,
		setStreamingTextByTask,
		setIsChatSubmitting,
		setPendingChatRunId,
		setPendingAssistantTaskId,
		setProjectFileEntriesByDirectory,
	]);
}
