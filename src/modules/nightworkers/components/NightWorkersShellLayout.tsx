import type {
	ComponentProps,
	Dispatch,
	MutableRefObject,
	SetStateAction,
} from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { OverviewScreen } from "@/modules/overview";
import { PilotThoughtDock } from "../../missionPilot";
import {
	ImplementationQueueScreen,
	ProjectQueueScreen,
	type useImplementationQueue,
} from "../../queue";
import type { WorkspaceAppearanceAttributes } from "../contexts/WorkspaceAppearanceContext";
import { buildOverviewRoute } from "../routing/workbench-route-state";
import type { Task } from "../types";
import type { NightWorkersShellProps } from "./NightWorkersShell.types";
import {
	NightWorkersFolderBrowser,
	NightWorkersRouteNotFoundScreen,
} from "./NightWorkersShellAuxiliary";
import { NightWorkersShellThreadPanel } from "./NightWorkersShellThreadPanel";
import type { resolveNightWorkersShellRouteModel } from "./nightworkers-shell-route-model";
import { ProjectDetailScreen } from "./ProjectDetailScreen";
import { ProjectSidebar } from "./ProjectSidebar";
import { BlueprintShowcaseButton, SettingsButton } from "./SettingsButton";
import { SettingsScreen } from "./SettingsScreen";

type ShellLayoutProps = {
	shellProps: NightWorkersShellProps;
	routeModel: ReturnType<typeof resolveNightWorkersShellRouteModel>;
	queueState: ReturnType<typeof useImplementationQueue>;
	appearanceAttributes: WorkspaceAppearanceAttributes;
	initialPanelSizes: MutableRefObject<[number, number]>;
	setPanelSizes: (sizes: [number, number]) => void;
	visibleActiveSessionId: string | null;
	isPilotThoughtDockOpen: boolean;
	setPilotThoughtDockSessionId: Dispatch<SetStateAction<string | null>>;
	selectedPath: string;
	setSelectedPath: Dispatch<SetStateAction<string>>;
	onSelectSession: ComponentProps<typeof ProjectSidebar>["onSelectSession"];
	onCreateSession: ComponentProps<typeof ProjectSidebar>["onCreateSession"];
	onDeleteProject: ComponentProps<typeof ProjectSidebar>["onDeleteProject"];
	onToggleProject: ComponentProps<typeof ProjectSidebar>["onToggleProject"];
	onOpenProjectQueue: ComponentProps<
		typeof ProjectSidebar
	>["onOpenProjectQueue"];
	onOpenProjectDetail: ComponentProps<
		typeof ProjectSidebar
	>["onOpenProjectDetail"];
	onOpenOverview: ComponentProps<typeof ProjectSidebar>["onOpenOverview"];
	onOpenFolderBrowser: ComponentProps<
		typeof ProjectSidebar
	>["onOpenFolderBrowser"];
	onQueueSession: ComponentProps<typeof ProjectQueueScreen>["onQueueSession"];
	onQueueSessionAndFocusTodo: ComponentProps<
		typeof ImplementationQueueScreen
	>["onQueueSession"];
	onEvaluationTasksCreated: (tasks: Task[]) => Promise<void>;
	onMissionTaskCandidatesCreated: (tasks: Task[]) => Promise<void>;
	threadPanelProps: ComponentProps<typeof NightWorkersShellThreadPanel>;
};

