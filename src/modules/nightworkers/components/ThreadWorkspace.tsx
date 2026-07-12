import { type ReactNode, useCallback, useEffect, useLayoutEffect } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
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
import { WorkbenchStateBanner } from "./ThreadWorkspaceBanner";
import { ThreadBody } from "./ThreadWorkspaceBody";
import { ThreadWorkspaceHeader } from "./ThreadWorkspaceHeader";
import {
	buildPersistedScrollState,
	createScrollSnapshot,
	loadPersistedScrollState,
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

type ThreadWorkspaceProps = {
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
	const commitScrollState = useCallback((snapshot: ScrollSnapshot) => {
		const state = buildPersistedScrollState(snapshot);
		scrollStateRef.current = state;
		if (activeSessionId) persistScrollState(activeSessionId, state);
	}, []);
	const applyBestEffortRestore = useCallback((node: HTMLDivElement) => {
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
	}, []);
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
	}, [commitScrollState]);

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
	}, [applyBestEffortRestore]);

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
	}, []);

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
	}, [applyBestEffortRestore]);

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
			<ThreadWorkspaceHeader
				props={props}
				blueprintArtifact={blueprintArtifact}
				showDebugEvents={showDebugEvents}
				setShowDebugEvents={setShowDebugEvents}
				artifactButtonsCoolingDown={artifactButtonsCoolingDown}
				runArtifactButtonAction={runArtifactButtonAction}
				openTestModeArtifactWithCooldown={openTestModeArtifactWithCooldown}
				planModeWorkspaceLabel={planModeWorkspaceLabel}
				noPlanModeWorkspaceLabel={noPlanModeWorkspaceLabel}
				reviewArtifactLabel={reviewArtifactLabel}
				testModeArtifactLabel={testModeArtifactLabel}
				debugModeTooltipLabel={debugModeTooltipLabel}
				pilotThoughtTooltipLabel={pilotThoughtTooltipLabel}
				planModeTooltipLabel={planModeTooltipLabel}
				testModeTooltipLabel={testModeTooltipLabel}
				reviewModeTooltipLabel={reviewModeTooltipLabel}
				todoListTooltipLabel={todoListTooltipLabel}
			/>
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
