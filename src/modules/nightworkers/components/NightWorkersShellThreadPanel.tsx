import {
	type Dispatch,
	type MutableRefObject,
	type SetStateAction,
	useCallback,
	useState,
} from "react";
import type { useImplementationQueue } from "../../queue";
import type { WorkbenchLlmSelection } from "../hooks/nightWorkersWorkspaceState";
import type { NightWorkersWorkspaceState } from "../hooks/useNightWorkersWorkspace";
import type { WorkbenchRouteState } from "../routing/workbench-route-state";
import { buildOverviewRoute } from "../routing/workbench-route-state";
import type {
	ComposerThinkingDepth,
	TaskMessage,
	ThinkingDepthOption,
	WorkbenchArtifactContext,
	WorkbenchArtifactRef,
	WorkbenchChatIntent,
} from "../types";
import type { buildArtifactContext } from "../workbenchSelectors";
import { ArtifactPane } from "./ArtifactPane";
import type { ArtifactPaneFocus } from "./nightworkers-shell-route-effects";
import {
	asProjectSafetyPolicy,
	designQuestionnaireMessageIds,
	isDesignQuestionnaireReadyMessage,
} from "./nightworkers-shell-utils";
import { ThreadWorkspace } from "./ThreadWorkspace";
import { TodoListPane } from "./TodoListPane";

type ComposerModelOption = {
	value: string;
	label: string;
};

type NightWorkersShellThreadPanelProps = {
	workspace: NightWorkersWorkspaceState;
	queueState: ReturnType<typeof useImplementationQueue>;
	routeState: WorkbenchRouteState;
	onNavigate: (
		routeState: WorkbenchRouteState,
		options?: { replace?: boolean },
	) => void;
	workspaceRef: MutableRefObject<NightWorkersWorkspaceState>;
	model: string;
	modelOptions: ComposerModelOption[];
	thinkingDepth: ComposerThinkingDepth;
	thinkingDepthOptions: ThinkingDepthOption[];
	onModelChange: (nextModel: string) => void;
	onThinkingDepthChange: (nextDepth: ComposerThinkingDepth) => void;
	onSubmitPrompt: (
		prompt: string,
		intent?: WorkbenchChatIntent,
	) => Promise<void>;
	buildComposerLlmSelection: () => WorkbenchLlmSelection | undefined;
	openQuestionnaireWorkspace: (
		message: TaskMessage,
		initialTab?: "questionnaire" | "status",
	) => Promise<void>;
	selectedArtifactContext: ReturnType<typeof buildArtifactContext>;
	selectedArtifact: WorkbenchArtifactRef | null;
	artifactFocus: ArtifactPaneFocus;
	setArtifactFocus: Dispatch<SetStateAction<ArtifactPaneFocus>>;
	setClearedArtifactContextId: Dispatch<SetStateAction<string | null>>;
	artifactPaneOpen: boolean;
	isTodoArtifactOpen: boolean;
	hasTodoArtifact: boolean;
	canStopLatestRun: boolean;
	onOpenBlueprintArtifact: () => Promise<void>;
	isBlueprintArtifactOpen: boolean;
	onOpenReviewArtifact: () => Promise<void>;
	isReviewArtifactOpen: boolean;
	onOpenTodoArtifact: () => void;
	startSessionAndFocusTodo: (sessionId: string) => Promise<void>;
	queueActiveSessionAndFocusTodo: () => Promise<void>;
	addActiveSessionToQueue: () => Promise<void>;
	isActiveImplementationLocked: boolean;
};

