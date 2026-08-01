import { type QueryClient, useMutation } from "@tanstack/react-query";
import type { Dispatch, SetStateAction } from "react";
import { client } from "../../../lib/api";
import {
	type CodingAgentCommandClient,
	useCodingAgentCommandMutations,
} from "../../codingAgent";
import {
	archiveWorkbenchSession,
	commitRunGitCloseout,
	createWorkbenchSession,
	deleteTask,
	pushRunGitCloseout,
	queueWorkbenchSession,
	restoreWorkbenchSessionArchive,
	stopBackgroundProcess,
} from "../nightWorkersCommands";
import {
	mergeRealtimeRunDetails,
	mergeRealtimeRunList,
} from "../realtimeEvents";
import type {
	BackgroundProcess,
	CreateProjectInput,
	CreateSessionInput,
	GitCloseoutState,
	Repository,
	RunDetails,
	Task,
	TaskRun,
	UpdateProjectInput,
	WorkbenchMovableSessionGroup,
} from "../types";
import { syncGitCloseoutMutationCache } from "./gitCloseoutMutationCache";
import {
	buildPriorityUpdates,
	invalidateCommandFailure,
	patchTask,
	refreshTaskNavigationQueries,
	resolveNextActiveSessionId,
	syncTaskNavigationCaches,
} from "./nightWorkersMutationHelpers";

type UseNightWorkersMutationsInput = {
	activeSessionId: string | null;
	queryClient: QueryClient;
	setActiveSessionId: Dispatch<SetStateAction<string | null>>;
	codingAgentCommandClient: CodingAgentCommandClient;
};

