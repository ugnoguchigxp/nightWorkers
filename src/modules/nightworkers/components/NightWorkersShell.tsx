import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PromptImageInput } from "../../../../shared/prompt-image";
import { useMissionPilotArtifactAutoFocus } from "../../../composition/mission-pilot";
import {
	buildEvidenceCheckArtifact,
	buildEvidenceCheckArtifactFromDescriptor,
	useLatestEvidenceCheckDescriptor,
} from "../../codingAgent";
import { useImplementationQueue } from "../../queue";
import { useReviewModeArtifactAutoFocus } from "../../review";
import { markArtifactOpenStart } from "../artifactPerformance";
import { useWorkspaceAppearanceState } from "../contexts/WorkspaceAppearanceContext";
import {
	useWorkspaceLayoutActions,
	useWorkspaceLayoutState,
} from "../contexts/WorkspaceLayoutContext";
import type { WorkbenchChatIntent } from "../types";
import { buildArtifactContext } from "../workbenchSelectors";
import type { NightWorkersShellProps } from "./NightWorkersShell.types";
import { NightWorkersShellLayout } from "./NightWorkersShellLayout";
import {
	type ArtifactPaneFocus,
	useNightWorkersRouteArtifactSync,
} from "./nightworkers-shell-route-effects";
import { resolveNightWorkersShellRouteModel } from "./nightworkers-shell-route-model";
import {
	isImplementationLockedStatus,
	isMissionProposalApprovalRequiredError,
	resolvePlanWorkspaceInitialTab,
} from "./nightworkers-shell-utils";
import { useNightWorkersComposer } from "./useNightWorkersComposer";
import { useNightWorkersProjectNavigation } from "./useNightWorkersProjectNavigation";
import { useNightWorkersQuestionnaire } from "./useNightWorkersQuestionnaire";

export {
	projectEvaluationDraftStorageKey,
	projectEvaluationTaskPromptDrafts,
} from "./nightworkers-shell-utils";

