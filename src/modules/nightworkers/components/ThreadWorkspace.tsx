import {
	Bug,
	ClipboardCheck,
	FlaskConical,
	FolderTree,
	ListTodo,
	LoaderCircle,
	MessageCircleMore,
	NotebookPen,
	Trash2,
} from "lucide-react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
	Group,
	type Layout,
	Panel,
	Separator,
	useGroupRef,
} from "react-resizable-panels";
import { logArtifactPerf } from "../artifactPerformance";
import type {
	ActivityArtifact,
	ActivityEvent,
	BackgroundProcess,
	ComposerThinkingDepth,
	ModelOption,
	Repository,
	Task,
	TaskEvent,
	TaskLlmUsageSummary,
	TaskMessage,
	TaskRun,
	ThinkingDepthOption,
	WorkbenchArtifactContext,
	WorkbenchArtifactRef,
	WorkbenchChatIntent,
	WorkbenchSessionView,
} from "../types";
import { getRelativeTimestamp } from "../utils/time";
import {
	formatUsageBadge,
	formatUsageTitle,
	WorkbenchStateBanner,
} from "./ThreadWorkspaceBanner";
import { ThreadBody } from "./ThreadWorkspaceBody";
import {
	buildPersistedScrollState,
	createScrollSnapshot,
	loadPersistedScrollState,
	type PersistedScrollState,
	persistScrollState,
	readScrollSnapshot,
	resolveEffectiveScrollState,
	resolveRestoredScrollTop,
	restoreScrollState,
	type ScrollSnapshot,
	shouldKeepPendingRestore,
} from "./ThreadWorkspaceScrollState";

export {
	createScrollSnapshot,
	resolveEffectiveScrollState,
	resolveRestoredScrollTop,
	shouldKeepPendingRestore,
};

export const ARTIFACT_BUTTON_ACTION_COOLDOWN_MS = 700;

export function nextArtifactButtonCooldown(now: number, cooldownUntil: number) {
	return now < cooldownUntil ? null : now + ARTIFACT_BUTTON_ACTION_COOLDOWN_MS;
}
export type ThreadWorkspaceProps = {
	activeSession: Task | null;
	sessionView: WorkbenchSessionView | null;
	activeProject: Repository | null;
	runs: TaskRun[];
	latestRun?: TaskRun;
	taskMessages: TaskMessage[];
	latestRunEvents: TaskEvent[];
	injectedPrompt?: { id: number; text: string } | null;
	llmUsageSummary: TaskLlmUsageSummary | null;
	activityEvents: ActivityEvent[];
	activityArtifacts: ActivityArtifact[];
	activeStreamingResponse: string;
	backgroundProcesses?: BackgroundProcess[];
	artifactRefs: WorkbenchArtifactRef[];
	activeArtifactContext?: WorkbenchArtifactContext | null;
	isAgentWorking: boolean;
	isAgentThinking: boolean;
	realtimeStatus: "initializing" | "connecting" | "connected" | "disconnected";
	model: string;
	thinkingDepth: ComposerThinkingDepth;
	thinkingDepthOptions: ThinkingDepthOption[];
	onModelChange: (model: string) => void;
	modelOptions: ModelOption[];
	onThinkingDepthChange: (depth: ComposerThinkingDepth) => void;
	onSubmitInitialPrompt: (prompt: string) => Promise<void>;
	onSubmitWorkbenchMessage: (
		prompt: string,
		intent: WorkbenchChatIntent,
	) => Promise<void>;
	canStopActiveRun?: boolean;
	onStopActiveRun?: () => Promise<void>;
	onStopBackgroundProcess?: (processId: string) => Promise<BackgroundProcess>;
	onOpenBlueprintArtifact: () => Promise<void>;
	isBlueprintArtifactOpen: boolean;
	isBlueprintActionBusy: boolean;
	onOpenReviewArtifact: () => Promise<void>;
	isReviewArtifactOpen: boolean;
	hasReviewArtifact: boolean;
	isReviewActionBusy: boolean;
	onOpenTestModeArtifact: () => void;
	isTestModeArtifactOpen: boolean;
	onOpenTodoArtifact: () => void;
	isTodoArtifactOpen: boolean;
	hasTodoArtifact: boolean;
	onDeleteSession: () => void;
	onQueueSession: () => Promise<void> | void;
	onRemoveQueueEntry: () => void;
	onRequeueQueueEntry: (note?: string) => void;
	onOpenArtifact: (artifact: WorkbenchArtifactRef) => void;
	onOpenProjectFile?: (path: string) => void;
	onClearArtifactContext?: () => void;
	isProjectFilesOpen: boolean;
	onOpenProjectFiles: () => void;
	isPilotThoughtDockOpen?: boolean;
	onTogglePilotThoughtDock?: () => void;
	onGrantExternalPath: (path: string) => Promise<void>;
	splitPanel?: ReactNode;
};

