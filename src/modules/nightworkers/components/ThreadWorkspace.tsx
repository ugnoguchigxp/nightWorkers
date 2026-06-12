import {
  Bug,
  FolderTree,
  GitCompare,
  LoaderCircle,
  PanelsTopLeft,
  Square,
  Trash2,
} from 'lucide-react';
import { type ReactNode, useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Group, Panel, Separator } from 'react-resizable-panels';
import type {
  ActivityArtifact,
  ActivityEvent,
  BackgroundProcess,
  ModelOption,
  Repository,
  Task,
  TaskEvent,
  TaskLlmUsageSummary,
  TaskMessage,
  TaskRun,
  ThinkingDepth,
  WorkbenchArtifactContext,
  WorkbenchArtifactRef,
  WorkbenchChatIntent,
  WorkbenchSessionView,
} from '../types';
import { THINKING_DEPTH_OPTIONS } from '../types';
import { getRelativeTimestamp } from '../utils/time';
import { Composer } from './Composer';
import { ThreadMessage } from './ThreadMessage';
import { ThreadTimeline } from './ThreadTimeline';
import { ThinkingIndicator } from './ThreadTimelineStreaming';
import { formatUsageBadge, formatUsageTitle, WorkbenchStateBanner } from './ThreadWorkspaceBanner';

type ThreadWorkspaceProps = {
  activeSession: Task | null;
  sessionView: WorkbenchSessionView | null;
  activeProject: Repository | null;
  runs: TaskRun[];
  latestRun?: TaskRun;
  taskMessages: TaskMessage[];
  latestRunEvents: TaskEvent[];
  llmUsageSummary: TaskLlmUsageSummary | null;
  activityEvents: ActivityEvent[];
  activityArtifacts: ActivityArtifact[];
  activeStreamingResponse: string;
  backgroundProcesses?: BackgroundProcess[];
  artifactRefs: WorkbenchArtifactRef[];
  activeArtifactContext?: WorkbenchArtifactContext | null;
  isAgentWorking: boolean;
  isAgentThinking: boolean;
  realtimeStatus: 'initializing' | 'connecting' | 'connected' | 'disconnected';
  model: string;
  thinkingDepth: ThinkingDepth;
  onModelChange: (model: string) => void;
  modelOptions: ModelOption[];
  onThinkingDepthChange: (depth: ThinkingDepth) => void;
  onSubmitInitialPrompt: (prompt: string) => Promise<void>;
  onSubmitWorkbenchMessage: (prompt: string, intent: WorkbenchChatIntent) => Promise<void>;
  canStopActiveRun?: boolean;
  onStopActiveRun?: () => Promise<void>;
  onStopBackgroundProcess?: (processId: string) => Promise<BackgroundProcess>;
  onOpenBlueprintArtifact: () => Promise<void>;
  isBlueprintArtifactOpen: boolean;
  isBlueprintActionBusy: boolean;
  isDiffArtifactOpen: boolean;
  onDeleteSession: () => void;
  onQueueSession: () => void;
  onRemoveQueueEntry: () => void;
  onSubmitReview: (action: 'complete' | 'cancel', note?: string) => void;
  onRequeueQueueEntry: (note?: string) => void;
  onArchiveQueueExecution: () => void;
  onOpenArtifact: (artifact: WorkbenchArtifactRef) => void;
  onClearArtifactContext?: () => void;
  isProjectFilesOpen: boolean;
  onOpenProjectFiles: () => void;
  onOpenDiffArtifact: (artifact: WorkbenchArtifactRef) => void;
  onGrantExternalPath: (path: string) => Promise<void>;
  sidePanel?: ReactNode;
  splitPanel?: ReactNode;
};

const SCROLL_BOTTOM_LOCK_THRESHOLD = 48;
const SCROLL_STATE_STORAGE_KEY_PREFIX = 'nightworkers:thread-scroll:v1:';

type ScrollSnapshot = {
  scrollTop: number;
  maxScrollTop: number;
  distanceFromBottom: number;
  wasNearBottom: boolean;
};

type PersistedScrollState =
  | {
      mode: 'bottom';
    }
  | {
      mode: 'manual';
      snapshot: ScrollSnapshot;
    };

function clampScrollTop(value: number, maxScrollTop: number) {
  return Math.max(0, Math.min(value, maxScrollTop));
}

