import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { client } from "../../../lib/api";
import { planModeWorkspaceQueryOptions } from "../../specification";
import { fetchTaskOperatorProjection } from "../../taskOperator";
import {
	fetchBackgroundProcessesForTask,
	fetchImplementationQueue,
	fetchLatestTaskReviewSession,
	fetchRunGitCloseout,
	fetchTaskActivityEvents,
	fetchTaskLlmUsage,
	fetchTaskMessages,
} from "../nightWorkersCommands";
import { mergeRunEvents } from "../realtimeEvents";
import type {
	BackgroundProcess,
	GitCloseoutState,
	ImplementationQueueDashboard,
	Repository,
	ReviewSessionDetail,
	RunDetails,
	Task,
	TaskEvent,
	TaskLlmUsageSummary,
	TaskMessage,
	TaskRun,
} from "../types";
import { createNightWorkersChatActions } from "./nightWorkersChatActions";
import type {
	NightWorkersWorkspaceState,
	RealtimeStatus,
} from "./nightWorkersWorkspaceState";
import { overlayTaskOperatorSession } from "./taskOperatorSessionProjection";
import { useLatestRunSubscription } from "./useLatestRunSubscription";
import { useNightWorkersMutations } from "./useNightWorkersMutations";
import { useNightWorkersProjectFiles } from "./useNightWorkersProjectFiles";
import { useNightWorkersRealtime } from "./useNightWorkersRealtime";
import { useNightWorkersSessionPresentation } from "./useNightWorkersSessionPresentation";
import { useNightWorkersSettings } from "./useNightWorkersSettings";

export type {
	NightWorkersWorkspaceState,
	ProjectSessionGroups,
} from "./nightWorkersWorkspaceState";

import {
	emptyActivityReplay,
	isActiveRunStatus,
	isActiveTaskStatus,
	isMissionPilotChatPending,
	normalizeActivityReplay,
	resolveNextActiveSessionId,
} from "./useNightWorkersWorkspaceModel";

export {
	isMissionPilotChatPending,
	resolveNextActiveSessionId,
} from "./useNightWorkersWorkspaceModel";

