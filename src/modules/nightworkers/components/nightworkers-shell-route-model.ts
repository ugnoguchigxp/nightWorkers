import type { NightWorkersWorkspaceState } from "../hooks/useNightWorkersWorkspace";
import type { WorkbenchRouteState } from "../routing/workbench-route-state";
import {
	collectProjectSessionViews,
	isMissingProjectRoute,
	isMissingSessionRoute,
} from "./nightworkers-shell-utils";

export function resolveNightWorkersShellRouteModel(input: {
	routeState: WorkbenchRouteState;
	workspace: NightWorkersWorkspaceState;
}) {
	const { routeState, workspace } = input;
	const showSettings = routeState.kind === "settings";
	const isOverviewActive = routeState.kind === "overview";
	const showQueueScreen = routeState.kind === "global_queue";
	const queueProjectFilterId =
		routeState.kind === "global_queue" ? routeState.projectId : null;
	const projectQueueProjectId =
		routeState.kind === "project_queue" ? routeState.projectId : null;
	const projectDetailProjectId =
		routeState.kind === "project_detail"
			? routeState.projectId
			: routeState.kind === "overview"
				? routeState.projectId
				: null;
	const projectQueueProject = projectQueueProjectId
		? workspace.projects.find(
				(project) => project.id === projectQueueProjectId,
			) || null
		: null;
	const projectDetailProject = projectDetailProjectId
		? workspace.projects.find(
				(project) => project.id === projectDetailProjectId,
			) || null
		: null;
	return {
		showSettings,
		isOverviewActive,
		showQueueScreen,
		queueProjectFilterId,
		projectQueueProjectId,
		projectDetailProjectId,
		projectQueueProject,
		projectDetailProject,
		projectQueueSessionViews: projectQueueProject
			? collectProjectSessionViews(
					workspace.groupedSessionViews,
					projectQueueProject.id,
				)
			: [],
		projectDetailSessionViews: projectDetailProject
			? collectProjectSessionViews(
					workspace.groupedSessionViews,
					projectDetailProject.id,
				)
			: [],
		missingProjectRoute: isMissingProjectRoute(
			routeState,
			workspace,
			projectQueueProject,
			projectDetailProject,
		),
		missingSessionRoute: isMissingSessionRoute(routeState, workspace),
	};
}