export function ThreadWorkspace(props: ThreadWorkspaceProps) {
	const { t } = useTranslation();
	const blueprintArtifact =
		props.artifactRefs.find(
			(artifact) => artifact.kind === "plan_mode_workspace",
		) ||
		props.artifactRefs.find((artifact) => artifact.kind === "app_blueprint");
	const reviewArtifact = props.artifactRefs.find(
		(artifact) => artifact.kind === "review_status",
	);
	const [showDebugEvents, setShowDebugEvents] = useState(true);
	const [artifactButtonsCoolingDown, setArtifactButtonsCoolingDown] =
		useState(false);
	const artifactButtonCooldownUntilRef = useRef(0);
	const artifactButtonCooldownTimeoutRef = useRef<ReturnType<
		typeof setTimeout
	> | null>(null);
	const scrollContainerRef = useRef<HTMLDivElement | null>(null);
	const scrollStateRef = useRef<PersistedScrollState>({ mode: "bottom" });
	const pendingRestoreStateRef = useRef<PersistedScrollState | null>(null);
	const suppressedScrollTopRef = useRef<number | null>(null);
	const resizeObserverRef = useRef<ResizeObserver | null>(null);
	const resizeMetricsRef = useRef<{
		clientHeight: number;
		scrollHeight: number;
	} | null>(null);
	const hasSplitPanel = Boolean(props.splitPanel);
	const layoutMode = hasSplitPanel ? "split" : "single";
	const previousLayoutModeRef = useRef(layoutMode);
	const threadPanelGroupRef = useGroupRef();
	const threadPanelLayout = useMemo<Layout>(() => {
		return {
			"nightworkers-thread-main": hasSplitPanel ? 50 : 100,
			"nightworkers-artifact": hasSplitPanel ? 50 : 0,
		};
	}, [hasSplitPanel]);
	const activeSessionId = props.activeSession?.id ?? null;
	const forceLatestFocus = props.isAgentThinking;
	const latestRunEvent =
		props.latestRunEvents[props.latestRunEvents.length - 1];
	const latestTaskMessage = props.taskMessages[props.taskMessages.length - 1];
	const latestActivityEvent =
		props.activityEvents[props.activityEvents.length - 1];
	const latestFocusSignal = [
		activeSessionId || "",
		props.latestRun?.id || "",
		latestRunEvent?.id || latestRunEvent?.seq || props.latestRunEvents.length,
		latestTaskMessage?.id || props.taskMessages.length,
		latestActivityEvent?.id || props.activityEvents.length,
		props.activeStreamingResponse.length,
	].join(":");
	const planModeWorkspaceLabel = t("thread.planModeWorkspace");
	const noPlanModeWorkspaceLabel = t("thread.noPlanModeWorkspace");
	const reviewArtifactLabel = reviewArtifact
		? t("reviewStatus.title")
		: t("reviewStatus.start");
	const testModeArtifactLabel = t("thread.testModeArtifact");
	const debugModeTooltipLabel = t("thread.tooltip.debugMode");
	const pilotThoughtTooltipLabel = t("thread.tooltip.pilotThought");
	const planModeTooltipLabel = t("thread.tooltip.planMode");
	const testModeTooltipLabel = t("thread.tooltip.testMode");
	const reviewModeTooltipLabel = t("thread.tooltip.reviewMode");
	const todoListTooltipLabel = t("thread.tooltip.todoList");
	const runArtifactButtonAction = useCallback((action: () => void) => {
		const nextCooldownUntil = nextArtifactButtonCooldown(
			Date.now(),
			artifactButtonCooldownUntilRef.current,
		);
		if (nextCooldownUntil === null) return;
		artifactButtonCooldownUntilRef.current = nextCooldownUntil;
		setArtifactButtonsCoolingDown(true);
		if (artifactButtonCooldownTimeoutRef.current) {
			clearTimeout(artifactButtonCooldownTimeoutRef.current);
		}
		artifactButtonCooldownTimeoutRef.current = setTimeout(() => {
			artifactButtonCooldownTimeoutRef.current = null;
			setArtifactButtonsCoolingDown(false);
		}, ARTIFACT_BUTTON_ACTION_COOLDOWN_MS);
		action();
	}, []);
	const openArtifactWithCooldown = useCallback(
		(artifact: WorkbenchArtifactRef) => {
			runArtifactButtonAction(() => props.onOpenArtifact(artifact));
		},
		[props.onOpenArtifact, runArtifactButtonAction],
	);
	const openTestModeArtifactWithCooldown = useCallback(() => {
		runArtifactButtonAction(props.onOpenTestModeArtifact);
	}, [props.onOpenTestModeArtifact, runArtifactButtonAction]);
	const openReviewModeArtifactWithCooldown = useCallback(() => {
		runArtifactButtonAction(() => void props.onOpenReviewArtifact());
	}, [props.onOpenReviewArtifact, runArtifactButtonAction]);
	const commitScrollState = useCallback(
		(snapshot: ScrollSnapshot) => {
			const state = buildPersistedScrollState(snapshot);
			scrollStateRef.current = state;
			if (activeSessionId) persistScrollState(activeSessionId, state);
		},
		[activeSessionId],
	);
	const applyBestEffortRestore = useCallback(
		(node: HTMLDivElement) => {
			const state = resolveEffectiveScrollState(
				pendingRestoreStateRef.current || scrollStateRef.current,
				forceLatestFocus,
			);
			restoreScrollState(node, state);
			suppressedScrollTopRef.current = node.scrollTop;
			const nextSnapshot = readScrollSnapshot(node);
			scrollStateRef.current = buildPersistedScrollState(nextSnapshot);
			if (activeSessionId)
				persistScrollState(activeSessionId, scrollStateRef.current);
			if (forceLatestFocus) {
				pendingRestoreStateRef.current = null;
				return;
			}
			if (
				pendingRestoreStateRef.current &&
				!shouldKeepPendingRestore(pendingRestoreStateRef.current, {
					scrollHeight: node.scrollHeight,
					clientHeight: node.clientHeight,
				})
			) {
				pendingRestoreStateRef.current = null;
			}
		},
		[activeSessionId, forceLatestFocus],
	);
	const handleScrollContainerRef = useCallback(
		(node: HTMLDivElement | null) => {
			resizeObserverRef.current?.disconnect();
			scrollContainerRef.current = node;
			resizeObserverRef.current = null;
			resizeMetricsRef.current = node
				? {
						clientHeight: node.clientHeight,
						scrollHeight: node.scrollHeight,
					}
				: null;
			if (!node || typeof ResizeObserver === "undefined") return;
			resizeObserverRef.current = new ResizeObserver(() => {
				const currentNode = scrollContainerRef.current;
				const previousMetrics = resizeMetricsRef.current;
				if (!currentNode || !previousMetrics) return;
				const nextMetrics = {
					clientHeight: currentNode.clientHeight,
					scrollHeight: currentNode.scrollHeight,
				};
				if (
					previousMetrics.clientHeight === nextMetrics.clientHeight &&
					previousMetrics.scrollHeight === nextMetrics.scrollHeight
				) {
					return;
				}
				applyBestEffortRestore(currentNode);
				resizeMetricsRef.current = nextMetrics;
			});
			resizeObserverRef.current.observe(node);
		},
		[applyBestEffortRestore],
	);
	const handleScroll = useCallback(() => {
		if (!scrollContainerRef.current) return;
		if (
			suppressedScrollTopRef.current !== null &&
			Math.abs(
				scrollContainerRef.current.scrollTop - suppressedScrollTopRef.current,
			) < 1
		) {
			suppressedScrollTopRef.current = null;
			return;
		}
		suppressedScrollTopRef.current = null;
		pendingRestoreStateRef.current = null;
		if (forceLatestFocus) {
			scrollStateRef.current = { mode: "bottom" };
			if (activeSessionId)
				persistScrollState(activeSessionId, scrollStateRef.current);
			return;
		}
		commitScrollState(readScrollSnapshot(scrollContainerRef.current));
	}, [activeSessionId, commitScrollState, forceLatestFocus]);

	useLayoutEffect(() => {
		const node = scrollContainerRef.current;
		if (!activeSessionId || !node) {
			scrollStateRef.current = { mode: "bottom" };
			pendingRestoreStateRef.current = null;
			return;
		}
		const persistedState = forceLatestFocus
			? { mode: "bottom" as const }
			: loadPersistedScrollState(activeSessionId) || {
					mode: "bottom" as const,
				};
		scrollStateRef.current = persistedState;
		pendingRestoreStateRef.current = persistedState;
		applyBestEffortRestore(node);
	}, [activeSessionId, applyBestEffortRestore, forceLatestFocus]);

	useLayoutEffect(() => {
		// Rerun when timeline content changes, even if the scroll container size is stable.
		void latestFocusSignal;
		const node = scrollContainerRef.current;
		if (!node || !forceLatestFocus) return;
		scrollStateRef.current = { mode: "bottom" };
		pendingRestoreStateRef.current = null;
		restoreScrollState(node, scrollStateRef.current);
		suppressedScrollTopRef.current = node.scrollTop;
		if (activeSessionId)
			persistScrollState(activeSessionId, scrollStateRef.current);
		resizeMetricsRef.current = {
			clientHeight: node.clientHeight,
			scrollHeight: node.scrollHeight,
		};
	}, [activeSessionId, forceLatestFocus, latestFocusSignal]);

	useEffect(
		() => () => {
			if (artifactButtonCooldownTimeoutRef.current) {
				clearTimeout(artifactButtonCooldownTimeoutRef.current);
			}
		},
		[],
	);

	useLayoutEffect(() => {
		const node = scrollContainerRef.current;
		if (!node) return;
		if (previousLayoutModeRef.current !== layoutMode) {
			const appliedLayout =
				threadPanelGroupRef.current?.setLayout(threadPanelLayout);
			logArtifactPerf("threadWorkspace.layoutModeChanged", {
				from: previousLayoutModeRef.current,
				to: layoutMode,
				scrollHeight: node.scrollHeight,
				clientHeight: node.clientHeight,
				appliedLayout,
			});
			applyBestEffortRestore(node);
			previousLayoutModeRef.current = layoutMode;
		}
	}, [
		applyBestEffortRestore,
		layoutMode,
		threadPanelGroupRef,
		threadPanelLayout,
	]);

	const workbenchBanner = props.activeSession ? (
		<WorkbenchStateBanner
			sessionView={props.sessionView}
			model={props.model}
			onRemoveQueueEntry={props.onRemoveQueueEntry}
			onRequeueQueueEntry={props.onRequeueQueueEntry}
		/>
	) : null;
	const threadBody = (
		<ThreadBody
			activeSession={props.activeSession}
			activeStreamingResponse={props.activeStreamingResponse}
			activityArtifacts={props.activityArtifacts}
			activeArtifactContext={props.activeArtifactContext}
			activityEvents={props.activityEvents}
			backgroundProcesses={props.backgroundProcesses}
			isAgentThinking={props.isAgentThinking}
			isAgentWorking={props.isAgentWorking}
			latestRun={props.latestRun}
			latestRunEvents={props.latestRunEvents}
			injectedPrompt={props.injectedPrompt}
			model={props.model}
			modelOptions={props.modelOptions}
			onGrantExternalPath={props.onGrantExternalPath}
			onModelChange={props.onModelChange}
			onOpenArtifact={openArtifactWithCooldown}
			onOpenProjectFile={props.onOpenProjectFile}
			onOpenTestModeArtifact={openTestModeArtifactWithCooldown}
			onOpenReviewModeArtifact={openReviewModeArtifactWithCooldown}
			onClearArtifactContext={props.onClearArtifactContext}
			canStopActiveRun={props.canStopActiveRun}
			onSubmitInitialPrompt={props.onSubmitInitialPrompt}
			onSubmitWorkbenchMessage={props.onSubmitWorkbenchMessage}
			onStopActiveRun={props.onStopActiveRun}
			onStopBackgroundProcess={props.onStopBackgroundProcess}
			onThinkingDepthChange={props.onThinkingDepthChange}
			realtimeStatus={props.realtimeStatus}
			runs={props.runs}
			onScroll={handleScroll}
			scrollContainerRef={handleScrollContainerRef}
			showDebugEvents={showDebugEvents}
			taskMessages={props.taskMessages}
			thinkingDepth={props.thinkingDepth}
			thinkingDepthOptions={props.thinkingDepthOptions}
			workbenchBanner={workbenchBanner}
		/>
	);
	return (
		<div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#111827]">
			<div className="shrink-0 border-b border-slate-700/70 bg-[#0f172a] px-6 py-3 pr-16">
				{props.activeSession ? (
					<div className="space-y-2">
						<div className="flex items-center justify-between gap-4">
							<div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-sm">
								<span className="max-w-[28%] shrink-0 truncate text-slate-300/80">
									{props.activeProject?.name || t("thread.noProject")}
								</span>
								<span className="shrink-0 text-slate-500">&gt;</span>
								<span className="min-w-0 flex-1 truncate font-semibold text-slate-100">
									{props.activeSession.title}
								</span>
								<span className="shrink-0 text-xs text-slate-400">
									{getRelativeTimestamp(props.activeSession.updatedAt)}
								</span>
								<span
									className="shrink-0 rounded border border-slate-700/80 bg-slate-950/35 px-2 py-0.5 font-mono text-[11px] text-slate-300"
									title={formatUsageTitle(props.llmUsageSummary)}
								>
									{formatUsageBadge(props.llmUsageSummary)}
								</span>
								{/*
                  Do not add a session-state spinner here. The header marker has no
                  clear meaning for draft/new sessions and repeatedly caused false
                  "running" indicators beside the debug button.
                */}
							</div>
							<div className="flex shrink-0 items-center gap-2">
								<button
									type="button"
									className="inline-flex items-center gap-1.5 rounded border border-rose-500/60 bg-rose-950/20 px-2 py-1 text-[10px] uppercase text-rose-100 hover:bg-rose-900/40"
									onClick={() => {
										const ok = window.confirm(
											t("thread.confirmDeleteTask", {
												title: props.activeSession?.title,
											}),
										);
										if (!ok) return;
										props.onDeleteSession();
									}}
									title={t("thread.deleteTask")}
								>
									<Trash2 className="h-3.5 w-3.5" />
									<span>{t("thread.deleteTask")}</span>
								</button>
								<button
									type="button"
									className={`inline-flex h-7 w-7 items-center justify-center rounded border ${
										showDebugEvents
											? "border-cyan-400/70 bg-cyan-950/30 text-cyan-100"
											: "border-slate-600/80 bg-slate-900/30 text-slate-300 hover:border-slate-400"
									}`}
									onClick={() => setShowDebugEvents((value) => !value)}
									aria-label={debugModeTooltipLabel}
									aria-pressed={showDebugEvents}
									title={debugModeTooltipLabel}
								>
									<Bug className="h-3.5 w-3.5" />
								</button>
								{props.activeSession.missionPilot &&
								props.onTogglePilotThoughtDock ? (
									<button
										type="button"
										className={`inline-flex h-7 w-7 items-center justify-center rounded border ${
											props.isPilotThoughtDockOpen
												? "border-slate-400 bg-slate-800/80 text-slate-100"
												: "border-slate-600/80 bg-slate-900/30 text-slate-300 hover:border-slate-400"
										}`}
										onClick={props.onTogglePilotThoughtDock}
										aria-label={pilotThoughtTooltipLabel}
										aria-pressed={props.isPilotThoughtDockOpen}
										title={pilotThoughtTooltipLabel}
									>
										<MessageCircleMore className="h-4 w-4" />
									</button>
								) : null}
								<button
									type="button"
									className={`inline-flex h-7 w-7 items-center justify-center rounded border disabled:cursor-wait disabled:opacity-60 ${
										props.isProjectFilesOpen
											? "border-cyan-400/70 bg-cyan-950/30 text-cyan-100"
											: "border-slate-600/80 bg-slate-900/30 text-slate-200 hover:border-slate-400"
									}`}
									aria-pressed={props.isProjectFilesOpen}
									aria-disabled={artifactButtonsCoolingDown}
									disabled={artifactButtonsCoolingDown}
									onClick={() =>
										runArtifactButtonAction(props.onOpenProjectFiles)
									}
									title={t("thread.projectFiles")}
								>
									<FolderTree className="h-3.5 w-3.5" />
								</button>
								<button
									type="button"
									className={`inline-flex h-7 w-7 items-center justify-center rounded border disabled:cursor-wait disabled:opacity-60 ${
										props.isBlueprintArtifactOpen
											? "border-cyan-400/70 bg-cyan-950/30 text-cyan-100 hover:bg-cyan-900/30"
											: "border-slate-600/80 bg-slate-900/30 text-slate-300 hover:border-slate-400"
									}`}
									onClick={() =>
										runArtifactButtonAction(() => {
											void props.onOpenBlueprintArtifact();
										})
									}
									disabled={
										artifactButtonsCoolingDown ||
										props.isBlueprintActionBusy ||
										!props.activeSession ||
										!blueprintArtifact
									}
									aria-disabled={artifactButtonsCoolingDown}
									title={planModeTooltipLabel}
									aria-label={
										blueprintArtifact
											? planModeWorkspaceLabel
											: noPlanModeWorkspaceLabel
									}
									aria-pressed={props.isBlueprintArtifactOpen}
								>
									{props.isBlueprintActionBusy ? (
										<LoaderCircle className="h-3.5 w-3.5 animate-spin" />
									) : (
										<NotebookPen className="h-3.5 w-3.5" />
									)}
								</button>
								<button
									type="button"
									className={`inline-flex h-7 w-7 items-center justify-center rounded border disabled:cursor-not-allowed disabled:opacity-40 ${
										props.isTestModeArtifactOpen
											? "border-cyan-400/70 bg-cyan-950/30 text-cyan-100"
											: "border-slate-600/80 bg-slate-900/30 text-slate-200 hover:border-slate-400"
									}`}
									aria-pressed={props.isTestModeArtifactOpen}
									aria-disabled={artifactButtonsCoolingDown}
									disabled={artifactButtonsCoolingDown || !props.activeSession}
									onClick={openTestModeArtifactWithCooldown}
									title={testModeTooltipLabel}
									aria-label={testModeArtifactLabel}
								>
									<FlaskConical className="h-3.5 w-3.5" />
								</button>
								<button
									type="button"
									className={`inline-flex h-7 w-7 items-center justify-center rounded border disabled:cursor-not-allowed disabled:opacity-40 ${
										props.isReviewArtifactOpen
											? "border-cyan-400/70 bg-cyan-950/30 text-cyan-100"
											: "border-slate-600/80 bg-slate-900/30 text-slate-200 hover:border-slate-400"
									}`}
									aria-pressed={props.isReviewArtifactOpen}
									aria-disabled={artifactButtonsCoolingDown}
									disabled={
										artifactButtonsCoolingDown ||
										!props.activeSession ||
										(!props.latestRun && !props.hasReviewArtifact) ||
										props.isReviewActionBusy
									}
									onClick={() =>
										runArtifactButtonAction(() => {
											void props.onOpenReviewArtifact();
										})
									}
									title={reviewModeTooltipLabel}
									aria-label={reviewArtifactLabel}
								>
									{props.isReviewActionBusy ? (
										<LoaderCircle className="h-3.5 w-3.5 animate-spin" />
									) : (
										<ClipboardCheck className="h-3.5 w-3.5" />
									)}
								</button>
								<button
									type="button"
									className={`inline-flex h-7 w-7 items-center justify-center rounded border disabled:cursor-not-allowed disabled:opacity-40 ${
										props.isTodoArtifactOpen
											? "border-cyan-400/70 bg-cyan-950/30 text-cyan-100"
											: "border-slate-600/80 bg-slate-900/30 text-slate-200 hover:border-slate-400"
									}`}
									aria-pressed={props.isTodoArtifactOpen}
									aria-disabled={artifactButtonsCoolingDown}
									disabled={
										artifactButtonsCoolingDown || !props.hasTodoArtifact
									}
									onClick={() =>
										runArtifactButtonAction(props.onOpenTodoArtifact)
									}
									title={todoListTooltipLabel}
									aria-label={
										props.hasTodoArtifact
											? t("thread.todoArtifact")
											: t("thread.noTodoArtifact")
									}
								>
									<ListTodo className="h-3.5 w-3.5" />
								</button>
							</div>
						</div>
					</div>
				) : (
					<div className="flex items-center justify-between gap-4">
						<p className="text-sm text-slate-300/70">
							{t("thread.emptyPrompt")}
						</p>
						<button
							type="button"
							className={`inline-flex h-7 w-7 items-center justify-center rounded border disabled:cursor-wait disabled:opacity-60 ${
								props.isProjectFilesOpen
									? "border-cyan-400/70 bg-cyan-950/30 text-cyan-100"
									: "border-slate-600/80 bg-slate-900/30 text-slate-200 hover:border-slate-400"
							}`}
							aria-pressed={props.isProjectFilesOpen}
							aria-disabled={artifactButtonsCoolingDown}
							disabled={artifactButtonsCoolingDown}
							onClick={() => runArtifactButtonAction(props.onOpenProjectFiles)}
							title={t("thread.projectFiles")}
						>
							<FolderTree className="h-3.5 w-3.5" />
						</button>
					</div>
				)}
			</div>
			<Group
				className="nightworkers-thread-split-layout min-h-0 flex-1"
				defaultLayout={threadPanelLayout}
				groupRef={threadPanelGroupRef}
				orientation="horizontal"
			>
				<Panel
					id="nightworkers-thread-main"
					defaultSize={hasSplitPanel ? "50%" : "100%"}
					minSize="38%"
				>
					{threadBody}
				</Panel>
				<Separator
					className="nightworkers-panel-resize-handle"
					disabled={!hasSplitPanel}
					style={
						hasSplitPanel ? undefined : { width: 0, pointerEvents: "none" }
					}
				/>
				<Panel
					id="nightworkers-artifact"
					collapsedSize="0%"
					collapsible={true}
					defaultSize={hasSplitPanel ? "50%" : "0%"}
					minSize={hasSplitPanel ? "28%" : "0%"}
				>
					{hasSplitPanel ? props.splitPanel : null}
				</Panel>
			</Group>
		</div>
	);
}