export function createScrollSnapshot(metrics: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}): ScrollSnapshot {
  const maxScrollTop = Math.max(0, metrics.scrollHeight - metrics.clientHeight);
  const scrollTop = clampScrollTop(metrics.scrollTop, maxScrollTop);
  const distanceFromBottom = Math.max(0, maxScrollTop - scrollTop);
  return {
    scrollTop,
    maxScrollTop,
    distanceFromBottom,
    wasNearBottom: distanceFromBottom <= SCROLL_BOTTOM_LOCK_THRESHOLD,
  };
}

export function resolveRestoredScrollTop(
  snapshot: ScrollSnapshot,
  metrics: { scrollHeight: number; clientHeight: number }
) {
  const maxScrollTop = Math.max(0, metrics.scrollHeight - metrics.clientHeight);
  if (snapshot.wasNearBottom) return maxScrollTop;
  if (snapshot.maxScrollTop <= 0 || maxScrollTop <= 0) return 0;
  const progress = snapshot.scrollTop / snapshot.maxScrollTop;
  return clampScrollTop(Math.round(maxScrollTop * progress), maxScrollTop);
}

export function shouldKeepPendingRestore(
  state: PersistedScrollState,
  metrics: { scrollHeight: number; clientHeight: number }
) {
  if (state.mode === 'bottom') return true;
  return metrics.scrollHeight < state.snapshot.maxScrollTop + metrics.clientHeight;
}

function buildPersistedScrollState(snapshot: ScrollSnapshot): PersistedScrollState {
  return snapshot.wasNearBottom
    ? { mode: 'bottom' }
    : {
        mode: 'manual',
        snapshot,
      };
}

function scrollStateStorageKey(sessionId: string) {
  return `${SCROLL_STATE_STORAGE_KEY_PREFIX}${sessionId}`;
}

function loadPersistedScrollState(sessionId: string): PersistedScrollState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(scrollStateStorageKey(sessionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.mode === 'bottom') return { mode: 'bottom' };
    const snapshotCandidate =
      parsed.snapshot && typeof parsed.snapshot === 'object'
        ? (parsed.snapshot as Record<string, unknown>)
        : parsed;
    if (
      typeof snapshotCandidate.scrollTop !== 'number' ||
      typeof snapshotCandidate.maxScrollTop !== 'number' ||
      typeof snapshotCandidate.distanceFromBottom !== 'number' ||
      typeof snapshotCandidate.wasNearBottom !== 'boolean'
    ) {
      return { mode: 'bottom' };
    }
    const snapshot: ScrollSnapshot = {
      scrollTop: snapshotCandidate.scrollTop,
      maxScrollTop: snapshotCandidate.maxScrollTop,
      distanceFromBottom: snapshotCandidate.distanceFromBottom,
      wasNearBottom: snapshotCandidate.wasNearBottom,
    };
    return {
      mode: snapshot.wasNearBottom ? 'bottom' : 'manual',
      snapshot,
    };
  } catch {
    return null;
  }
}

function persistScrollState(sessionId: string, state: PersistedScrollState) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(scrollStateStorageKey(sessionId), JSON.stringify(state));
}

function readScrollSnapshot(element: HTMLDivElement): ScrollSnapshot {
  return createScrollSnapshot({
    scrollTop: element.scrollTop,
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  });
}

function restoreScrollState(element: HTMLDivElement, state: PersistedScrollState) {
  const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
  if (state.mode === 'bottom') {
    element.scrollTop = maxScrollTop;
    return;
  }
  element.scrollTop = resolveRestoredScrollTop(state.snapshot, {
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  });
}

