import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Group, Panel, Separator } from "react-resizable-panels";
import { toDeepRecord } from "../../../../shared/json-record";
import { fetchDesignQuestionnaireSession } from "../../questionnaire";
import {
	ImplementationQueueScreen,
	ProjectQueueScreen,
	useImplementationQueue,
} from "../../queue";
import { fetchPlanModeWorkspace } from "../../specification";
import { markArtifactOpenStart } from "../artifactPerformance";
import { useWorkspaceAppearanceState } from "../contexts/WorkspaceAppearanceContext";
import {
	useWorkspaceLayoutActions,
	useWorkspaceLayoutState,
} from "../contexts/WorkspaceLayoutContext";
import {
	isActiveSessionWorkbenchRoute,
	shouldAutoOpenPlanArtifact,
} from "../planArtifactVisibility";
import { buildOverviewRoute } from "../routing/workbench-route-state";
import type {
	ComposerThinkingDepth,
	Task,
	TaskMessage,
	ThinkingDepthOption,
	WorkbenchChatIntent,
} from "../types";
import {
	buildArtifactContext,
	buildPlanModeWorkspaceArtifactRef,
} from "../workbenchSelectors";
import type { NightWorkersShellProps } from "./NightWorkersShell.types";
import {
	NightWorkersFolderBrowser,
	NightWorkersRouteNotFoundScreen,
} from "./NightWorkersShellAuxiliary";
import { NightWorkersShellThreadPanel } from "./NightWorkersShellThreadPanel";
import {
	type ArtifactPaneFocus,
	useNightWorkersRouteArtifactSync,
} from "./nightworkers-shell-route-effects";
import { resolveNightWorkersShellRouteModel } from "./nightworkers-shell-route-model";
import {
	COMPOSER_THINKING_DEPTH_OPTIONS,
	findComposerRouteTargetByKey,
	isDesignQuestionnaireReadyMessage,
	isImplementationLockedStatus,
	isMissionProposalApprovalRequiredError,
	isThinkingModel,
	modelTargetKey,
	parseModelTargetKey,
	projectEvaluationDraftStorageKey,
	projectEvaluationTaskPromptDrafts,
	resolveComposerRouteTarget,
	resolveCurrentProviderModel,
	resolvePlanWorkspaceInitialTab,
} from "./nightworkers-shell-utils";
import { OverviewScreen } from "./OverviewScreen";
import { ProjectDetailScreen } from "./ProjectDetailScreen";
import { ProjectSidebar } from "./ProjectSidebar";
import { BlueprintShowcaseButton, SettingsButton } from "./SettingsButton";
import { SettingsScreen } from "./SettingsScreen";

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
	const openedQuestionnaireMessageIdsRef = useRef<Set<string>>(new Set());
	const openingQuestionnaireMessageIdsRef = useRef<Set<string>>(new Set());
	const previousActiveSessionIdRef = useRef<string | null>(null);
	const userSelectedComposerModelRef = useRef(false);
	const [selectedPath, setSelectedPath] = useState("");
	const [model, setModel] = useState("");
	const [thinkingDepth, setThinkingDepth] = useState<ComposerThinkingDepth>("");
	const [artifactFocus, setArtifactFocus] = useState<ArtifactPaneFocus>({
		type: "closed",
	});
	const [clearedArtifactContextId, setClearedArtifactContextId] = useState<
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
	const activeSessionId = workspace.activeSessionId;
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

	if (previousActiveSessionIdRef.current !== activeSessionId) {
		previousActiveSessionIdRef.current = activeSessionId;
		userSelectedComposerModelRef.current = false;
	}

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

	const currentProviderModel = resolveCurrentProviderModel(workspace);
	const composerModelOptions = useMemo(() => {
		const endpoints = workspace.llmSettings?.providerEndpoints || [];
		const options = endpoints
			.filter((endpoint) =>
				endpoint.kind === "codex"
					? workspace.llmSettings?.CODEX_ENABLED
					: endpoint.enabled,
			)
			.flatMap((endpoint) =>
				endpoint.models.map((endpointModel) => ({
					value: modelTargetKey({
						providerEndpointId: endpoint.id,
						model: endpointModel,
					}),
					label:
						endpoint.modelDisplayNames?.[endpointModel]?.trim() ||
						`${endpointModel} (${endpoint.name})`,
				})),
			);
		return options.length ? options : workspace.providerModelOptions;
	}, [workspace.llmSettings, workspace.providerModelOptions]);
	const composerModelOptionKeys = useMemo(
		() => new Set(composerModelOptions.map((option) => option.value)),
		[composerModelOptions],
	);
	const preferredRouteTarget = useMemo(
		() =>
			resolveComposerRouteTarget(
				workspace.llmSettings?.roleRoutes,
				composerModelOptionKeys,
			),
		[composerModelOptionKeys, workspace.llmSettings?.roleRoutes],
	);
	const selectedModelTarget = parseModelTargetKey(model);
	const selectedComposerModel =
		selectedModelTarget?.model || model || currentProviderModel || "";
	const selectedComposerModelSupportsThinking = isThinkingModel(
		selectedComposerModel,
	);
	const composerThinkingDepthOptions: ThinkingDepthOption[] =
		selectedComposerModelSupportsThinking
			? COMPOSER_THINKING_DEPTH_OPTIONS
			: [];

	useEffect(() => {
		if (!composerModelOptions.length) {
			if (
				!userSelectedComposerModelRef.current &&
				currentProviderModel &&
				model !== currentProviderModel
			) {
				setModel(currentProviderModel);
			}
			return;
		}
		const currentModelIsAvailable = composerModelOptionKeys.has(model);
		if (userSelectedComposerModelRef.current && currentModelIsAvailable) return;
		if (!currentModelIsAvailable) userSelectedComposerModelRef.current = false;
		const nextModel = preferredRouteTarget
			? modelTargetKey(preferredRouteTarget)
			: composerModelOptions[0].value;
		if (model !== nextModel) setModel(nextModel);
		const nextThinkingDepth =
			preferredRouteTarget && isThinkingModel(preferredRouteTarget.model)
				? (preferredRouteTarget.thinkingDepth ?? "")
				: "";
		if (thinkingDepth !== nextThinkingDepth)
			setThinkingDepth(nextThinkingDepth);
	}, [
		composerModelOptionKeys,
		composerModelOptions,
		currentProviderModel,
		model,
		preferredRouteTarget,
		thinkingDepth,
	]);

	useEffect(() => {
		if (selectedComposerModelSupportsThinking) return;
		setThinkingDepth("");
	}, [selectedComposerModelSupportsThinking]);

	const buildComposerLlmSelection = () => {
		if (!userSelectedComposerModelRef.current) return undefined;
		const target = parseModelTargetKey(model);
		const selected = target || { providerEndpointId: "", model };
		if (!selected.model) return undefined;
		return {
			model: selected.model,
			providerEndpointId: selected.providerEndpointId || undefined,
			thinkingDepth: isThinkingModel(selected.model)
				? thinkingDepth
				: undefined,
		};
	};
	const handleComposerModelChange = useCallback(
		(nextModel: string) => {
			userSelectedComposerModelRef.current = true;
			setModel(nextModel);
			const routeTarget = findComposerRouteTargetByKey(
				workspace.llmSettings?.roleRoutes,
				nextModel,
			);
			const parsedTarget = parseModelTargetKey(nextModel);
			const nextTargetModel =
				routeTarget?.model || parsedTarget?.model || nextModel;
			const nextThinkingDepth =
				routeTarget && isThinkingModel(nextTargetModel)
					? (routeTarget.thinkingDepth ?? "")
					: "";
			setThinkingDepth(nextThinkingDepth);
		},
		[workspace.llmSettings?.roleRoutes],
	);
	const handleComposerThinkingDepthChange = useCallback(
		(nextThinkingDepth: ComposerThinkingDepth) => {
			userSelectedComposerModelRef.current = true;
			setThinkingDepth(nextThinkingDepth);
		},
		[],
	);

	const submitPrompt = async (
		prompt: string,
		intent: WorkbenchChatIntent = "intake",
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
			workspace.setActiveSessionId(session.id);
			const llmSelection = buildComposerLlmSelection();
			userSelectedComposerModelRef.current = false;
			await workspace.sendWorkbenchMessage(
				session.id,
				prompt,
				intent,
				null,
				llmSelection,
			);
			return;
		}
		await workspace.sendWorkbenchMessage(
			workspace.activeSession.id,
			prompt,
			intent,
			null,
			buildComposerLlmSelection(),
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
			setClearedArtifactContextId(null);
			setArtifactFocus({ type: "todo" });
			props.onNavigate({
				kind: "session",
				sessionId,
				artifact: { kind: "todo" },
			});
			await createImplementationQueueEntryWithMissionApproval(sessionId);
			setArtifactFocus({ type: "todo" });
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
	const handleSelectSession = useCallback(
		(sessionId: string | null) => {
			setArtifactFocus({ type: "closed" });
			workspaceRef.current.setActiveSessionId(sessionId);
			props.onNavigate(
				sessionId
					? { kind: "session", sessionId, artifact: null }
					: buildOverviewRoute(),
			);
		},
		[props.onNavigate],
	);
	const handleCreateSession = useCallback(
		async (repositoryId: string) => {
			const session = await workspaceRef.current.createSession({
				repositoryId,
				title: "New Session",
				description: "",
				objective: "",
				acceptanceCriteria: "",
			});
			workspaceRef.current.setActiveSessionId(session.id);
			props.onNavigate({
				kind: "session",
				sessionId: session.id,
				artifact: null,
			});
		},
		[props.onNavigate],
	);
	const handleDeleteProject = useCallback(
		(projectId: string) => {
			workspaceRef.current.deleteProject(projectId);
			if (
				(routeState.kind === "project_queue" ||
					routeState.kind === "project_detail") &&
				routeState.projectId === projectId
			) {
				props.onNavigate(buildOverviewRoute());
			}
		},
		[props.onNavigate, routeState],
	);
	const handleToggleProject = useCallback(
		(projectId: string) =>
			workspaceRef.current.setExpandedProjects((prev) => ({
				...prev,
				[projectId]: !prev[projectId],
			})),
		[],
	);
	const handleOpenFolderBrowser = useCallback(() => {
		props.onOpenFolderBrowser();
		void workspaceRef.current.fetchDirectories(selectedPath || undefined);
	}, [props.onOpenFolderBrowser, selectedPath]);
	const handleOpenOverview = useCallback(() => {
		setArtifactFocus({ type: "closed" });
		props.onNavigate(buildOverviewRoute());
	}, [props.onNavigate]);
	const handleOpenProjectQueue = useCallback(
		(projectId: string) => {
			setArtifactFocus({ type: "closed" });
			props.onNavigate({ kind: "project_queue", projectId, view: "board" });
		},
		[props.onNavigate],
	);
	const handleOpenProjectDetail = useCallback(
		(projectId: string) => {
			setArtifactFocus({ type: "closed" });
			props.onNavigate({ kind: "project_detail", projectId, tab: "overview" });
		},
		[props.onNavigate],
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
			await workspaceRef.current.refreshProjectList();
			setArtifactFocus({ type: "closed" });
			workspaceRef.current.setActiveSessionId(firstTask.id);
			props.onNavigate({
				kind: "session",
				sessionId: firstTask.id,
				artifact: null,
			});
		},
		[props.onNavigate],
	);
	const handleProjectDetailTasksCreated = useCallback(async (tasks: Task[]) => {
		if (tasks.length === 0) return;
		await workspaceRef.current.refreshProjectList();
	}, []);

	const waitForQuestionnaireWorkspaceReady = useCallback(
		async (message: TaskMessage) => {
			const sessionId = String(
				toDeepRecord(message.metadataJson).questionnaireSessionId || "",
			);
			if (!sessionId) return false;
			for (let attempt = 0; attempt < 6; attempt += 1) {
				const [workspaceRes, sessionRes] = await Promise.all([
					fetchPlanModeWorkspace(message.taskId),
					fetchDesignQuestionnaireSession(message.taskId, sessionId),
				]);
				if (workspaceRes.ok && sessionRes.ok) {
					const questionnaireSession = await sessionRes.json();
					if (questionnaireSession?.questionSets?.length) return true;
				}
				await new Promise((resolve) => setTimeout(resolve, 250));
			}
			return false;
		},
		[],
	);

	const openQuestionnaireWorkspace = useCallback(
		async (
			message: TaskMessage,
			initialTab: "questionnaire" | "status" = "questionnaire",
			shouldOpen: () => boolean = () => true,
		) => {
			if (openingQuestionnaireMessageIdsRef.current.has(message.id)) return;
			openingQuestionnaireMessageIdsRef.current.add(message.id);
			try {
				const ready = await waitForQuestionnaireWorkspaceReady(message);
				if (!ready || !shouldOpen()) return;
				openedQuestionnaireMessageIdsRef.current.add(message.id);
				setClearedArtifactContextId(null);
				setArtifactFocus({
					type: "artifact",
					artifact: buildPlanModeWorkspaceArtifactRef(message, initialTab),
				});
				props.onNavigate({
					kind: "session",
					sessionId: message.taskId,
					artifact: { kind: "plan_mode_workspace", tab: initialTab },
				});
			} finally {
				openingQuestionnaireMessageIdsRef.current.delete(message.id);
			}
		},
		[props.onNavigate, waitForQuestionnaireWorkspaceReady],
	);

	useEffect(() => {
		if (!isActiveSessionWorkbenchRoute(routeState, workspace.activeSessionId))
			return;
		const latestQuestionnaireMessage = [...workspace.taskMessages]
			.reverse()
			.find(
				(message) =>
					message.taskId === workspace.activeSessionId &&
					isDesignQuestionnaireReadyMessage(message),
			);
		if (!latestQuestionnaireMessage) return;
		if (
			!shouldAutoOpenPlanArtifact({
				activeSession: workspace.activeSession,
				sessionView: workspace.activeSessionView,
				latestRun: workspace.latestRun,
				isChatSubmitting: workspace.isChatSubmitting,
				hasPlanArtifact: true,
			})
		) {
			return;
		}
		if (
			openedQuestionnaireMessageIdsRef.current.has(
				latestQuestionnaireMessage.id,
			)
		)
			return;
		let cancelled = false;
		void openQuestionnaireWorkspace(
			latestQuestionnaireMessage,
			"status",
			() => !cancelled,
		);
		return () => {
			cancelled = true;
		};
	}, [
		openQuestionnaireWorkspace,
		routeState,
		workspace.activeSession,
		workspace.activeSessionId,
		workspace.activeSessionView,
		workspace.isChatSubmitting,
		workspace.latestRun,
		workspace.taskMessages,
	]);

	return (
		<div
			className="nightworkers-shell min-h-0 overflow-hidden bg-[#111827] text-slate-100"
			{...appearanceAttributes}
		>
			<Group
				className="nightworkers-workbench-group min-h-0"
				defaultLayout={{
					"nightworkers-sidebar": initialPanelSizes.current[0],
					"nightworkers-chat": initialPanelSizes.current[1],
				}}
				onLayoutChanged={(layout) =>
					setPanelSizes([
						layout["nightworkers-sidebar"],
						layout["nightworkers-chat"],
					])
				}
				orientation="horizontal"
			>
				<Panel
					id="nightworkers-sidebar"
					className="h-full min-h-0"
					defaultSize={`${initialPanelSizes.current[0]}%`}
					minSize="18%"
					maxSize="42%"
				>
					<ProjectSidebar
						projects={workspace.projects}
						groupedSessions={workspace.groupedSessionViews}
						isProjectsLoading={workspace.isProjectsLoading}
						activeSessionId={visibleActiveSessionId}
						expandedProjects={workspace.expandedProjects}
						onSelectSession={handleSelectSession}
						onCreateSession={handleCreateSession}
						onDeleteProject={handleDeleteProject}
						onToggleProject={handleToggleProject}
						onOpenProjectQueue={handleOpenProjectQueue}
						activeProjectQueueId={projectQueueProjectId}
						onOpenProjectDetail={handleOpenProjectDetail}
						activeProjectDetailId={projectDetailProjectId}
						onOpenOverview={handleOpenOverview}
						isOverviewActive={isOverviewActive}
						onOpenFolderBrowser={handleOpenFolderBrowser}
						onRefreshProjects={() => void workspace.refreshProjectList()}
						isProjectListRefreshing={workspace.isProjectListRefreshing}
					/>
				</Panel>
				<Separator className="nightworkers-panel-resize-handle" />
				<Panel
					id="nightworkers-chat"
					className="h-full min-h-0"
					defaultSize={`${initialPanelSizes.current[1]}%`}
					minSize="58%"
				>
					{showSettings ? (
						<SettingsScreen
							activeProject={workspace.activeProject}
							activeSection={
								routeState.kind === "settings" ? routeState.section : "general"
							}
							onSectionChange={(section) =>
								props.onNavigate({ kind: "settings", section })
							}
							onClose={() => props.onNavigate(buildOverviewRoute())}
						/>
					) : isOverviewActive ? (
						<OverviewScreen
							projects={workspace.projects}
							range={routeState.kind === "overview" ? routeState.range : "30d"}
							projectFilterId={
								routeState.kind === "overview" ? routeState.projectId : null
							}
							onRangeChange={(range) =>
								props.onNavigate({
									kind: "overview",
									range,
									projectId:
										routeState.kind === "overview"
											? routeState.projectId
											: null,
								})
							}
							onProjectFilterChange={(projectId) =>
								props.onNavigate({
									kind: "overview",
									range:
										routeState.kind === "overview" ? routeState.range : "30d",
									projectId,
								})
							}
							onOpenSession={(sessionId) => handleSelectSession(sessionId)}
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
							onOpenOverview={handleOpenOverview}
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
								props.onNavigate({
									kind: "project_queue",
									projectId: projectQueueProject.id,
									view,
								})
							}
							onOpenSession={(sessionId) => handleSelectSession(sessionId)}
							onQueueSession={createImplementationQueueEntryWithMissionApproval}
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
								props.onNavigate({
									kind: "project_detail",
									projectId: projectDetailProject.id,
									tab,
								})
							}
							onOpenSession={(sessionId) => handleSelectSession(sessionId)}
							onEvaluationTasksCreated={handleProjectEvaluationTasksCreated}
							onMissionTaskCandidatesCreated={handleProjectDetailTasksCreated}
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
								props.onNavigate({ kind: "global_queue", projectId })
							}
							onOpenSession={(sessionId) => handleSelectSession(sessionId)}
							onQueueSession={queueSessionAndFocusTodo}
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
							onOpenOverview={handleOpenOverview}
						/>
					) : (
						<NightWorkersShellThreadPanel
							workspace={workspace}
							queueState={queueState}
							routeState={routeState}
							onNavigate={props.onNavigate}
							workspaceRef={workspaceRef}
							model={model}
							modelOptions={composerModelOptions}
							thinkingDepth={thinkingDepth}
							thinkingDepthOptions={composerThinkingDepthOptions}
							onModelChange={handleComposerModelChange}
							onThinkingDepthChange={handleComposerThinkingDepthChange}
							onSubmitPrompt={submitPrompt}
							buildComposerLlmSelection={buildComposerLlmSelection}
							openQuestionnaireWorkspace={openQuestionnaireWorkspace}
							selectedArtifactContext={selectedArtifactContext}
							selectedArtifact={selectedArtifact}
							artifactFocus={artifactFocus}
							setArtifactFocus={setArtifactFocus}
							setClearedArtifactContextId={setClearedArtifactContextId}
							artifactPaneOpen={artifactPaneOpen}
							isTodoArtifactOpen={isTodoArtifactOpen}
							hasTodoArtifact={hasTodoArtifact}
							canStopLatestRun={canStopLatestRun}
							onOpenBlueprintArtifact={handleOpenBlueprintArtifact}
							isBlueprintArtifactOpen={isBlueprintArtifactOpen}
							onOpenReviewArtifact={handleOpenReviewArtifact}
							isReviewArtifactOpen={isReviewArtifactOpen}
							onOpenTestModeArtifact={handleOpenTestModeArtifact}
							isTestModeArtifactOpen={isTestModeArtifactOpen}
							onOpenTodoArtifact={handleOpenTodoArtifact}
							startSessionAndFocusTodo={startSessionAndFocusTodo}
							queueActiveSessionAndFocusTodo={queueActiveSessionAndFocusTodo}
							addActiveSessionToQueue={addActiveSessionToQueue}
							isActiveImplementationLocked={isActiveImplementationLocked}
						/>
					)}
				</Panel>
			</Group>
			{!showSettings ? (
				<>
					<SettingsButton
						onClick={() =>
							props.onNavigate({ kind: "settings", section: "general" })
						}
					/>
					<BlueprintShowcaseButton />
				</>
			) : null}
			<NightWorkersFolderBrowser
				open={props.showFolderBrowser}
				workspace={workspace}
				selectedPath={selectedPath}
				setSelectedPath={setSelectedPath}
				onClose={props.onCloseFolderBrowser}
			/>
		</div>
	);
}