export function NightWorkersShellLayout(props: ShellLayoutProps) {
	const { shellProps, routeModel, queueState } = props;
	const { workspace, routeState } = shellProps;
	const {
		showSettings,
		isOverviewActive,
		showQueueScreen,
		queueProjectFilterId,
		projectQueueProjectId,
		projectDetailProjectId,
		projectQueueProject,
		projectDetailProject,
		projectQueueSessionViews,
		projectDetailSessionViews,
		missingProjectRoute,
		missingSessionRoute,
	} = routeModel;
	return (
		<div
			className="nightworkers-shell min-h-0 overflow-hidden bg-[#111827] text-slate-100"
			{...props.appearanceAttributes}
		>
			<Group
				className="nightworkers-workbench-group min-h-0"
				defaultLayout={{
					"nightworkers-sidebar": props.initialPanelSizes.current[0],
					"nightworkers-chat": props.initialPanelSizes.current[1],
				}}
				onLayoutChanged={(layout) =>
					props.setPanelSizes([
						layout["nightworkers-sidebar"],
						layout["nightworkers-chat"],
					])
				}
				orientation="horizontal"
			>
				<Panel
					id="nightworkers-sidebar"
					className="h-full min-h-0"
					defaultSize={`${props.initialPanelSizes.current[0]}%`}
					minSize="18%"
					maxSize="42%"
				>
					{props.isPilotThoughtDockOpen &&
					workspace.activeSession?.missionPilot ? (
						<PilotThoughtDock
							session={workspace.activeSession}
							onClose={() => props.setPilotThoughtDockSessionId(null)}
						/>
					) : (
						<ProjectSidebar
							projects={workspace.projects}
							groupedSessions={workspace.groupedSessionViews}
							isProjectsLoading={workspace.isProjectsLoading}
							activeSessionId={props.visibleActiveSessionId}
							expandedProjects={workspace.expandedProjects}
							onSelectSession={props.onSelectSession}
							onCreateSession={props.onCreateSession}
							onDeleteProject={props.onDeleteProject}
							onToggleProject={props.onToggleProject}
							onOpenProjectQueue={props.onOpenProjectQueue}
							activeProjectQueueId={projectQueueProjectId}
							onOpenProjectDetail={props.onOpenProjectDetail}
							activeProjectDetailId={projectDetailProjectId}
							onOpenOverview={props.onOpenOverview}
							isOverviewActive={isOverviewActive}
							onOpenFolderBrowser={props.onOpenFolderBrowser}
							onRefreshProjects={() => void workspace.refreshProjectList()}
							isProjectListRefreshing={workspace.isProjectListRefreshing}
						/>
					)}
				</Panel>
				<Separator className="nightworkers-panel-resize-handle" />
				<Panel
					id="nightworkers-chat"
					className="h-full min-h-0"
					defaultSize={`${props.initialPanelSizes.current[1]}%`}
					minSize="58%"
				>
					{showSettings ? (
						<SettingsScreen
							activeProject={workspace.activeProject}
							activeSection={
								routeState.kind === "settings" ? routeState.section : "general"
							}
							onSectionChange={(section) =>
								shellProps.onNavigate({ kind: "settings", section })
							}
							onClose={() => shellProps.onNavigate(buildOverviewRoute())}
						/>
					) : isOverviewActive ? (
						<OverviewScreen
							projects={workspace.projects}
							range={routeState.kind === "overview" ? routeState.range : "30d"}
							projectFilterId={
								routeState.kind === "overview" ? routeState.projectId : null
							}
							onRangeChange={(range) =>
								shellProps.onNavigate({
									kind: "overview",
									range,
									projectId:
										routeState.kind === "overview"
											? routeState.projectId
											: null,
								})
							}
							onProjectFilterChange={(projectId) =>
								shellProps.onNavigate({
									kind: "overview",
									range:
										routeState.kind === "overview" ? routeState.range : "30d",
									projectId,
								})
							}
							onOpenProjectDetailTab={(projectId, tab) =>
								shellProps.onNavigate({
									kind: "project_detail",
									projectId,
									tab,
								})
							}
							onOpenSession={(sessionId) => props.onSelectSession(sessionId)}
						/>
					) : missingProjectRoute ? (
						<NightWorkersRouteNotFoundScreen
							title="Project not found"
							detail={
								routeState.kind === "project_queue" ||
								routeState.kind === "project_detail"
									? routeState.projectId
									: ""
							}
							onOpenOverview={props.onOpenOverview}
						/>
					) : projectQueueProject ? (
						<ProjectQueueScreen
							implementationQueue={queueState.implementationQueue}
							isLoading={
								queueState.isImplementationQueueLoading ||
								workspace.isSessionsLoading
							}
							viewMode={
								routeState.kind === "project_queue" ? routeState.view : "board"
							}
							onViewModeChange={(view) =>
								shellProps.onNavigate({
									kind: "project_queue",
									projectId: projectQueueProject.id,
									view,
								})
							}
							onOpenSession={(sessionId) => props.onSelectSession(sessionId)}
							onQueueSession={props.onQueueSession}
							onRequeueEntry={queueState.requeueImplementationQueueEntry}
							onUpdateQueueEntry={queueState.updateImplementationQueueEntry}
							project={projectQueueProject}
							sessionViews={projectQueueSessionViews}
							sessions={workspace.sessions}
						/>
					) : projectDetailProject ? (
						<ProjectDetailScreen
							project={projectDetailProject}
							sessionViews={projectDetailSessionViews}
							activeTab={
								routeState.kind === "project_detail"
									? routeState.tab
									: "overview"
							}
							onActiveTabChange={(tab) =>
								shellProps.onNavigate({
									kind: "project_detail",
									projectId: projectDetailProject.id,
									tab,
								})
							}
							onOpenProjectOverview={() =>
								shellProps.onNavigate(
									buildOverviewRoute("30d", projectDetailProject.id),
								)
							}
							onOpenSession={(sessionId) => props.onSelectSession(sessionId)}
							onEvaluationTasksCreated={props.onEvaluationTasksCreated}
							onMissionTaskCandidatesCreated={
								props.onMissionTaskCandidatesCreated
							}
						/>
					) : showQueueScreen ? (
						<ImplementationQueueScreen
							dashboard={queueState.implementationQueue}
							health={queueState.implementationQueueHealth}
							projects={workspace.projects}
							activeProjectFilterId={queueProjectFilterId}
							isLoading={
								queueState.isImplementationQueueLoading ||
								queueState.isImplementationQueueHealthLoading
							}
							onSetProjectFilter={(projectId) =>
								shellProps.onNavigate({ kind: "global_queue", projectId })
							}
							onOpenSession={(sessionId) => props.onSelectSession(sessionId)}
							onQueueSession={props.onQueueSessionAndFocusTodo}
							onArchiveEntry={queueState.archiveImplementationQueueEntry}
							onRecoverEntry={queueState.recoverImplementationQueueEntry}
							onUpdateProcessorCount={
								queueState.updateImplementationQueueProcessorCount
							}
						/>
					) : missingSessionRoute ? (
						<NightWorkersRouteNotFoundScreen
							title="Session not found"
							detail={routeState.kind === "session" ? routeState.sessionId : ""}
							onOpenOverview={props.onOpenOverview}
						/>
					) : (
						<NightWorkersShellThreadPanel {...props.threadPanelProps} />
					)}
				</Panel>
			</Group>
			{!showSettings ? (
				<>
					<SettingsButton
						onClick={() =>
							shellProps.onNavigate({ kind: "settings", section: "general" })
						}
					/>
					<BlueprintShowcaseButton />
				</>
			) : null}
			<NightWorkersFolderBrowser
				open={shellProps.showFolderBrowser}
				workspace={workspace}
				selectedPath={props.selectedPath}
				setSelectedPath={props.setSelectedPath}
				onClose={shellProps.onCloseFolderBrowser}
			/>
		</div>
	);
}