export function NightWorkersShell(props: NightWorkersShellProps) {
	const { t } = useTranslation();
	const { routeState, workspace } = props;
	const { attributes: appearanceAttributes } = useWorkspaceAppearanceState();
	const { panelSizes } = useWorkspaceLayoutState();
	const { setPanelSizes } = useWorkspaceLayoutActions();
	const initialPanelSizes = useRef(panelSizes);
	const workspaceRef = useRef(workspace);
	const queueState = useImplementationQueue();
	const [selectedPath, setSelectedPath] = useState("");
	const [artifactFocus, setArtifactFocus] = useState<ArtifactPaneFocus>({
		type: "closed",
	});
	const [clearedArtifactContextId, setClearedArtifactContextId] = useState<
		string | null
	>(null);
	const [pilotThoughtDockSessionId, setPilotThoughtDockSessionId] = useState<
		string | null
	>(null);
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
	} = resolveNightWorkersShellRouteModel({ routeState, workspace });
	const createImplementationQueueEntryWithMissionApproval = useCallback(
		async (sessionId: string) => {
			try {
				await queueState.createImplementationQueueEntry(sessionId);
			} catch (error) {
				if (!isMissionProposalApprovalRequiredError(error)) throw error;
				const approved = window.confirm(
					t("nightWorkers.queue.missionProposalApproval"),
				);
				if (!approved) throw error;
				await queueState.createImplementationQueueEntry(sessionId, {
					approveMissionProposal: true,
				});
			}
		},
		[queueState, t],
	);
	const visibleActiveSessionId =
		showSettings ||
		isOverviewActive ||
		projectQueueProject ||
		projectDetailProject
			? null
			: workspace.activeSessionId;
	const isPilotThoughtDockOpen =
		Boolean(workspace.activeSessionId) &&
		pilotThoughtDockSessionId === workspace.activeSessionId;
	const selectedArtifact =
		artifactFocus.type === "artifact" ? artifactFocus.artifact : null;
	const selectedArtifactContext =
		selectedArtifact && selectedArtifact.id !== clearedArtifactContextId
			? buildArtifactContext(selectedArtifact, workspace.activeSessionId)
			: null;
	const artifactPaneOpen = artifactFocus.type !== "closed";
	const isTodoArtifactOpen = artifactFocus.type === "todo";
	const isBlueprintArtifactOpen =
		artifactPaneOpen &&
		(selectedArtifact?.kind === "plan_mode_workspace" ||
			selectedArtifact?.kind === "app_blueprint");
	const isReviewArtifactOpen =
		artifactPaneOpen && selectedArtifact?.kind === "review_status";
	const isEvidenceCheckArtifactOpen =
		artifactPaneOpen && selectedArtifact?.kind === "evidence_check";
	const interactiveReviewRun = isInteractiveReviewRun(
		workspace.latestRun?.contextSnapshot,
	);
	const reviewModeActive = isReviewArtifactOpen || interactiveReviewRun;
	const hasTodoArtifact = Boolean(workspace.activeSession) && !reviewModeActive;
	const isActiveImplementationLocked = isImplementationLockedStatus(
		workspace.activeSession?.status,
	);
	const canStopLatestRun = Boolean(
		workspace.latestRun &&
			[
				"running",
				"context_compiling",
				"compiling_context",
				"finalizing",
			].includes(workspace.latestRun.status),
	);
	const reviewStatusTitle = t("reviewStatus.title");
	const evidenceCheckTitle = t("evidenceCheck.title");
	const evidenceCheckArtifactSummary = t("evidenceCheck.artifact.summary");
	const latestEvidenceCheckQuery = useLatestEvidenceCheckDescriptor(
		workspace.activeSession?.id ?? null,
		Boolean(workspace.isAgentWorking || canStopLatestRun),
	);
	const evidenceCheckArtifact = workspace.activeSession
		? latestEvidenceCheckQuery.data
			? buildEvidenceCheckArtifactFromDescriptor({
					descriptor: latestEvidenceCheckQuery.data,
					title: evidenceCheckTitle,
					summary: evidenceCheckArtifactSummary,
				})
			: workspace.activeArtifactRefs.find(
					(artifact) => artifact.kind === "evidence_check",
				) ||
				buildEvidenceCheckArtifact({
					taskId: workspace.activeSession.id,
					updatedAt: String(
						workspace.activeSession.updatedAt ||
							workspace.activeSession.createdAt,
					),
					taskMessages: workspace.taskMessages,
					title: evidenceCheckTitle,
					summary: evidenceCheckArtifactSummary,
				})
		: null;
	const formatReviewStatusSummary = useCallback(
		(level: string, sectionCount: number) =>
			t("reviewStatus.artifact.summary", {
				level: t(`reviewStatus.level.${level}`, { defaultValue: level }),
				count: sectionCount,
			}),
		[t],
	);

	useEffect(() => {
		workspaceRef.current = workspace;
	}, [workspace]);

	useNightWorkersRouteArtifactSync({
		routeState,
		workspace,
		setArtifactFocus,
		setClearedArtifactContextId,
		reviewStatusTitle,
		formatReviewStatusSummary,
		evidenceCheckTitle,
		evidenceCheckArtifactSummary,
		evidenceCheckArtifact,
	});

	useMissionPilotArtifactAutoFocus({
		activeSession: workspace.activeSession,
		activeArtifactRefs: workspace.activeArtifactRefs,
		latestRun: workspace.latestRun,
		routeState,
		onNavigate: props.onNavigate,
	});

	useReviewModeArtifactAutoFocus({
		activeSession: workspace.activeSession,
		latestRun: workspace.latestRun,
		latestRunTodos: workspace.latestRunTodos,
		routeState,
		onNavigate: props.onNavigate,
	});

	useEffect(() => {
		if (!selectedArtifact) return;
		if (selectedArtifact.taskId !== workspace.activeSessionId) {
			setArtifactFocus({ type: "closed" });
			return;
		}
		if (
			selectedArtifact.kind === "plan_mode_workspace" ||
			selectedArtifact.kind === "review_status" ||
			selectedArtifact.kind === "evidence_check"
		)
			return;
		const stillAvailable = workspace.activeArtifactRefs.some(
			(artifact) => artifact.id === selectedArtifact.id,
		);
		if (!stillAvailable && selectedArtifact.kind !== "diff")
			setArtifactFocus({ type: "closed" });
	}, [
		selectedArtifact,
		workspace.activeArtifactRefs,
		workspace.activeSessionId,
	]);

	const {
		model,
		thinkingDepth,
		composerModelOptions,
		composerThinkingDepthOptions,
		buildComposerLlmSelection,
		clearComposerLlmSelectionOverride,
		handleComposerModelChange,
		handleComposerThinkingDepthChange,
		preserveComposerOverrideSessionIdRef,
	} = useNightWorkersComposer(workspace);

	const submitPrompt = async (
		prompt: string,
		intent: WorkbenchChatIntent = "intake",
		images: PromptImageInput[] = [],
	) => {
		if (!workspace.activeProject && workspace.projects[0]) {
			workspace.setActiveSessionId(
				workspace.sessions.find(
					(s) => s.repositoryId === workspace.projects[0].id,
				)?.id || null,
			);
		}
		if (!workspace.activeSession) {
			const project = workspace.activeProject || workspace.projects[0];
			if (!project) return;
			const session = await workspace.createSession({
				repositoryId: project.id,
				title: "New Session",
				description: "",
				objective: "",
				acceptanceCriteria: "",
			});
			const llmSelection = buildComposerLlmSelection();
			preserveComposerOverrideSessionIdRef.current = llmSelection
				? session.id
				: null;
			workspace.setActiveSessionId(session.id);
			await workspace.sendWorkbenchMessage(
				session.id,
				prompt,
				intent,
				null,
				llmSelection,
				images,
			);
			if (llmSelection) clearComposerLlmSelectionOverride();
			return;
		}
		await workspace.sendWorkbenchMessage(
			workspace.activeSession.id,
			prompt,
			intent,
			null,
			buildComposerLlmSelection(),
			images,
		);
	};
	const handleOpenBlueprintArtifact = useCallback(async () => {
		const sessionId = workspaceRef.current.activeSession?.id;
		if (!sessionId) return;
		if (isBlueprintArtifactOpen) {
			setArtifactFocus({ type: "closed" });
			props.onNavigate({ kind: "session", sessionId, artifact: null });
			return;
		}
		const current = workspaceRef.current;
		const existing =
			current.activeArtifactRefs.find(
				(artifact) => artifact.kind === "plan_mode_workspace",
			) ||
			current.activeArtifactRefs.find(
				(artifact) => artifact.kind === "app_blueprint",
			);
		if (existing) {
			const initialTab =
				existing.kind === "plan_mode_workspace"
					? resolvePlanWorkspaceInitialTab(
							existing.metadata?.initialTab,
							existing,
						)
					: "status";
			const artifact =
				existing.kind === "plan_mode_workspace"
					? {
							...existing,
							metadata: { ...existing.metadata, initialTab },
						}
					: existing;
			markArtifactOpenStart(artifact);
			setClearedArtifactContextId(null);
			setArtifactFocus({ type: "artifact", artifact });
			props.onNavigate({
				kind: "session",
				sessionId,
				artifact:
					artifact.kind === "plan_mode_workspace"
						? { kind: "plan_mode_workspace", tab: initialTab }
						: { kind: "artifact_ref", artifactId: artifact.id },
			});
			return;
		}
	}, [isBlueprintArtifactOpen, props.onNavigate]);
	const handleOpenReviewArtifact = useCallback(async () => {
		const sessionId = workspaceRef.current.activeSession?.id;
		if (!sessionId) return;
		if (isReviewArtifactOpen) {
			setArtifactFocus({ type: "closed" });
			props.onNavigate({ kind: "session", sessionId, artifact: null });
			return;
		}
		const current = workspaceRef.current;
		const existing = current.activeArtifactRefs.find(
			(artifact) => artifact.kind === "review_status",
		);
		const artifact = existing;
		if (!artifact) return;
		markArtifactOpenStart(artifact);
		setClearedArtifactContextId(null);
		setArtifactFocus({ type: "artifact", artifact });
		props.onNavigate({
			kind: "session",
			sessionId,
			artifact: { kind: "review_status" },
		});
	}, [isReviewArtifactOpen, props.onNavigate]);
	const handleOpenEvidenceCheckArtifact = useCallback(async () => {
		const task = workspaceRef.current.activeSession;
		if (!task) return;
		if (isEvidenceCheckArtifactOpen) {
			setArtifactFocus({ type: "closed" });
			props.onNavigate({ kind: "session", sessionId: task.id, artifact: null });
			return;
		}
		let resolvedArtifact = evidenceCheckArtifact;
		if (!resolvedArtifact) {
			const refreshed = await latestEvidenceCheckQuery.refetch();
			if (refreshed.data) {
				resolvedArtifact = buildEvidenceCheckArtifactFromDescriptor({
					descriptor: refreshed.data,
					title: evidenceCheckTitle,
					summary: evidenceCheckArtifactSummary,
				});
			}
		}
		if (!resolvedArtifact) return;
		setClearedArtifactContextId(null);
		markArtifactOpenStart(resolvedArtifact);
		setArtifactFocus({
			type: "artifact",
			artifact: resolvedArtifact,
		});
		props.onNavigate({
			kind: "session",
			sessionId: task.id,
			artifact: { kind: "evidence_check" },
		});
	}, [
		isEvidenceCheckArtifactOpen,
		props.onNavigate,
		evidenceCheckArtifact,
		evidenceCheckArtifactSummary,
		evidenceCheckTitle,
		latestEvidenceCheckQuery,
	]);
	const focusTodoArtifact = useCallback(
		(sessionId: string) => {
			setClearedArtifactContextId(null);
			setArtifactFocus({ type: "todo" });
			props.onNavigate({
				kind: "session",
				sessionId,
				artifact: { kind: "todo" },
			});
		},
		[props.onNavigate],
	);
	const handleOpenTodoArtifact = useCallback(() => {
		const sessionId = workspaceRef.current.activeSession?.id;
		if (!sessionId) return;
		if (artifactFocus.type === "todo") {
			setArtifactFocus({ type: "closed" });
			props.onNavigate({ kind: "session", sessionId, artifact: null });
			return;
		}
		focusTodoArtifact(sessionId);
	}, [artifactFocus.type, focusTodoArtifact, props.onNavigate]);
	const startSessionAndFocusTodo = useCallback(
		async (sessionId: string) => {
			const current = workspaceRef.current;
			const targetSession =
				current.sessions.find((session) => session.id === sessionId) ||
				current.activeSession;
			if (isImplementationLockedStatus(targetSession?.status)) return;
			current.setActiveSessionId(sessionId);
			setClearedArtifactContextId(null);
			setArtifactFocus({ type: "todo" });
			props.onNavigate({
				kind: "session",
				sessionId,
				artifact: { kind: "todo" },
			});
			await current.startRun(sessionId);
			setArtifactFocus({ type: "todo" });
		},
		[props.onNavigate],
	);
	const queueSessionAndFocusTodo = useCallback(
		async (sessionId: string) => {
			const current = workspaceRef.current;
			const targetSession =
				current.sessions.find((session) => session.id === sessionId) ||
				current.activeSession;
			if (isImplementationLockedStatus(targetSession?.status)) return;
			current.setActiveSessionId(sessionId);
			await createImplementationQueueEntryWithMissionApproval(sessionId);
			setClearedArtifactContextId(null);
			setArtifactFocus({ type: "todo" });
			props.onNavigate({
				kind: "session",
				sessionId,
				artifact: { kind: "todo" },
			});
		},
		[createImplementationQueueEntryWithMissionApproval, props.onNavigate],
	);
	const queueActiveSessionAndFocusTodo = useCallback(async () => {
		const sessionId = workspaceRef.current.activeSession?.id;
		if (!sessionId) return;
		await queueSessionAndFocusTodo(sessionId);
	}, [queueSessionAndFocusTodo]);
	const addActiveSessionToQueue = useCallback(async () => {
		const activeSession = workspaceRef.current.activeSession;
		if (isImplementationLockedStatus(activeSession?.status)) return;
		const sessionId = activeSession?.id;
		if (!sessionId) return;
		await createImplementationQueueEntryWithMissionApproval(sessionId);
	}, [createImplementationQueueEntryWithMissionApproval]);
	const {
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
	} = useNightWorkersProjectNavigation({
		workspaceRef,
		routeState,
		onNavigate: props.onNavigate,
		onOpenFolderBrowser: props.onOpenFolderBrowser,
		selectedPath,
		setArtifactFocus,
	});

	const { openQuestionnaireWorkspace } = useNightWorkersQuestionnaire({
		routeState,
		workspace,
		onNavigate: props.onNavigate,
		setArtifactFocus,
		setClearedArtifactContextId,
	});

	return (
		<NightWorkersShellLayout
			shellProps={props}
			routeModel={{
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
			}}
			queueState={queueState}
			appearanceAttributes={appearanceAttributes}
			initialPanelSizes={initialPanelSizes}
			setPanelSizes={setPanelSizes}
			visibleActiveSessionId={visibleActiveSessionId}
			isPilotThoughtDockOpen={isPilotThoughtDockOpen}
			setPilotThoughtDockSessionId={setPilotThoughtDockSessionId}
			selectedPath={selectedPath}
			setSelectedPath={setSelectedPath}
			onSelectSession={handleSelectSession}
			onCreateSession={handleCreateSession}
			onDeleteProject={handleDeleteProject}
			onToggleProject={handleToggleProject}
			onOpenProjectQueue={handleOpenProjectQueue}
			onOpenProjectDetail={handleOpenProjectDetail}
			onOpenOverview={handleOpenOverview}
			onOpenFolderBrowser={handleOpenFolderBrowser}
			onQueueSession={createImplementationQueueEntryWithMissionApproval}
			onQueueSessionAndFocusTodo={queueSessionAndFocusTodo}
			onEvaluationTasksCreated={handleProjectEvaluationTasksCreated}
			onMissionTaskCandidatesCreated={handleProjectDetailTasksCreated}
			threadPanelProps={{
				workspace,
				queueState,
				routeState,
				onNavigate: props.onNavigate,
				workspaceRef,
				model,
				modelOptions: composerModelOptions,
				thinkingDepth,
				thinkingDepthOptions: composerThinkingDepthOptions,
				onModelChange: handleComposerModelChange,
				onThinkingDepthChange: handleComposerThinkingDepthChange,
				onSubmitPrompt: submitPrompt,
				buildComposerLlmSelection,
				onComposerLlmSelectionSubmitted: clearComposerLlmSelectionOverride,
				openQuestionnaireWorkspace,
				selectedArtifactContext,
				selectedArtifact,
				artifactFocus,
				setArtifactFocus,
				setClearedArtifactContextId,
				artifactPaneOpen,
				isTodoArtifactOpen,
				hasTodoArtifact,
				hideTodoArtifact: reviewModeActive,
				hasEvidenceCheckArtifact: Boolean(evidenceCheckArtifact),
				canStopLatestRun,
				onOpenBlueprintArtifact: handleOpenBlueprintArtifact,
				isBlueprintArtifactOpen,
				onOpenReviewArtifact: handleOpenReviewArtifact,
				isReviewArtifactOpen,
				onOpenEvidenceCheckArtifact: handleOpenEvidenceCheckArtifact,
				isEvidenceCheckArtifactOpen,
				onOpenTodoArtifact: handleOpenTodoArtifact,
				startSessionAndFocusTodo,
				queueActiveSessionAndFocusTodo,
				addActiveSessionToQueue,
				isActiveImplementationLocked,
				isPilotThoughtDockOpen,
				onTogglePilotThoughtDock: () =>
					setPilotThoughtDockSessionId((current) =>
						current === workspace.activeSessionId
							? null
							: workspace.activeSessionId,
					),
			}}
		/>
	);
}

function isInteractiveReviewRun(contextSnapshot: unknown) {
	if (
		!contextSnapshot ||
		typeof contextSnapshot !== "object" ||
		Array.isArray(contextSnapshot)
	) {
		return false;
	}
	const snapshot = contextSnapshot as Record<string, unknown>;
	if (snapshot.executionMode !== "review") return false;
	const reviewRuntime = snapshot.reviewRuntime;
	return (
		Boolean(reviewRuntime) &&
		typeof reviewRuntime === "object" &&
		!Array.isArray(reviewRuntime) &&
		(reviewRuntime as Record<string, unknown>).contextPolicy === "codex_default"
	);
}
