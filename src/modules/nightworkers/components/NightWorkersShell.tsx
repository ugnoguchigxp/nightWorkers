import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PromptImageInput } from "../../../../shared/prompt-image";
import { playMissionPilotTask } from "../../missionPilot";
import { useImplementationQueue } from "../../queue";
import { markArtifactOpenStart } from "../artifactPerformance";
import { useWorkspaceAppearanceState } from "../contexts/WorkspaceAppearanceContext";
import {
	useWorkspaceLayoutActions,
	useWorkspaceLayoutState,
} from "../contexts/WorkspaceLayoutContext";
import type { WorkbenchArtifactRef, WorkbenchChatIntent } from "../types";
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
					"この Mission proposal は Queue 投入前の明示承認が必要です。承認して Queue に追加しますか？",
				);
				if (!approved) throw error;
				await queueState.createImplementationQueueEntry(sessionId, {
					approveMissionProposal: true,
				});
			}
		},
		[queueState],
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
	const isTestModeArtifactOpen =
		artifactPaneOpen && selectedArtifact?.kind === "test_mode";
	const hasTodoArtifact = Boolean(workspace.activeSession);
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
	const testModeTitle = t("testMode.title");
	const testModeArtifactSummary = t("testMode.artifact.summary");
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
		testModeTitle,
		testModeArtifactSummary,
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
			selectedArtifact.kind === "test_mode"
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
		let artifact = existing;
		if (!artifact && current.latestRun?.id) {
			const pendingArtifact: WorkbenchArtifactRef = {
				id: `review-status-pending-${current.latestRun.id}`,
				taskId: sessionId,
				runId: current.latestRun.id,
				kind: "review_status",
				title: reviewStatusTitle,
				summary: reviewStatusTitle,
				source: {
					type: "review_result",
					reviewId: `pending-${current.latestRun.id}`,
				},
				createdAt: new Date().toISOString(),
				metadata: { reviewSessionLoading: true },
			};
			markArtifactOpenStart(pendingArtifact);
			setClearedArtifactContextId(null);
			setArtifactFocus({ type: "artifact", artifact: pendingArtifact });
			props.onNavigate({
				kind: "session",
				sessionId,
				artifact: { kind: "review_status" },
			});
			const detail = await current.startReviewSession(current.latestRun.id);
			artifact = {
				id: `review-status-${detail.session.id}`,
				taskId: detail.session.taskId,
				runId: detail.session.runId,
				kind: "review_status",
				title: reviewStatusTitle,
				summary: formatReviewStatusSummary(
					detail.recommendation.level,
					detail.statusArtifact.sections.length,
				),
				source: { type: "review_result", reviewId: detail.session.id },
				createdAt: detail.session.updatedAt,
				metadata: { reviewSession: detail },
			};
		}
		if (!artifact) return;
		markArtifactOpenStart(artifact);
		setClearedArtifactContextId(null);
		setArtifactFocus({ type: "artifact", artifact });
		props.onNavigate({
			kind: "session",
			sessionId,
			artifact: { kind: "review_status" },
		});
	}, [
		formatReviewStatusSummary,
		isReviewArtifactOpen,
		props.onNavigate,
		reviewStatusTitle,
	]);
	const handleOpenTestModeArtifact = useCallback(() => {
		const task = workspaceRef.current.activeSession;
		if (!task) return;
		if (isTestModeArtifactOpen) {
			setArtifactFocus({ type: "closed" });
			props.onNavigate({ kind: "session", sessionId: task.id, artifact: null });
			return;
		}
		setClearedArtifactContextId(null);
		const artifact = {
			id: `test-mode-${task.id}`,
			taskId: task.id,
			kind: "test_mode" as const,
			title: testModeTitle,
			summary: testModeArtifactSummary,
			source: { type: "test_mode" as const },
			createdAt: String(task.updatedAt || task.createdAt),
		};
		markArtifactOpenStart(artifact);
		setArtifactFocus({
			type: "artifact",
			artifact,
		});
		props.onNavigate({
			kind: "session",
			sessionId: task.id,
			artifact: { kind: "test_mode" },
		});
	}, [
		isTestModeArtifactOpen,
		props.onNavigate,
		testModeArtifactSummary,
		testModeTitle,
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
			const missionPilot = targetSession?.missionPilot;
			if (
				missionPilot?.desiredState === "stopped" &&
				missionPilot.phase === "attention" &&
				missionPilot.queueHandoff
			) {
				const response = await playMissionPilotTask(
					sessionId,
					missionPilot.version,
				);
				if (!response.ok) throw new Error(await response.text());
				await current.refreshProjectList();
			} else {
				await createImplementationQueueEntryWithMissionApproval(sessionId);
			}
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
				canStopLatestRun,
				onOpenBlueprintArtifact: handleOpenBlueprintArtifact,
				isBlueprintArtifactOpen,
				onOpenReviewArtifact: handleOpenReviewArtifact,
				isReviewArtifactOpen,
				onOpenTestModeArtifact: handleOpenTestModeArtifact,
				isTestModeArtifactOpen,
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