export function useNightWorkersWorkspace(): NightWorkersWorkspaceState {
	const queryClient = useQueryClient();
	const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
	const [expandedProjects, setExpandedProjects] = useState<
		Record<string, boolean>
	>({});
	const [isRealtimeConnected, setIsRealtimeConnected] = useState(false);
	const [realtimeStatus, setRealtimeStatus] =
		useState<RealtimeStatus>("initializing");
	const [isChatSubmitting, setIsChatSubmitting] = useState(false);
	const [pendingChatRunId, setPendingChatRunId] = useState<string | null>(null);
	const [pendingAssistantTaskId, setPendingAssistantTaskId] = useState<
		string | null
	>(null);
	const wsRef = useRef<WebSocket | null>(null);
	const lastSubmitRef = useRef<{
		taskId: string;
		prompt: string;
		contextKey: string;
		at: number;
	} | null>(null);
	const pendingChatQueueRef = useRef<Array<{ taskId: string; prompt: string }>>(
		[],
	);
	const chatSubmitStartedAtRef = useRef<number | null>(null);
	const chatSubmitTransportRef = useRef<"http" | "websocket" | null>(null);
	const pendingChatRunIdRef = useRef<string | null>(null);
	const pendingAssistantTaskIdRef = useRef<string | null>(null);
	const pendingChatAbortControllerRef = useRef<AbortController | null>(null);
	const processedRealtimeMessageKeysRef = useRef<Set<string>>(new Set());
	const latestRunSubscriptionRef = useRef<{
		runId: string | null;
		afterSeq?: number;
	}>({
		runId: null,
	});
	const [realtimeEvents, setRealtimeEvents] = useState<TaskEvent[]>([]);
	const [bufferedEventsByRun, setBufferedEventsByRun] = useState<
		Record<string, TaskEvent[]>
	>({});
	const [streamingTextByTask, setStreamingTextByTask] = useState<
		Record<string, string>
	>({});

	const {
		data: projects = [],
		isLoading: isProjectsLoading,
		isFetching: isProjectsFetching,
		refetch: refetchProjects,
	} = useQuery({
		queryKey: ["projects"],
		queryFn: async () => {
			const res = await client.repositories.$get();
			if (!res.ok) throw new Error("Failed to fetch projects");
			return (await res.json()) as Repository[];
		},
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});

	const {
		data: sessions = [],
		isLoading: isSessionsLoading,
		isFetching: isSessionsFetching,
		refetch: refetchSessions,
	} = useQuery({
		queryKey: ["sessions"],
		queryFn: async () => {
			const res = await client.tasks.$get();
			if (!res.ok) throw new Error("Failed to fetch sessions");
			return (await res.json()) as Task[];
		},
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});

	const { data: implementationQueue = null } = useQuery({
		queryKey: ["implementationQueue"],
		queryFn: async () => {
			const res = await fetchImplementationQueue();
			if (!res.ok) throw new Error("Failed to fetch implementation queue");
			return (await res.json()) as ImplementationQueueDashboard;
		},
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});

	const { data: activeSessionRuns = [] } = useQuery({
		queryKey: ["sessionRuns", activeSessionId],
		queryFn: async () => {
			if (!activeSessionId) return [];
			const res = await client.tasks[":id"].runs.$get({
				param: { id: activeSessionId },
			});
			if (!res.ok) throw new Error("Failed to fetch session runs");
			return (await res.json()) as TaskRun[];
		},
		enabled: !!activeSessionId,
		refetchInterval: false,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});
	const latestRun = activeSessionRuns[0];
	const { data: activeGitCloseout = null } = useQuery({
		queryKey: ["gitCloseout", latestRun?.id],
		queryFn: async () => {
			if (!latestRun?.id) return null;
			const res = await fetchRunGitCloseout(latestRun.id);
			if (!res.ok) throw new Error("Failed to fetch Git closeout state");
			return (await res.json()) as GitCloseoutState;
		},
		enabled: !!latestRun?.id,
		refetchInterval: false,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});
	const { data: taskMessages = [] } = useQuery({
		queryKey: ["taskMessages", activeSessionId],
		queryFn: async () => {
			if (!activeSessionId) return [];
			const res = await fetchTaskMessages(activeSessionId);
			if (!res.ok) throw new Error("Failed to fetch task messages");
			return (await res.json()) as TaskMessage[];
		},
		enabled: !!activeSessionId,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});
	const { data: activeTaskOperatorView = null } = useQuery({
		queryKey: ["taskOperatorView", activeSessionId],
		queryFn: async () =>
			activeSessionId
				? fetchTaskOperatorProjection(activeSessionId)
				: Promise.resolve(null),
		enabled: !!activeSessionId,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});

	const { data: activePlanModeWorkspace = null } = useQuery(
		planModeWorkspaceQueryOptions(activeSessionId),
	);

	const { data: llmUsageSummary = null } = useQuery({
		queryKey: ["llmUsage", activeSessionId],
		queryFn: async () => {
			if (!activeSessionId) return null;
			const res = await fetchTaskLlmUsage(activeSessionId);
			if (!res.ok) throw new Error("Failed to fetch LLM usage summary");
			return (await res.json()) as TaskLlmUsageSummary;
		},
		enabled: !!activeSessionId,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});

	const { data: activityReplay = emptyActivityReplay } = useQuery({
		queryKey: ["activityReplay", activeSessionId],
		queryFn: async () => {
			if (!activeSessionId) return emptyActivityReplay;
			const res = await fetchTaskActivityEvents(activeSessionId);
			if (!res.ok) throw new Error("Failed to fetch activity events");
			return normalizeActivityReplay(await res.json());
		},
		enabled: !!activeSessionId,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});
	const activityEvents = activityReplay.events;
	const activityArtifacts = activityReplay.artifacts;

	const { data: activeReviewSession = null } = useQuery({
		queryKey: ["reviewSession", activeSessionId],
		queryFn: async () => {
			if (!activeSessionId) return null;
			const res = await fetchLatestTaskReviewSession(activeSessionId);
			if (!res.ok) throw new Error("Failed to fetch Review Mode session");
			return (await res.json()) as ReviewSessionDetail | null;
		},
		enabled: !!activeSessionId,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});

	const { data: backgroundProcesses = [] } = useQuery({
		queryKey: ["backgroundProcesses", activeSessionId],
		queryFn: async () => {
			if (!activeSessionId) return [];
			const res = await fetchBackgroundProcessesForTask(activeSessionId);
			if (!res.ok) throw new Error("Failed to fetch background processes");
			return (await res.json()) as BackgroundProcess[];
		},
		enabled: !!activeSessionId,
		refetchInterval: false,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});

	const settingsState = useNightWorkersSettings();
	const chatActions = createNightWorkersChatActions({
		queryClient,
		wsRef,
		lastSubmitRef,
		pendingChatQueueRef,
		chatSubmitStartedAtRef,
		chatSubmitTransportRef,
		pendingChatRunIdRef,
		pendingAssistantTaskIdRef,
		pendingChatAbortControllerRef,
		setIsChatSubmitting,
		setPendingChatRunId,
		setPendingAssistantTaskId,
	});

	useEffect(() => {
		const nextActiveSessionId = resolveNextActiveSessionId(
			activeSessionId,
			sessions,
		);
		if (nextActiveSessionId !== activeSessionId)
			setActiveSessionId(nextActiveSessionId);
	}, [activeSessionId, sessions]);

	const {
		createProjectMutation,
		deleteProjectMutation,
		updateProjectMutation,
		createSessionMutation,
		deleteSessionMutation,
		startRunMutation,
		stopRunMutation,
		resumeTodoMutation,
		stopBackgroundProcessMutation,
		queueSessionMutation,
		commitRunGitCloseoutMutation,
		pushRunGitCloseoutMutation,
		updateSessionStatusMutation,
		archiveCompletedSessionMutation,
		restoreArchivedSessionMutation,
		reorderQueueSessionsMutation,
		moveWorkbenchSessionMutation,
	} = useNightWorkersMutations({
		activeSessionId,
		queryClient,
		setActiveSessionId,
	});

	const activeSession = useMemo(() => {
		const session = sessions.find(
			(candidate) => candidate.id === activeSessionId,
		);
		return overlayTaskOperatorSession(session ?? null, activeTaskOperatorView);
	}, [activeSessionId, activeTaskOperatorView, sessions]);
	const activeProject = useMemo(
		() =>
			activeSession
				? (projects.find((p) => p.id === activeSession.repositoryId) ?? null)
				: (projects[0] ?? null),
		[activeSession, projects],
	);
	const activeProjectId = activeProject?.id;

	const projectFilesState = useNightWorkersProjectFiles(
		activeProjectId,
		latestRun?.id,
	);
	const { setProjectFileEntriesByDirectory } = projectFilesState;

	const { data: latestRunDetails = null } = useQuery({
		queryKey: ["runDetails", latestRun?.id],
		queryFn: async () => {
			if (!latestRun?.id) return null;
			const res = await client.runs[":id"].$get({
				param: { id: latestRun.id },
			});
			if (!res.ok) throw new Error("Failed to fetch run details");
			return (await res.json()) as RunDetails;
		},
		enabled: !!latestRun?.id,
		refetchInterval: false,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});

	// 入力ロックは「送信/初期スレッド作成待ち」の間だけに限定する。
	// run status に依存すると、サーバーダウン時に running が残って永久ロックになる。
	const isInitialSessionCreating = createSessionMutation.isPending;
	const isAgentWorking = isChatSubmitting || isInitialSessionCreating;
	const isAgentThinking =
		isInitialSessionCreating ||
		isChatSubmitting ||
		isMissionPilotChatPending(activeSession) ||
		startRunMutation.isPending ||
		Boolean(pendingChatRunId) ||
		Boolean(activeSessionId && pendingAssistantTaskId === activeSessionId) ||
		isActiveRunStatus(latestRun?.status) ||
		isActiveTaskStatus(activeSession?.status);
	const latestRunEvents =
		realtimeEvents.length > 0 ? realtimeEvents : latestRunDetails?.events || [];
	const latestRunTodos = latestRunDetails?.todos || [];
	const latestRunReviews = latestRunDetails?.reviews || [];

	useLatestRunSubscription({
		activeSessionId,
		latestRun,
		latestRunEvents,
		subscriptionRef: latestRunSubscriptionRef,
	});
	const sessionPresentation = useNightWorkersSessionPresentation({
		activeSession,
		activePlanModeWorkspace,
		implementationQueue,
		latestRun,
		latestRunEvents,
		latestRunReviews,
		latestRunTodos,
		activeReviewSession,
		taskMessages,
		activityArtifacts,
		sessions,
		projects,
	});
	const {
		activeArtifactRefs,
		activeSessionViewWithQueuePosition,
		groupedSessionViews,
		sessionViews,
	} = sessionPresentation;

	useEffect(() => {
		// サーバーダウンやWS切断時に入力が永久ロックされるのを防ぐ
		if (realtimeStatus !== "disconnected") return;
		setIsChatSubmitting(false);
		chatSubmitStartedAtRef.current = null;
		chatSubmitTransportRef.current = null;
		pendingChatRunIdRef.current = null;
		setPendingChatRunId(null);
		pendingAssistantTaskIdRef.current = null;
		setPendingAssistantTaskId(null);
		pendingChatAbortControllerRef.current?.abort();
		pendingChatAbortControllerRef.current = null;
		pendingChatQueueRef.current = [];
	}, [realtimeStatus]);

	useEffect(() => {
		if (!activeSessionId) return;
		const timer = setInterval(() => {
			if (!isChatSubmitting) return;
			const startedAt = chatSubmitStartedAtRef.current;
			if (!startedAt) return;
			if (chatSubmitTransportRef.current === "http") return;
			const elapsed = Date.now() - startedAt;
			// 接続が生きて見えても応答が詰まるケース向けのフェイルセーフ
			if (elapsed < 20000) return;

			const hasAcceptedOrActiveRun =
				Boolean(pendingChatRunIdRef.current || pendingChatRunId) ||
				isActiveRunStatus(latestRun?.status) ||
				isActiveTaskStatus(activeSession?.status);

			if (!hasAcceptedOrActiveRun) {
				setIsChatSubmitting(false);
				chatSubmitStartedAtRef.current = null;
				chatSubmitTransportRef.current = null;
				pendingChatRunIdRef.current = null;
				setPendingChatRunId(null);
				pendingAssistantTaskIdRef.current = null;
				setPendingAssistantTaskId(null);
				pendingChatAbortControllerRef.current?.abort();
				pendingChatAbortControllerRef.current = null;
				pendingChatQueueRef.current = [];
			}
		}, 2000);
		return () => clearInterval(timer);
	}, [
		activeSession?.status,
		activeSessionId,
		isChatSubmitting,
		latestRun?.status,
		pendingChatRunId,
	]);

	useEffect(() => {
		const runId = latestRun?.id;
		if (!runId) {
			setRealtimeEvents(
				mergeRunEvents({
					latestRunId: null,
					restEvents: latestRunDetails?.events || [],
					bufferedEventsByRun,
				}),
			);
			return;
		}
		const merged = mergeRunEvents({
			latestRunId: runId,
			restEvents: (latestRunDetails?.events || []) as TaskEvent[],
			bufferedEventsByRun,
		});
		setRealtimeEvents(merged);
	}, [latestRun?.id, latestRunDetails?.events, bufferedEventsByRun]);

	useNightWorkersRealtime({
		activeSessionId,
		queryClient,
		wsRef,
		latestRunSubscriptionRef,
		pendingChatQueueRef,
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
	});

	return {
		projects,
		sessions,
		sessionViews,
		groupedSessionViews,
		activeSessionId,
		activeSession,
		activeSessionView: activeSessionViewWithQueuePosition,
		activeProject,
		activeSessionRuns,
		latestRun,
		taskMessages,
		latestRunEvents,
		llmUsageSummary,
		activityEvents,
		activityArtifacts,
		backgroundProcesses,
		activeStreamingResponse: activeSessionId
			? streamingTextByTask[activeSessionId] || ""
			: "",
		latestRunTodos,
		latestRunReviews,
		activeReviewSession,
		activeGitCloseout,
		activeArtifactRefs,
		projectFileEntries: projectFilesState.projectFileEntries,
		projectFileEntriesByDirectory:
			projectFilesState.projectFileEntriesByDirectory,
		expandedProjectDirectories: projectFilesState.expandedProjectDirectories,
		loadingProjectDirectories: projectFilesState.loadingProjectDirectories,
		selectedProjectFile: projectFilesState.selectedProjectFile,
		selectedProjectFilePath: projectFilesState.selectedProjectFilePath,
		isProjectFilesLoading: projectFilesState.isProjectFilesLoading,
		isProjectFileLoading: projectFilesState.isProjectFileLoading,
		projectDiff: projectFilesState.projectDiff,
		isProjectDiffLoading: projectFilesState.isProjectDiffLoading,
		isRealtimeConnected,
		realtimeStatus,
		isChatSubmitting,
		isProjectsLoading,
		isProjectListRefreshing: isProjectsFetching || isSessionsFetching,
		isSessionsLoading,
		isAgentWorking,
		isAgentThinking,
		isUpdatingSessionStatus: updateSessionStatusMutation.isPending,
		expandedProjects,
		setExpandedProjects,
		setActiveSessionId,
		createProject: (input) => createProjectMutation.mutate(input),
		updateProject: (id, input) =>
			updateProjectMutation.mutateAsync({ id, data: input }),
		deleteProject: (id) => deleteProjectMutation.mutate(id),
		deleteSession: (id) => deleteSessionMutation.mutate(id),
		createSession: (input) => createSessionMutation.mutateAsync(input),
		startRun: (sessionId) => startRunMutation.mutateAsync(sessionId),
		stopRun: (runId) => stopRunMutation.mutateAsync(runId),
		resumeTodo: (input) => resumeTodoMutation.mutateAsync(input),
		isResumingTodo: resumeTodoMutation.isPending,
		stopBackgroundProcess: (processId) =>
			stopBackgroundProcessMutation.mutateAsync(processId),
		queueSession: (sessionId) => queueSessionMutation.mutateAsync(sessionId),
		commitRunGitCloseout: (runId) =>
			commitRunGitCloseoutMutation.mutateAsync(runId),
		pushRunGitCloseout: (runId) =>
			pushRunGitCloseoutMutation.mutateAsync(runId),
		updateSessionStatus: (sessionId, status) =>
			updateSessionStatusMutation.mutateAsync({ sessionId, status }),
		archiveCompletedSession: (
			sessionId: string,
			options?: { discardPendingCloseouts?: boolean },
		) =>
			archiveCompletedSessionMutation.mutateAsync({
				sessionId,
				discardPendingCloseouts: options?.discardPendingCloseouts,
			}),
		restoreArchivedSession: (sessionId: string) =>
			restoreArchivedSessionMutation.mutateAsync(sessionId),
		reorderQueueSessions: (sessionIds) =>
			reorderQueueSessionsMutation.mutateAsync(sessionIds),
		moveWorkbenchSession: (input) =>
			moveWorkbenchSessionMutation.mutateAsync(input),
		...chatActions,
		refreshWorkspace: () => {
			queryClient.invalidateQueries({ queryKey: ["projects"] });
			queryClient.invalidateQueries({ queryKey: ["sessions"] });
			queryClient.invalidateQueries({
				queryKey: ["sessionRuns", activeSessionId],
			});
			queryClient.invalidateQueries({
				queryKey: ["runDetails", latestRun?.id],
			});
			queryClient.invalidateQueries({
				queryKey: ["backgroundProcesses", activeSessionId],
			});
			queryClient.invalidateQueries({
				queryKey: ["reviewSession", activeSessionId],
			});
			queryClient.invalidateQueries({
				queryKey: ["gitCloseout", latestRun?.id],
			});
		},
		refreshProjectList: async () => {
			await Promise.all([refetchProjects(), refetchSessions()]);
		},
		currentBrowserPath: projectFilesState.currentBrowserPath,
		browserParentPath: projectFilesState.browserParentPath,
		browserDirectories: projectFilesState.browserDirectories,
		isBrowserLoading: projectFilesState.isBrowserLoading,
		fetchDirectories: projectFilesState.fetchDirectories,
		createFolder: projectFilesState.createFolder,
		refreshProjectFiles: projectFilesState.refreshProjectFiles,
		refreshProjectDiff: projectFilesState.refreshProjectDiff,
		...settingsState,
		toggleProjectDirectory: projectFilesState.toggleProjectDirectory,
		openProjectFile: projectFilesState.openProjectFile,
	};
}
