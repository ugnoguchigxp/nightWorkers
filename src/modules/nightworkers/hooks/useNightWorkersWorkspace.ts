import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { client } from "../../../lib/api";
import { readJsonResponse } from "../../../lib/api-error";
import { CodingAgentCommandClient } from "../../codingAgent";
import { planModeWorkspaceQueryOptions } from "../../specification";
import { taskOperatorProjectionQueryOptions } from "../../taskOperator";
import {
	fetchBackgroundProcessesForTask,
	fetchImplementationQueue,
	fetchLatestTaskReviewSession,
	fetchRunGitCloseout,
	fetchTaskActivityEvents,
	fetchTaskLlmUsage,
	fetchTaskMessages,
} from "../nightWorkersCommands";
import {
	repositoriesQueryOptions,
	repositoryQueryKeys,
} from "../queries/repository-queries";
import type { NightWorkersRealtimeConnection } from "../realtime/nightWorkersRealtimeConnection";
import { mergeRunEvents } from "../realtimeEvents";
import type {
	BackgroundProcess,
	GitCloseoutState,
	ImplementationQueueDashboard,
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
	normalizeActivityReplay,
	resolveNextActiveSessionId,
} from "./useNightWorkersWorkspaceModel";

export { resolveNextActiveSessionId } from "./useNightWorkersWorkspaceModel";

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
	const realtimeConnectionRef = useRef<NightWorkersRealtimeConnection | null>(
		null,
	);
	const codingAgentCommandClientRef = useRef<CodingAgentCommandClient | null>(
		null,
	);
	if (!codingAgentCommandClientRef.current) {
		codingAgentCommandClientRef.current = new CodingAgentCommandClient({
			getConnection: () => realtimeConnectionRef.current,
		});
	}
	const lastSubmitRef = useRef<{
		taskId: string;
		prompt: string;
		contextKey: string;
		at: number;
	} | null>(null);
	const chatSubmitStartedAtRef = useRef<number | null>(null);
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
		...repositoriesQueryOptions(),
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
			return readJsonResponse<Task[]>(await client.tasks.$get());
		},
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});

	const { data: implementationQueue = null } = useQuery({
		queryKey: ["implementationQueue"],
		queryFn: async () => {
			return readJsonResponse<ImplementationQueueDashboard>(
				await fetchImplementationQueue(),
			);
		},
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});

	const { data: activeSessionRuns = [] } = useQuery({
		queryKey: ["sessionRuns", activeSessionId],
		queryFn: async () => {
			if (!activeSessionId) return [];
			return readJsonResponse<TaskRun[]>(
				await client.tasks[":id"].runs.$get({
					param: { id: activeSessionId },
				}),
			);
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
			return readJsonResponse<GitCloseoutState>(
				await fetchRunGitCloseout(latestRun.id),
			);
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
			return readJsonResponse<TaskMessage[]>(
				await fetchTaskMessages(activeSessionId),
			);
		},
		enabled: !!activeSessionId,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});
	const { data: activeTaskOperatorView = null } = useQuery(
		taskOperatorProjectionQueryOptions(activeSessionId),
	);

	const { data: activePlanModeWorkspace = null } = useQuery(
		planModeWorkspaceQueryOptions(activeSessionId),
	);

	const { data: llmUsageSummary = null } = useQuery({
		queryKey: ["llmUsage", activeSessionId],
		queryFn: async () => {
			if (!activeSessionId) return null;
			return readJsonResponse<TaskLlmUsageSummary>(
				await fetchTaskLlmUsage(activeSessionId),
			);
		},
		enabled: !!activeSessionId,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});

	const { data: activityReplay = emptyActivityReplay } = useQuery({
		queryKey: ["activityReplay", activeSessionId],
		queryFn: async () => {
			if (!activeSessionId) return emptyActivityReplay;
			return normalizeActivityReplay(
				await readJsonResponse(await fetchTaskActivityEvents(activeSessionId)),
			);
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
			return readJsonResponse<ReviewSessionDetail | null>(
				await fetchLatestTaskReviewSession(activeSessionId),
			);
		},
		enabled: !!activeSessionId,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});

	const { data: backgroundProcesses = [] } = useQuery({
		queryKey: ["backgroundProcesses", activeSessionId],
		queryFn: async () => {
			if (!activeSessionId) return [];
			return readJsonResponse<BackgroundProcess[]>(
				await fetchBackgroundProcessesForTask(activeSessionId),
			);
		},
		enabled: !!activeSessionId,
		refetchInterval: false,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});

	const settingsState = useNightWorkersSettings();
	const chatActions = createNightWorkersChatActions({
		queryClient,
		lastSubmitRef,
		chatSubmitStartedAtRef,
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
		codingAgentCommandClient: codingAgentCommandClientRef.current,
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
			return readJsonResponse<RunDetails>(
				await client.runs[":id"].$get({
					param: { id: latestRun.id },
				}),
			);
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

	useEffect(() => () => codingAgentCommandClientRef.current?.dispose(), []);

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
		connectionRef: realtimeConnectionRef,
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
	});
	const commandRevision = async (taskId: string, actionId: string) => {
		const view =
			activeTaskOperatorView?.task.id === taskId
				? activeTaskOperatorView
				: await queryClient.fetchQuery(
						taskOperatorProjectionQueryOptions(taskId),
					);
		if (!view?.commandCatalog.availableIds.includes(actionId))
			throw new Error(
				"Task Operator view is not ready for this Coding Agent action.",
			);
		return view.task.revision;
	};

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
		startRun: async (sessionId) =>
			startRunMutation.mutateAsync({
				taskId: sessionId,
				expectedTaskRevision: await commandRevision(
					sessionId,
					"run.implementation.start",
				),
			}),
		stopRun: async (runId) => {
			if (!activeSessionId)
				throw new Error("No active Task is available for this run.");
			return stopRunMutation.mutateAsync({
				taskId: activeSessionId,
				runId,
				expectedTaskRevision: await commandRevision(
					activeSessionId,
					"run.stop",
				),
			});
		},
		resumeTodo: async (input) => {
			if (!activeSessionId)
				throw new Error("No active Task is available for this Todo.");
			return resumeTodoMutation.mutateAsync({
				...input,
				taskId: activeSessionId,
				expectedTaskRevision: await commandRevision(
					activeSessionId,
					"run.todo.resume",
				),
			});
		},
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
			queryClient.invalidateQueries({ queryKey: repositoryQueryKeys.all });
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