export function NightWorkersShellThreadPanel(
	props: NightWorkersShellThreadPanelProps,
) {
	const {
		artifactFocus,
		artifactPaneOpen,
		buildComposerLlmSelection,
		canStopLatestRun,
		hasTodoArtifact,
		isActiveImplementationLocked,
		isBlueprintArtifactOpen,
		isReviewArtifactOpen,
		isTodoArtifactOpen,
		onNavigate,
		queueState,
		routeState,
		selectedArtifact,
		selectedArtifactContext,
		setArtifactFocus,
		setClearedArtifactContextId,
		workspace,
		workspaceRef,
	} = props;
	const [planModeArtifactContext, setPlanModeArtifactContext] =
		useState<WorkbenchArtifactContext | null>(null);
	const effectiveArtifactContext =
		selectedArtifactContext &&
		selectedArtifact?.kind === "plan_mode_workspace" &&
		artifactFocus.type === "artifact"
			? planModeArtifactContext || selectedArtifactContext
			: selectedArtifactContext;
	const handleOpenProjectFile = useCallback(
		(path: string) => {
			setArtifactFocus({ type: "project_tree" });
			workspace.openProjectFile(path);
			if (workspace.activeSessionId) {
				onNavigate({
					kind: "session",
					sessionId: workspace.activeSessionId,
					artifact: {
						kind: "project_tree",
						mode: "tree",
						filePath: path,
					},
				});
			}
		},
		[onNavigate, setArtifactFocus, workspace],
	);

	return (
		<ThreadWorkspace
			activeSession={workspace.activeSession}
			sessionView={workspace.activeSessionView}
			activeProject={workspace.activeProject}
			runs={workspace.activeSessionRuns}
			latestRun={workspace.latestRun}
			taskMessages={workspace.taskMessages}
			latestRunEvents={workspace.latestRunEvents}
			llmUsageSummary={workspace.llmUsageSummary}
			activityEvents={workspace.activityEvents}
			activityArtifacts={workspace.activityArtifacts}
			backgroundProcesses={workspace.backgroundProcesses}
			activeStreamingResponse={workspace.activeStreamingResponse}
			artifactRefs={workspace.activeArtifactRefs}
			activeArtifactContext={effectiveArtifactContext}
			isAgentWorking={workspace.isAgentWorking}
			isAgentThinking={workspace.isAgentThinking}
			realtimeStatus={workspace.realtimeStatus}
			model={props.model}
			modelOptions={props.modelOptions}
			thinkingDepth={props.thinkingDepth}
			onModelChange={props.onModelChange}
			onThinkingDepthChange={props.onThinkingDepthChange}
			thinkingDepthOptions={props.thinkingDepthOptions}
			onSubmitInitialPrompt={props.onSubmitPrompt}
			onSubmitWorkbenchMessage={async (prompt, intent) => {
				if (workspace.activeSession) {
					const existingQuestionnaireMessageIds = designQuestionnaireMessageIds(
						workspace.taskMessages,
					);
					const result = await workspace.sendWorkbenchMessage(
						workspace.activeSession.id,
						prompt,
						intent,
						effectiveArtifactContext,
						buildComposerLlmSelection(),
					);
					if (!result?.run) {
						const latestQuestionnaireMessage = [...(result?.messages || [])]
							.reverse()
							.find(
								(message) =>
									!existingQuestionnaireMessageIds.has(message.id) &&
									isDesignQuestionnaireReadyMessage(message),
							);
						if (latestQuestionnaireMessage) {
							void props.openQuestionnaireWorkspace(
								latestQuestionnaireMessage,
								"questionnaire",
							);
						}
					}
					return;
				}
				await props.onSubmitPrompt(prompt, intent);
			}}
			canStopActiveRun={workspace.isChatSubmitting || canStopLatestRun}
			onStopActiveRun={async () => {
				if (canStopLatestRun && workspace.latestRun?.id) {
					await workspace.stopRun(workspace.latestRun.id);
					return;
				}
				await workspace.cancelChatSubmit();
			}}
			onStopBackgroundProcess={workspace.stopBackgroundProcess}
			onOpenBlueprintArtifact={props.onOpenBlueprintArtifact}
			isBlueprintArtifactOpen={isBlueprintArtifactOpen}
			isBlueprintActionBusy={workspace.isChatSubmitting}
			onOpenReviewArtifact={props.onOpenReviewArtifact}
			isReviewArtifactOpen={isReviewArtifactOpen}
			hasReviewArtifact={Boolean(workspace.activeReviewSession)}
			isReviewActionBusy={workspace.isChatSubmitting}
			onOpenTodoArtifact={props.onOpenTodoArtifact}
			isTodoArtifactOpen={isTodoArtifactOpen}
			hasTodoArtifact={hasTodoArtifact}
			onDeleteSession={() => {
				if (!workspace.activeSession) return;
				workspace.deleteSession(workspace.activeSession.id);
				onNavigate(buildOverviewRoute());
			}}
			onQueueSession={async () => {
				const sessionId = workspaceRef.current.activeSession?.id;
				if (!sessionId) return;
				await props.startSessionAndFocusTodo(sessionId);
			}}
			onRemoveQueueEntry={() => {
				const entryId = workspace.activeSessionView?.queueEntry?.id;
				if (!entryId) return;
				void queueState.removeImplementationQueueEntry(entryId);
			}}
			onRequeueQueueEntry={(note) => {
				const entryId = workspace.activeSessionView?.queueEntry?.id;
				if (!entryId) return;
				void queueState.requeueImplementationQueueEntry(entryId, note);
			}}
			onOpenArtifact={(artifact) => {
				setClearedArtifactContextId(null);
				setArtifactFocus({ type: "artifact", artifact });
				if (workspace.activeSessionId) {
					onNavigate({
						kind: "session",
						sessionId: workspace.activeSessionId,
						artifact: { kind: "artifact_ref", artifactId: artifact.id },
					});
				}
			}}
			onOpenProjectFile={handleOpenProjectFile}
			onClearArtifactContext={() => {
				if (selectedArtifact) setClearedArtifactContextId(selectedArtifact.id);
			}}
			isProjectFilesOpen={artifactFocus.type === "project_tree"}
			onOpenProjectFiles={() => {
				const sessionId = workspace.activeSessionId;
				if (!sessionId) return;
				if (artifactFocus.type === "project_tree") {
					setArtifactFocus({ type: "closed" });
					onNavigate({ kind: "session", sessionId, artifact: null });
					return;
				}
				setClearedArtifactContextId(null);
				setArtifactFocus({ type: "project_tree" });
				onNavigate({
					kind: "session",
					sessionId,
					artifact: { kind: "project_tree", mode: "tree", filePath: null },
				});
			}}
			onGrantExternalPath={async (externalPath) => {
				const project = workspace.activeProject;
				if (!project) return;
				const currentPolicy = asProjectSafetyPolicy(project.safetyPolicy);
				const externalAllowedPaths = Array.from(
					new Set([
						...(currentPolicy.externalAllowedPaths || []),
						externalPath,
					]),
				);
				await workspace.updateProject(project.id, {
					safetyPolicy: {
						...currentPolicy,
						externalAllowedPaths,
					},
				});
			}}
			splitPanel={
				isTodoArtifactOpen ? (
					<TodoListPane todos={workspace.latestRunTodos} />
				) : artifactPaneOpen ? (
					<ArtifactPane
						activeProject={workspace.activeProject}
						activeSessionId={workspace.activeSessionId}
						focusType={
							artifactFocus.type === "project_tree"
								? "project_tree"
								: "artifact"
						}
						selectedArtifact={selectedArtifact}
						taskMessages={workspace.taskMessages}
						activityArtifacts={workspace.activityArtifacts}
						latestRun={workspace.latestRun}
						fileEntries={workspace.projectFileEntries}
						fileEntriesByDirectory={workspace.projectFileEntriesByDirectory}
						expandedDirectories={workspace.expandedProjectDirectories}
						loadingDirectories={workspace.loadingProjectDirectories}
						selectedFile={workspace.selectedProjectFile}
						selectedFilePath={workspace.selectedProjectFilePath}
						isFilesLoading={workspace.isProjectFilesLoading}
						isFileLoading={workspace.isProjectFileLoading}
						projectDiff={workspace.projectDiff}
						isDiffLoading={workspace.isProjectDiffLoading}
						projectArtifactMode={
							routeState.kind === "session" &&
							routeState.artifact?.kind === "project_tree"
								? routeState.artifact.mode
								: "tree"
						}
						onProjectArtifactModeChange={(mode) => {
							if (!workspace.activeSessionId) return;
							onNavigate({
								kind: "session",
								sessionId: workspace.activeSessionId,
								artifact: {
									kind: "project_tree",
									mode,
									filePath: workspace.selectedProjectFilePath,
								},
							});
						}}
						onPlanWorkspaceTabChange={(tab) => {
							if (!workspace.activeSessionId) return;
							if (
								routeState.kind === "session" &&
								routeState.sessionId === workspace.activeSessionId &&
								routeState.artifact?.kind === "plan_mode_workspace" &&
								routeState.artifact.tab === tab
							) {
								return;
							}
							onNavigate({
								kind: "session",
								sessionId: workspace.activeSessionId,
								artifact: { kind: "plan_mode_workspace", tab },
							});
						}}
						onPlanWorkspaceArtifactContextChange={setPlanModeArtifactContext}
						onToggleDirectory={workspace.toggleProjectDirectory}
						onOpenFile={handleOpenProjectFile}
						onRefreshFiles={workspace.refreshProjectFiles}
						onRefreshDiff={workspace.refreshProjectDiff}
						onQueueSession={async () => {
							await props.queueActiveSessionAndFocusTodo();
						}}
						onAddToQueue={props.addActiveSessionToQueue}
						activeReviewSession={workspace.activeReviewSession}
						gitCloseout={workspace.activeGitCloseout}
						onStartReviewRun={workspace.startReviewRun}
						onCommitGitCloseout={workspace.commitRunGitCloseout}
						activeTaskStatus={workspace.activeSession?.status ?? null}
						onCompleteAndArchiveTask={(taskId) =>
							workspace.updateSessionStatus(taskId, "cancelled")
						}
						onRestoreArchivedTask={(taskId) =>
							workspace.updateSessionStatus(taskId, "ready")
						}
						isImplementationLocked={isActiveImplementationLocked}
					/>
				) : undefined
			}
		/>
	);
}
