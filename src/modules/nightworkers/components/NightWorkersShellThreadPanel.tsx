import {
	type Dispatch,
	type MutableRefObject,
	type SetStateAction,
	useCallback,
	useState,
} from "react";
import type { PromptImageInput } from "../../../../shared/prompt-image";
import type { useImplementationQueue } from "../../queue";
import { CodexTodoTracePane } from "../../todo/CodexTodoTracePane";
import { markArtifactOpenStart } from "../artifactPerformance";
import { projectLatestCodexTodoTrace } from "../codexTodoTrace";
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
		images?: PromptImageInput[],
	) => Promise<void>;
	buildComposerLlmSelection: () => WorkbenchLlmSelection | undefined;
	onComposerLlmSelectionSubmitted: () => void;
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
	onOpenTestModeArtifact: () => void;
	isTestModeArtifactOpen: boolean;
	onOpenTodoArtifact: () => void;
	startSessionAndFocusTodo: (sessionId: string) => Promise<void>;
	queueActiveSessionAndFocusTodo: () => Promise<void>;
	addActiveSessionToQueue: () => Promise<void>;
	isActiveImplementationLocked: boolean;
	isPilotThoughtDockOpen: boolean;
	onTogglePilotThoughtDock: () => void;
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
	const codexTodoTrace = projectLatestCodexTodoTrace(workspace.latestRunEvents);
	const codexRunActive = [
		"running",
		"context_compiling",
		"compiling_context",
		"finalizing",
	].includes(workspace.latestRun?.status || "");
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
	const handleToggleProjectFiles = useCallback(() => {
		const sessionId = workspaceRef.current.activeSessionId;
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
	}, [
		artifactFocus.type,
		onNavigate,
		setArtifactFocus,
		setClearedArtifactContextId,
		workspaceRef,
	]);
	const submitReviewPrompt = useCallback(
		async (prompt: string) => {
			const current = workspaceRef.current;
			const sessionId = current.activeSession?.id;
			if (!sessionId) return false;
			const llmSelection = buildComposerLlmSelection();
			const result = await current.sendWorkbenchMessage(
				sessionId,
				prompt,
				"review_followup",
				effectiveArtifactContext,
				llmSelection,
			);
			if (llmSelection && result) props.onComposerLlmSelectionSubmitted();
			return Boolean(result);
		},
		[
			buildComposerLlmSelection,
			effectiveArtifactContext,
			props.onComposerLlmSelectionSubmitted,
			workspaceRef,
		],
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
			onSubmitInitialPrompt={(prompt, images) =>
				props.onSubmitPrompt(prompt, undefined, images)
			}
			onSubmitWorkbenchMessage={async (prompt, intent, images) => {
				if (workspace.activeSession) {
					const existingQuestionnaireMessageIds = designQuestionnaireMessageIds(
						workspace.taskMessages,
					);
					const llmSelection = buildComposerLlmSelection();
					const result = await workspace.sendWorkbenchMessage(
						workspace.activeSession.id,
						prompt,
						intent,
						effectiveArtifactContext,
						llmSelection,
						images,
					);
					if (llmSelection && result) props.onComposerLlmSelectionSubmitted();
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
				await props.onSubmitPrompt(prompt, intent, images);
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
			onOpenTestModeArtifact={props.onOpenTestModeArtifact}
			isTestModeArtifactOpen={props.isTestModeArtifactOpen}
			hasReviewArtifact={workspace.activeArtifactRefs.some(
				(artifact) => artifact.kind === "review_status",
			)}
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
				markArtifactOpenStart(artifact);
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
			isPilotThoughtDockOpen={props.isPilotThoughtDockOpen}
			onTogglePilotThoughtDock={props.onTogglePilotThoughtDock}
			onOpenProjectFiles={handleToggleProjectFiles}
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
					codexTodoTrace.length > 0 ? (
						<CodexTodoTracePane
							items={codexTodoTrace}
							runActive={codexRunActive}
						/>
					) : (
						<TodoListPane
							todos={workspace.latestRunTodos}
							allowRunningTodoResume={
								workspace.latestRun?.status === "needs_human" &&
								isHostLimitedRuntimePause(workspace.latestRun.contextSnapshot)
							}
							isResuming={workspace.isResumingTodo}
							onResume={async (todoId, expectedTodoRevision, userContext) => {
								const runId = workspace.latestRun?.id;
								if (!runId) return;
								await workspace.resumeTodo({
									runId,
									todoId,
									expectedTodoRevision,
									userContext,
								});
							}}
						/>
					)
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
						latestRunEvents={workspace.latestRunEvents}
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
						onCommitGitCloseout={workspace.commitRunGitCloseout}
						onPushGitCloseout={workspace.pushRunGitCloseout}
						activeTaskStatus={workspace.activeSession?.status ?? null}
						onCompleteAndArchiveTask={(taskId) =>
							workspace.archiveCompletedSession(taskId)
						}
						onRestoreArchivedTask={(taskId) =>
							workspace.restoreArchivedSession(taskId)
						}
						isImplementationLocked={isActiveImplementationLocked}
						onSubmitReviewPrompt={submitReviewPrompt}
						isReviewPromptDisabled={workspace.isAgentThinking}
					/>
				) : undefined
			}
		/>
	);
}

function isHostLimitedRuntimePause(value: unknown) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const pause = (value as Record<string, unknown>).runtimePause;
	return Boolean(
		pause &&
			typeof pause === "object" &&
			!Array.isArray(pause) &&
			(pause as Record<string, unknown>).version === 1 &&
			(pause as Record<string, unknown>).kind === "host_limit" &&
			(pause as Record<string, unknown>).stoppedBy === "budget" &&
			(pause as Record<string, unknown>).resumableRunningTodo === true,
	);
}