export function useNightWorkersMutations({
	activeSessionId,
	queryClient,
	setActiveSessionId,
	codingAgentCommandClient,
}: UseNightWorkersMutationsInput) {
	const createProjectMutation = useMutation({
		mutationFn: async (data: CreateProjectInput) => {
			const res = await client.repositories.$post({
				json: { ...data, branch: data.branch || "main" },
			});
			if (!res.ok) throw new Error(await res.text());
			return res.json();
		},
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
	});

	const deleteProjectMutation = useMutation({
		mutationFn: async (id: string) => {
			const res = await client.repositories[":id"].$delete({ param: { id } });
			if (!res.ok) throw new Error("Failed to delete project");
			return res.json();
		},
		onSuccess: () => {
			setActiveSessionId(null);
			queryClient.invalidateQueries({ queryKey: ["projects"] });
			queryClient.invalidateQueries({ queryKey: ["sessions"] });
		},
	});

	const updateProjectMutation = useMutation({
		mutationFn: async (input: { id: string; data: UpdateProjectInput }) => {
			const res = await client.repositories[":id"].$patch({
				param: { id: input.id },
				json: input.data,
			});
			if (!res.ok) throw new Error(await res.text());
			return (await res.json()) as Repository;
		},
		onMutate: async (input) => {
			await queryClient.cancelQueries({ queryKey: ["projects"] });
			const previous = queryClient.getQueryData<Repository[]>(["projects"]);
			queryClient.setQueryData<Repository[]>(["projects"], (prev = []) =>
				prev.map((project) =>
					project.id === input.id ? { ...project, ...input.data } : project,
				),
			);
			return { previous };
		},
		onError: (_error, _input, context) => {
			if (context?.previous)
				queryClient.setQueryData(["projects"], context.previous);
		},
		onSuccess: (project) => {
			queryClient.setQueryData<Repository[]>(["projects"], (prev = []) =>
				prev.map((candidate) =>
					candidate.id === project.id ? project : candidate,
				),
			);
			queryClient.invalidateQueries({ queryKey: ["sessions"] });
		},
		onSettled: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
	});

	const createSessionMutation = useMutation({
		mutationFn: async (data: CreateSessionInput) => {
			const res = await createWorkbenchSession(data);
			if (!res.ok) throw new Error("Failed to create session");
			return (await res.json()) as Task;
		},
		onSuccess: (newSession) => {
			setActiveSessionId(newSession.id);
			queryClient.setQueryData<Task[]>(["sessions"], (prev = []) => {
				const next = [...prev];
				const idx = next.findIndex((session) => session.id === newSession.id);
				if (idx >= 0) next[idx] = newSession;
				else next.unshift(newSession);
				return next;
			});
			queryClient.invalidateQueries({ queryKey: ["sessions"] });
		},
	});

	const deleteSessionMutation = useMutation({
		mutationFn: async (id: string) => {
			const res = await deleteTask(id);
			if (!res.ok) throw new Error("Failed to delete session");
			return res.json();
		},
		onSuccess: (_, deletedId) => {
			const remainingSessions = (
				queryClient.getQueryData<Task[]>(["sessions"]) ?? []
			).filter((session) => session.id !== deletedId);
			queryClient.setQueryData<Task[]>(["sessions"], remainingSessions);
			setActiveSessionId((currentId) =>
				resolveNextActiveSessionId(currentId, remainingSessions),
			);
			queryClient.removeQueries({ queryKey: ["sessionRuns", deletedId] });
			queryClient.removeQueries({ queryKey: ["taskMessages", deletedId] });
			queryClient.invalidateQueries({ queryKey: ["sessions"] });
			queryClient.invalidateQueries({ queryKey: ["sessionRuns"] });
			queryClient.invalidateQueries({ queryKey: ["taskMessages"] });
		},
	});

	const { startRunMutation, stopRunMutation, resumeTodoMutation } =
		useCodingAgentCommandMutations({
			client: codingAgentCommandClient,
			onFailure: (taskId, error) =>
				invalidateCommandFailure(queryClient, taskId, error),
			onStartSuccess: (run) => {
				queryClient.setQueryData<TaskRun[]>(
					["sessionRuns", run.taskId],
					(prev = []) => {
						return mergeRealtimeRunList(prev, run);
					},
				);
				queryClient.setQueryData<RunDetails | null>(
					["runDetails", run.id],
					(prev) => {
						return mergeRealtimeRunDetails(prev, run) ?? prev;
					},
				);
				queryClient.setQueryData<Task[]>(["sessions"], (prev = []) =>
					prev.map((session) =>
						session.id === run.taskId
							? { ...session, status: "running" }
							: session,
					),
				);
				queryClient.invalidateQueries({ queryKey: ["sessions"] });
				queryClient.invalidateQueries({
					queryKey: ["sessionRuns", run.taskId],
				});
			},
			onStopSuccess: (run) => {
				queryClient.setQueryData<TaskRun[]>(
					["sessionRuns", run.taskId],
					(prev = []) => {
						const next = [...prev];
						const idx = next.findIndex((candidate) => candidate.id === run.id);
						if (idx >= 0) next[idx] = run;
						else next.unshift(run);
						return next;
					},
				);
				queryClient.setQueryData<Task[]>(["sessions"], (prev = []) =>
					prev.map((session) =>
						session.id === run.taskId
							? { ...session, status: "ready" }
							: session,
					),
				);
				queryClient.invalidateQueries({ queryKey: ["sessions"] });
				queryClient.invalidateQueries({ queryKey: ["implementationQueue"] });
				queryClient.invalidateQueries({
					queryKey: ["sessionRuns", run.taskId],
				});
				queryClient.invalidateQueries({ queryKey: ["runDetails", run.id] });
			},
			onResumeSuccess: (run) => {
				queryClient.setQueryData<TaskRun[]>(
					["sessionRuns", run.taskId],
					(prev = []) => mergeRealtimeRunList(prev, run),
				);
				queryClient.setQueryData<Task[]>(["sessions"], (prev = []) =>
					prev.map((task) =>
						task.id === run.taskId ? { ...task, status: "running" } : task,
					),
				);
				queryClient.invalidateQueries({ queryKey: ["runDetails", run.id] });
				queryClient.invalidateQueries({
					queryKey: ["sessionRuns", run.taskId],
				});
				queryClient.invalidateQueries({ queryKey: ["sessions"] });
			},
		});

	const stopBackgroundProcessMutation = useMutation({
		mutationFn: async (processId: string) => {
			const res = await stopBackgroundProcess(processId);
			if (!res.ok) throw new Error(await res.text());
			return (await res.json()) as BackgroundProcess;
		},
		onSuccess: (processRecord) => {
			queryClient.setQueryData<BackgroundProcess[]>(
				["backgroundProcesses", activeSessionId],
				(prev = []) =>
					prev.map((candidate) =>
						candidate.id === processRecord.id ? processRecord : candidate,
					),
			);
			queryClient.invalidateQueries({ queryKey: ["backgroundProcesses"] });
			if (processRecord.taskId) {
				queryClient.invalidateQueries({
					queryKey: ["activityReplay", processRecord.taskId],
				});
			}
		},
	});

	const queueSessionMutation = useMutation({
		mutationFn: async (sessionId: string) => {
			const res = await queueWorkbenchSession(sessionId);
			if (!res.ok) throw new Error(await res.text());
			return (await res.json()) as Task;
		},
		onSuccess: (task) => {
			queryClient.setQueryData<Task[]>(["sessions"], (prev = []) => {
				const next = [...prev];
				const idx = next.findIndex((candidate) => candidate.id === task.id);
				if (idx >= 0) next[idx] = task;
				else next.unshift(task);
				return next;
			});
			queryClient.invalidateQueries({ queryKey: ["sessions"] });
		},
	});

	const commitRunGitCloseoutMutation = useMutation({
		mutationFn: async (runId: string) => {
			const res = await commitRunGitCloseout(runId);
			if (!res.ok) throw new Error(await res.text());
			return (await res.json()) as GitCloseoutState;
		},
		onSuccess: (state) => {
			syncGitCloseoutMutationCache(queryClient, state, activeSessionId);
		},
	});

	const pushRunGitCloseoutMutation = useMutation({
		mutationFn: async (runId: string) => {
			const res = await pushRunGitCloseout(runId);
			if (!res.ok) throw new Error(await res.text());
			return (await res.json()) as GitCloseoutState;
		},
		onSuccess: (state) => {
			syncGitCloseoutMutationCache(queryClient, state);
		},
	});

	const updateSessionStatusMutation = useMutation({
		mutationFn: async (input: {
			sessionId: string;
			status: "draft" | "ready" | "cancelled";
		}) => {
			return patchTask(input.sessionId, { status: input.status });
		},
		onMutate: async (input) => {
			await queryClient.cancelQueries({ queryKey: ["sessions"] });
			const previous = queryClient.getQueryData<Task[]>(["sessions"]);
			queryClient.setQueryData<Task[]>(["sessions"], (prev = []) =>
				prev.map((session) =>
					session.id === input.sessionId
						? { ...session, status: input.status }
						: session,
				),
			);
			return { previous };
		},
		onError: (_error, _input, context) => {
			if (context?.previous)
				queryClient.setQueryData(["sessions"], context.previous);
		},
		onSuccess: (task) => {
			queryClient.setQueryData<Task[]>(["sessions"], (prev = []) => {
				const next = [...prev];
				const idx = next.findIndex((candidate) => candidate.id === task.id);
				if (idx >= 0) next[idx] = task;
				else next.unshift(task);
				return next;
			});
			queryClient.invalidateQueries({ queryKey: ["sessions"] });
		},
	});

	const archiveCompletedSessionMutation = useMutation({
		mutationFn: async (input: {
			sessionId: string;
			discardPendingCloseouts?: boolean;
		}) => {
			const response = await archiveWorkbenchSession(input.sessionId, {
				discardPendingCloseouts: input.discardPendingCloseouts,
			});
			if (!response.ok) throw new Error(await response.text());
			return (await response.json()) as Task;
		},
		onSuccess: async (task) => {
			syncTaskNavigationCaches(queryClient, task);
			await refreshTaskNavigationQueries(queryClient, task.id);
		},
		onError: async (_error, input) => {
			await refreshTaskNavigationQueries(queryClient, input.sessionId);
		},
	});

	const restoreArchivedSessionMutation = useMutation({
		mutationFn: async (sessionId: string) => {
			const response = await restoreWorkbenchSessionArchive(sessionId);
			if (!response.ok) throw new Error(await response.text());
			return (await response.json()) as Task;
		},
		onSuccess: async (task) => {
			syncTaskNavigationCaches(queryClient, task);
			await refreshTaskNavigationQueries(queryClient, task.id);
		},
		onError: async (_error, sessionId) => {
			await refreshTaskNavigationQueries(queryClient, sessionId);
		},
	});

	const reorderQueueSessionsMutation = useMutation({
		mutationFn: async (sessionIds: string[]) => {
			const updates = buildPriorityUpdates(
				sessionIds,
				queryClient.getQueryData<Task[]>(["sessions"]) ?? [],
			);
			const tasks = await Promise.all(
				updates.map(async ({ sessionId, priority }) => {
					return patchTask(sessionId, { priority });
				}),
			);
			return tasks;
		},
		onMutate: async (sessionIds) => {
			await queryClient.cancelQueries({ queryKey: ["sessions"] });
			const previous = queryClient.getQueryData<Task[]>(["sessions"]);
			const priorityById = new Map(
				sessionIds.map((id, index) => [id, sessionIds.length - index]),
			);
			queryClient.setQueryData<Task[]>(["sessions"], (prev = []) =>
				prev.map((session) =>
					priorityById.has(session.id)
						? { ...session, priority: priorityById.get(session.id) as number }
						: session,
				),
			);
			return { previous };
		},
		onError: (_error, _sessionIds, context) => {
			if (context?.previous)
				queryClient.setQueryData(["sessions"], context.previous);
		},
		onSuccess: (tasks) => {
			queryClient.setQueryData<Task[]>(["sessions"], (prev = []) => {
				const taskById = new Map(tasks.map((task) => [task.id, task]));
				return prev.map((session) => taskById.get(session.id) || session);
			});
		},
		onSettled: () => queryClient.invalidateQueries({ queryKey: ["sessions"] }),
	});

	const moveWorkbenchSessionMutation = useMutation({
		mutationFn: async (input: {
			sessionId: string;
			sourceGroup: WorkbenchMovableSessionGroup;
			targetGroup: WorkbenchMovableSessionGroup;
			processingIds: string[];
			queueIds: string[];
			archiveIds: string[];
		}) => {
			if (input.sourceGroup === "queue" && input.targetGroup === "processing") {
				await patchTask(input.sessionId, { status: "draft" });
			} else if (
				input.sourceGroup === "processing" &&
				input.targetGroup === "queue"
			) {
				const res = await queueWorkbenchSession(input.sessionId);
				if (!res.ok) throw new Error(await res.text());
			} else if (input.targetGroup === "archive") {
				const res = await archiveWorkbenchSession(input.sessionId);
				if (!res.ok) throw new Error(await res.text());
			}

			const rankedIds = [...input.processingIds, ...input.queueIds];
			const updates = buildPriorityUpdates(
				rankedIds,
				queryClient.getQueryData<Task[]>(["sessions"]) ?? [],
			);
			await Promise.all(
				updates.map(async ({ sessionId, priority }) => {
					await patchTask(sessionId, { priority });
				}),
			);
		},
		onMutate: async (input) => {
			await queryClient.cancelQueries({ queryKey: ["sessions"] });
			const previous = queryClient.getQueryData<Task[]>(["sessions"]);
			const rankedIds = [...input.processingIds, ...input.queueIds];
			const priorityById = new Map(
				rankedIds.map((id, index) => [id, rankedIds.length - index]),
			);
			queryClient.setQueryData<Task[]>(["sessions"], (prev = []) =>
				prev.map((session) => {
					const priority = priorityById.get(session.id);
					if (session.id === input.sessionId && input.targetGroup === "queue") {
						return {
							...session,
							status: "queued",
							priority: priority ?? session.priority,
						};
					}
					if (
						session.id === input.sessionId &&
						input.targetGroup === "processing"
					) {
						return {
							...session,
							status: "draft",
							priority: priority ?? session.priority,
						};
					}
					if (
						session.id === input.sessionId &&
						input.targetGroup === "archive"
					) {
						return {
							...session,
							status: "cancelled",
							priority: priority ?? session.priority,
						};
					}
					if (priority !== undefined) return { ...session, priority };
					return session;
				}),
			);
			return { previous };
		},
		onError: (_error, _input, context) => {
			if (context?.previous)
				queryClient.setQueryData(["sessions"], context.previous);
		},
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: ["sessions"] });
			queryClient.invalidateQueries({ queryKey: ["sessionRuns"] });
			queryClient.invalidateQueries({ queryKey: ["runDetails"] });
		},
	});

	return {
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
		updateSessionStatusMutation,
		archiveCompletedSessionMutation,
		restoreArchivedSessionMutation,
		reorderQueueSessionsMutation,
		moveWorkbenchSessionMutation,
		commitRunGitCloseoutMutation,
		pushRunGitCloseoutMutation,
	};
}
