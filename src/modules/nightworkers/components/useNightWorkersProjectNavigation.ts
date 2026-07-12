import {
	type Dispatch,
	type MutableRefObject,
	type SetStateAction,
	useCallback,
} from "react";
import type { NightWorkersWorkspaceState } from "../hooks/useNightWorkersWorkspace";
import {
	buildOverviewRoute,
	type WorkbenchRouteState,
} from "../routing/workbench-route-state";
import type { Task } from "../types";
import type { NightWorkersShellProps } from "./NightWorkersShell.types";
import type { ArtifactPaneFocus } from "./nightworkers-shell-route-effects";
import {
	projectEvaluationDraftStorageKey,
	projectEvaluationTaskPromptDrafts,
} from "./nightworkers-shell-utils";

export function useNightWorkersProjectNavigation(input: {
	workspaceRef: MutableRefObject<NightWorkersWorkspaceState>;
	routeState: WorkbenchRouteState;
	onNavigate: NightWorkersShellProps["onNavigate"];
	onOpenFolderBrowser: () => void;
	selectedPath: string;
	setArtifactFocus: Dispatch<SetStateAction<ArtifactPaneFocus>>;
}) {
	const handleSelectSession = useCallback(
		(sessionId: string | null) => {
			input.setArtifactFocus({ type: "closed" });
			input.workspaceRef.current.setActiveSessionId(sessionId);
			input.onNavigate(
				sessionId
					? { kind: "session", sessionId, artifact: null }
					: buildOverviewRoute(),
			);
		},
		[input.onNavigate, input.setArtifactFocus, input.workspaceRef],
	);
	const handleCreateSession = useCallback(
		async (repositoryId: string) => {
			const session = await input.workspaceRef.current.createSession({
				repositoryId,
				title: "New Session",
				description: "",
				objective: "",
				acceptanceCriteria: "",
			});
			input.workspaceRef.current.setActiveSessionId(session.id);
			input.onNavigate({
				kind: "session",
				sessionId: session.id,
				artifact: null,
			});
		},
		[input.onNavigate, input.workspaceRef],
	);
	const handleDeleteProject = useCallback(
		(projectId: string) => {
			input.workspaceRef.current.deleteProject(projectId);
			if (
				(input.routeState.kind === "project_queue" ||
					input.routeState.kind === "project_detail") &&
				input.routeState.projectId === projectId
			) {
				input.onNavigate(buildOverviewRoute());
			}
		},
		[input.onNavigate, input.routeState, input.workspaceRef],
	);
	const handleToggleProject = useCallback(
		(projectId: string) =>
			input.workspaceRef.current.setExpandedProjects((prev) => ({
				...prev,
				[projectId]: !prev[projectId],
			})),
		[input.workspaceRef],
	);
	const handleOpenFolderBrowser = useCallback(() => {
		input.onOpenFolderBrowser();
		void input.workspaceRef.current.fetchDirectories(
			input.selectedPath || undefined,
		);
	}, [input.onOpenFolderBrowser, input.selectedPath, input.workspaceRef]);
	const handleOpenOverview = useCallback(() => {
		input.setArtifactFocus({ type: "closed" });
		input.onNavigate(buildOverviewRoute());
	}, [input.onNavigate, input.setArtifactFocus]);
	const handleOpenProjectQueue = useCallback(
		(projectId: string) => {
			input.setArtifactFocus({ type: "closed" });
			input.onNavigate({ kind: "project_queue", projectId, view: "board" });
		},
		[input.onNavigate, input.setArtifactFocus],
	);
	const handleOpenProjectDetail = useCallback(
		(projectId: string) => {
			input.setArtifactFocus({ type: "closed" });
			input.onNavigate(buildOverviewRoute("30d", projectId));
		},
		[input.onNavigate, input.setArtifactFocus],
	);
	const handleProjectEvaluationTasksCreated = useCallback(
		async (tasks: Task[]) => {
			const drafts = projectEvaluationTaskPromptDrafts(tasks);
			try {
				for (const draft of drafts) {
					window.localStorage.setItem(
						projectEvaluationDraftStorageKey(draft.taskId),
						draft.prompt,
					);
				}
			} catch {
				// localStorage is a convenience for Composer drafts; the Task objective still has the prompt.
			}
			const firstTask = tasks[0];
			if (!firstTask) return;
			await input.workspaceRef.current.refreshProjectList();
			input.setArtifactFocus({ type: "closed" });
			input.workspaceRef.current.setActiveSessionId(firstTask.id);
			input.onNavigate({
				kind: "session",
				sessionId: firstTask.id,
				artifact: null,
			});
		},
		[input.onNavigate, input.setArtifactFocus, input.workspaceRef],
	);
	const handleProjectDetailTasksCreated = useCallback(
		async (tasks: Task[]) => {
			if (tasks.length === 0) return;
			await input.workspaceRef.current.refreshProjectList();
		},
		[input.workspaceRef],
	);

	return {
		handleSelectSession,
		handleCreateSession,
		handleDeleteProject,
		handleToggleProject,
		handleOpenFolderBrowser,
		handleOpenOverview,
		handleOpenProjectQueue,
		handleOpenProjectDetail,
		handleProjectEvaluationTasksCreated,
		handleProjectDetailTasksCreated,
	};
}