export function ThreadWorkspace(props: ThreadWorkspaceProps) {
  const { t } = useTranslation();
  const diffArtifacts = props.artifactRefs.filter((artifact) => artifact.kind === 'diff');
  const blueprintArtifact =
    props.artifactRefs.find((artifact) => artifact.kind === 'blueprint_workspace') ||
    props.artifactRefs.find((artifact) => artifact.kind === 'app_blueprint');
  const latestDiffArtifact = diffArtifacts[0];
  const [showDebugEvents, setShowDebugEvents] = useState(true);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const scrollStateRef = useRef<PersistedScrollState>({ mode: 'bottom' });
  const pendingRestoreStateRef = useRef<PersistedScrollState | null>(null);
  const suppressedScrollTopRef = useRef<number | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const resizeMetricsRef = useRef<{ clientHeight: number; scrollHeight: number } | null>(null);
  const layoutMode = props.splitPanel ? 'split' : props.sidePanel ? 'side' : 'single';
  const previousLayoutModeRef = useRef(layoutMode);
  const activeSessionId = props.activeSession?.id ?? null;
  const specificationWorkspaceLabel = t('thread.specificationWorkspace');
  const noSpecificationWorkspaceLabel = t('thread.noSpecificationWorkspace');
  const commitScrollState = useCallback(
    (snapshot: ScrollSnapshot) => {
      const state = buildPersistedScrollState(snapshot);
      scrollStateRef.current = state;
      if (activeSessionId) persistScrollState(activeSessionId, state);
    },
    [activeSessionId]
  );
  const applyBestEffortRestore = useCallback(
    (node: HTMLDivElement) => {
      const state = pendingRestoreStateRef.current || scrollStateRef.current;
      restoreScrollState(node, state);
      suppressedScrollTopRef.current = node.scrollTop;
      const nextSnapshot = readScrollSnapshot(node);
      scrollStateRef.current = buildPersistedScrollState(nextSnapshot);
      if (activeSessionId) persistScrollState(activeSessionId, scrollStateRef.current);
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
    [activeSessionId]
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
      if (!node || typeof ResizeObserver === 'undefined') return;
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
    [applyBestEffortRestore]
  );
  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current) return;
    if (
      suppressedScrollTopRef.current !== null &&
      Math.abs(scrollContainerRef.current.scrollTop - suppressedScrollTopRef.current) < 1
    ) {
      suppressedScrollTopRef.current = null;
      return;
    }
    suppressedScrollTopRef.current = null;
    pendingRestoreStateRef.current = null;
    commitScrollState(readScrollSnapshot(scrollContainerRef.current));
  }, [commitScrollState]);

  useLayoutEffect(() => {
    const node = scrollContainerRef.current;
    if (!activeSessionId || !node) {
      scrollStateRef.current = { mode: 'bottom' };
      pendingRestoreStateRef.current = null;
      return;
    }
    const persistedState = loadPersistedScrollState(activeSessionId) || { mode: 'bottom' };
    scrollStateRef.current = persistedState;
    pendingRestoreStateRef.current = persistedState;
    applyBestEffortRestore(node);
  }, [activeSessionId, applyBestEffortRestore]);

  useLayoutEffect(() => {
    const node = scrollContainerRef.current;
    if (!node) return;
    if (previousLayoutModeRef.current !== layoutMode) {
      applyBestEffortRestore(node);
      previousLayoutModeRef.current = layoutMode;
    }
  }, [applyBestEffortRestore, layoutMode]);

  const workbenchBanner = props.activeSession ? (
    <WorkbenchStateBanner
      sessionView={props.sessionView}
      model={props.model}
      onRemoveQueueEntry={props.onRemoveQueueEntry}
      onSubmitReview={props.onSubmitReview}
      onRequeueQueueEntry={props.onRequeueQueueEntry}
      onArchiveQueueExecution={props.onArchiveQueueExecution}
      onOpenDiff={() => {
        if (latestDiffArtifact) props.onOpenDiffArtifact(latestDiffArtifact);
      }}
      hasDiff={Boolean(latestDiffArtifact)}
    />
  ) : null;
  return (
    <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#111827]">
      <div className="shrink-0 border-b border-slate-700/70 bg-[#0f172a] px-6 py-3 pr-16">
        {props.activeSession ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-sm">
                <span className="max-w-[28%] shrink-0 truncate text-slate-300/80">
                  {props.activeProject?.name || t('thread.noProject')}
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
                  className={`inline-flex h-7 w-7 items-center justify-center rounded border ${
                    showDebugEvents
                      ? 'border-cyan-400/70 bg-cyan-950/30 text-cyan-100'
                      : 'border-slate-600/80 bg-slate-900/30 text-slate-300 hover:border-slate-400'
                  }`}
                  onClick={() => setShowDebugEvents((value) => !value)}
                  aria-pressed={showDebugEvents}
                  title={
                    showDebugEvents ? t('thread.hideDebugEvents') : t('thread.showDebugEvents')
                  }
                >
                  <Bug className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded border border-rose-500/60 bg-rose-950/20 px-2 py-1 text-[10px] uppercase text-rose-100 hover:bg-rose-900/40"
                  onClick={() => {
                    const ok = window.confirm(
                      t('thread.confirmDeleteTask', { title: props.activeSession?.title })
                    );
                    if (!ok) return;
                    props.onDeleteSession();
                  }}
                  title={t('thread.deleteTask')}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>{t('thread.deleteTask')}</span>
                </button>
                <button
                  type="button"
                  className={`inline-flex h-7 w-7 items-center justify-center rounded border ${
                    props.isProjectFilesOpen
                      ? 'border-cyan-400/70 bg-cyan-950/30 text-cyan-100'
                      : 'border-slate-600/80 bg-slate-900/30 text-slate-200 hover:border-slate-400'
                  }`}
                  aria-pressed={props.isProjectFilesOpen}
                  onClick={props.onOpenProjectFiles}
                  title={t('thread.projectFiles')}
                >
                  <FolderTree className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  className={`inline-flex h-7 w-7 items-center justify-center rounded border disabled:cursor-not-allowed disabled:opacity-40 ${
                    props.isDiffArtifactOpen
                      ? 'border-cyan-400/70 bg-cyan-950/30 text-cyan-100 hover:bg-cyan-900/30'
                      : 'border-slate-600/80 bg-slate-900/30 text-slate-300 hover:border-slate-400'
                  }`}
                  onClick={() => {
                    if (latestDiffArtifact) props.onOpenDiffArtifact(latestDiffArtifact);
                  }}
                  disabled={!latestDiffArtifact}
                  title={
                    props.isDiffArtifactOpen
                      ? t('thread.hideCodeDiffArtifact')
                      : latestDiffArtifact
                        ? t('thread.openCodeDiffArtifact')
                        : t('thread.noCodeDiffArtifact')
                  }
                  aria-label={
                    props.isDiffArtifactOpen
                      ? t('thread.hideCodeDiffArtifact')
                      : latestDiffArtifact
                        ? t('thread.openCodeDiffArtifact')
                        : t('thread.noCodeDiffArtifact')
                  }
                  aria-pressed={props.isDiffArtifactOpen}
                >
                  <GitCompare className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  className={`inline-flex h-7 w-7 items-center justify-center rounded border disabled:cursor-wait disabled:opacity-60 ${
                    props.isBlueprintArtifactOpen
                      ? 'border-cyan-400/70 bg-cyan-950/30 text-cyan-100 hover:bg-cyan-900/30'
                      : 'border-slate-600/80 bg-slate-900/30 text-slate-300 hover:border-slate-400'
                  }`}
                  onClick={() => void props.onOpenBlueprintArtifact()}
                  disabled={
                    props.isBlueprintActionBusy || !props.activeSession || !blueprintArtifact
                  }
                  title={
                    blueprintArtifact ? specificationWorkspaceLabel : noSpecificationWorkspaceLabel
                  }
                  aria-label={
                    blueprintArtifact ? specificationWorkspaceLabel : noSpecificationWorkspaceLabel
                  }
                  aria-pressed={props.isBlueprintArtifactOpen}
                >
                  {props.isBlueprintActionBusy ? (
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <PanelsTopLeft className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-slate-300/70">{t('thread.emptyPrompt')}</p>
            <button
              type="button"
              className={`inline-flex h-7 w-7 items-center justify-center rounded border ${
                props.isProjectFilesOpen
                  ? 'border-cyan-400/70 bg-cyan-950/30 text-cyan-100'
                  : 'border-slate-600/80 bg-slate-900/30 text-slate-200 hover:border-slate-400'
              }`}
              aria-pressed={props.isProjectFilesOpen}
              onClick={props.onOpenProjectFiles}
              title={t('thread.projectFiles')}
            >
              <FolderTree className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
      {props.splitPanel ? (
        <Group
          className="nightworkers-thread-split-layout min-h-0 flex-1"
          defaultLayout={{ 'nightworkers-thread-main': 50, 'nightworkers-artifact': 50 }}
          orientation="horizontal"
        >
          <Panel id="nightworkers-thread-main" minSize="38%">
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
              model={props.model}
              modelOptions={props.modelOptions}
              onGrantExternalPath={props.onGrantExternalPath}
              onModelChange={props.onModelChange}
              onOpenArtifact={props.onOpenArtifact}
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
              workbenchBanner={workbenchBanner}
            />
          </Panel>
          <Separator className="nightworkers-panel-resize-handle" />
          <Panel id="nightworkers-artifact" minSize="28%">
            {props.splitPanel}
          </Panel>
        </Group>
      ) : (
        <div className="nightworkers-thread-layout flex min-h-0 flex-1 items-start overflow-hidden">
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
            model={props.model}
            modelOptions={props.modelOptions}
            onGrantExternalPath={props.onGrantExternalPath}
            onModelChange={props.onModelChange}
            onOpenArtifact={props.onOpenArtifact}
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
            workbenchBanner={workbenchBanner}
          />
          {props.sidePanel ? (
            <aside className="nightworkers-thread-side-panel">{props.sidePanel}</aside>
          ) : null}
        </div>
      )}
    </div>
  );
}

function BackgroundProcessesStrip({
  processes,
  onStopBackgroundProcess,
}: {
  processes: BackgroundProcess[];
  onStopBackgroundProcess?: (processId: string) => Promise<BackgroundProcess>;
}) {
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const visible = processes.filter((processRecord) =>
    ['running', 'stopped', 'failed', 'lost'].includes(processRecord.status)
  );
  if (visible.length === 0) return null;

  return (
    <div className="mx-6 mt-4 space-y-2 rounded border border-slate-700/70 bg-slate-950/35 p-3 text-xs text-slate-200">
      <div className="flex items-center justify-between gap-3">
        <div className="font-medium text-slate-100">Background processes</div>
        <div className="text-slate-500">{visible.length}</div>
      </div>
      <div className="space-y-2">
        {visible.map((processRecord) => {
          const isRunning = processRecord.status === 'running';
          return (
            <div
              key={processRecord.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 rounded border border-slate-800 bg-slate-900/50 p-2"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      isRunning ? 'bg-emerald-400' : 'bg-slate-500'
                    }`}
                  />
                  <span className="truncate font-mono text-slate-100">{processRecord.command}</span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-slate-400">
                  <span>{processRecord.status}</span>
                  <span>{getRelativeTimestamp(processRecord.startedAt)}</span>
                  {processRecord.stopReason ? <span>{processRecord.stopReason}</span> : null}
                </div>
                {processRecord.latestOutput.trim() ? (
                  <pre className="max-h-20 overflow-auto whitespace-pre-wrap rounded bg-slate-950/60 p-2 font-mono text-[11px] text-slate-300">
                    {processRecord.latestOutput.trim()}
                  </pre>
                ) : null}
              </div>
              {isRunning && onStopBackgroundProcess ? (
                <button
                  className="inline-flex h-8 w-8 items-center justify-center rounded border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800 disabled:opacity-60"
                  disabled={stoppingId === processRecord.id}
                  onClick={async () => {
                    setStoppingId(processRecord.id);
                    try {
                      await onStopBackgroundProcess(processRecord.id);
                    } finally {
                      setStoppingId(null);
                    }
                  }}
                  title="Stop background process"
                  type="button"
                >
                  {stoppingId === processRecord.id ? (
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Square className="h-3.5 w-3.5" />
                  )}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ThreadBody({
  activeSession,
  activeStreamingResponse,
  activityArtifacts,
  activeArtifactContext,
  activityEvents,
  backgroundProcesses = [],
  isAgentThinking,
  isAgentWorking,
  latestRun,
  latestRunEvents,
  model,
  modelOptions,
  onGrantExternalPath,
  onModelChange,
  onOpenArtifact,
  onClearArtifactContext,
  canStopActiveRun,
  onSubmitInitialPrompt,
  onSubmitWorkbenchMessage,
  onStopActiveRun,
  onStopBackgroundProcess,
  onThinkingDepthChange,
  realtimeStatus,
  runs,
  onScroll,
  scrollContainerRef,
  showDebugEvents,
  taskMessages,
  thinkingDepth,
  workbenchBanner,
}: Pick<
  ThreadWorkspaceProps,
  | 'activeSession'
  | 'activeStreamingResponse'
  | 'activityArtifacts'
  | 'activeArtifactContext'
  | 'activityEvents'
  | 'backgroundProcesses'
  | 'isAgentThinking'
  | 'isAgentWorking'
  | 'latestRun'
  | 'latestRunEvents'
  | 'model'
  | 'modelOptions'
  | 'onGrantExternalPath'
  | 'onModelChange'
  | 'onOpenArtifact'
  | 'onClearArtifactContext'
  | 'canStopActiveRun'
  | 'onSubmitInitialPrompt'
  | 'onSubmitWorkbenchMessage'
  | 'onStopActiveRun'
  | 'onStopBackgroundProcess'
  | 'onThinkingDepthChange'
  | 'realtimeStatus'
  | 'runs'
  | 'taskMessages'
  | 'thinkingDepth'
> & {
  onScroll: () => void;
  scrollContainerRef: (node: HTMLDivElement | null) => void;
  showDebugEvents: boolean;
  workbenchBanner: ReactNode;
}) {
  const composerResizeObserverRef = useRef<ResizeObserver | null>(null);
  const [composerReservedHeight, setComposerReservedHeight] = useState(176);

  const updateComposerReservedHeight = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const nextHeight = Math.ceil(node.getBoundingClientRect().height) + 16;
    setComposerReservedHeight((current) => (current === nextHeight ? current : nextHeight));
  }, []);

  const handleComposerContainerRef = useCallback(
    (node: HTMLDivElement | null) => {
      composerResizeObserverRef.current?.disconnect();
      composerResizeObserverRef.current = null;
      if (!node) return;
      updateComposerReservedHeight(node);
      if (typeof ResizeObserver === 'undefined') return;
      composerResizeObserverRef.current = new ResizeObserver(() => {
        updateComposerReservedHeight(node);
      });
      composerResizeObserverRef.current.observe(node);
    },
    [updateComposerReservedHeight]
  );

  useLayoutEffect(
    () => () => {
      composerResizeObserverRef.current?.disconnect();
    },
    []
  );

  return (
    <div className="nightworkers-thread-main relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div
        ref={scrollContainerRef}
        className="nightworkers-thread-scroll nightworkers-scrollbar min-h-0 flex-1 overflow-y-auto"
        style={{ paddingBottom: `${composerReservedHeight}px` }}
        onScroll={onScroll}
      >
        {activeSession ? (
          <>
            {workbenchBanner}
            <BackgroundProcessesStrip
              processes={backgroundProcesses}
              onStopBackgroundProcess={onStopBackgroundProcess}
            />
            <ThreadTimeline
              session={activeSession}
              runs={runs}
              latestRun={latestRun}
              taskMessages={taskMessages}
              latestRunEvents={latestRunEvents}
              activityEvents={activityEvents}
              activityArtifacts={activityArtifacts}
              activeStreamingResponse={activeStreamingResponse}
              isAgentWorking={isAgentThinking}
              showDebugEvents={showDebugEvents}
              onOpenArtifact={onOpenArtifact}
              onGrantExternalPath={onGrantExternalPath}
            />
          </>
        ) : isAgentThinking ? (
          <div className="nightworkers-chat-window space-y-5 p-6">
            <ThreadMessage messageRole="assistant">
              <ThinkingIndicator />
            </ThreadMessage>
          </div>
        ) : (
          <div className="h-[40vh]" />
        )}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-transparent">
        <div ref={handleComposerContainerRef} className="pointer-events-auto">
          <Composer
            disabled={!activeSession && isAgentWorking}
            draftStorageKey={
              activeSession
                ? `nightworkers:composer:${activeSession.id}`
                : 'nightworkers:composer:new'
            }
            artifactContext={activeArtifactContext}
            model={model}
            thinkingDepth={thinkingDepth}
            modelOptions={modelOptions}
            latestDiffPatch={latestRun?.diffPatch || ''}
            realtimeStatus={realtimeStatus}
            isStopMode={canStopActiveRun}
            thinkingDepthOptions={THINKING_DEPTH_OPTIONS}
            onModelChange={onModelChange}
            onThinkingDepthChange={onThinkingDepthChange}
            onClearArtifactContext={onClearArtifactContext}
            onStop={onStopActiveRun}
            onSubmit={async (prompt, intent) => {
              if (!activeSession) {
                await onSubmitInitialPrompt(prompt);
                return;
              }
              await onSubmitWorkbenchMessage(prompt, intent);
            }}
          />
        </div>
      </div>
    </div>
  );
}
