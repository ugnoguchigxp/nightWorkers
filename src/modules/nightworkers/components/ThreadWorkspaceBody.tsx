import { LoaderCircle, Square } from 'lucide-react';
import { type ReactNode, useCallback, useLayoutEffect, useRef, useState } from 'react';
import type {
  ActivityArtifact,
  ActivityEvent,
  BackgroundProcess,
  ComposerThinkingDepth,
  ModelOption,
  Task,
  TaskEvent,
  TaskMessage,
  TaskRun,
  ThinkingDepthOption,
  WorkbenchArtifactContext,
  WorkbenchArtifactRef,
  WorkbenchChatIntent,
} from '../types';
import { getRelativeTimestamp } from '../utils/time';
import { Composer } from './Composer';
import { ThreadMessage } from './ThreadMessage';
import { ThreadTimeline } from './ThreadTimeline';
import { ThinkingIndicator } from './ThreadTimelineStreaming';

type ThreadBodyProps = {
  activeSession: Task | null;
  activeStreamingResponse: string;
  activityArtifacts: ActivityArtifact[];
  activeArtifactContext?: WorkbenchArtifactContext | null;
  activityEvents: ActivityEvent[];
  backgroundProcesses?: BackgroundProcess[];
  isAgentThinking: boolean;
  isAgentWorking: boolean;
  latestRun?: TaskRun;
  latestRunEvents: TaskEvent[];
  injectedPrompt?: { id: number; text: string } | null;
  model: string;
  modelOptions: ModelOption[];
  onGrantExternalPath: (path: string) => Promise<void>;
  onModelChange: (model: string) => void;
  onOpenArtifact: (artifact: WorkbenchArtifactRef) => void;
  onClearArtifactContext?: () => void;
  canStopActiveRun?: boolean;
  onSubmitInitialPrompt: (prompt: string) => Promise<void>;
  onSubmitWorkbenchMessage: (prompt: string, intent: WorkbenchChatIntent) => Promise<void>;
  onStopActiveRun?: () => Promise<void>;
  onStopBackgroundProcess?: (processId: string) => Promise<BackgroundProcess>;
  onThinkingDepthChange: (depth: ComposerThinkingDepth) => void;
  thinkingDepthOptions: ThinkingDepthOption[];
  realtimeStatus: 'initializing' | 'connecting' | 'connected' | 'disconnected';
  runs: TaskRun[];
  onScroll: () => void;
  scrollContainerRef: (node: HTMLDivElement | null) => void;
  showDebugEvents: boolean;
  taskMessages: TaskMessage[];
  thinkingDepth: ComposerThinkingDepth;
  workbenchBanner: ReactNode;
};

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

export function projectEvaluationComposerDraftState(
  activeSession: Task | null,
  taskMessages: TaskMessage[]
) {
  const usesGeneratedInitialPrompt =
    activeSession?.createdBy === 'project-evaluation' ||
    activeSession?.createdBy === 'mission-task-candidate';
  const hasSentUserPrompt = taskMessages.some((message) => message.role === 'user');
  return {
    discardStoredDraft: usesGeneratedInitialPrompt && hasSentUserPrompt,
    initialPrompt:
      usesGeneratedInitialPrompt && !hasSentUserPrompt ? activeSession.objective?.trim() || '' : '',
  };
}

export function ThreadBody({
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
  injectedPrompt = null,
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
  thinkingDepthOptions,
  realtimeStatus,
  runs,
  onScroll,
  scrollContainerRef,
  showDebugEvents,
  taskMessages,
  thinkingDepth,
  workbenchBanner,
}: ThreadBodyProps) {
  const composerResizeObserverRef = useRef<ResizeObserver | null>(null);
  const [composerReservedHeight, setComposerReservedHeight] = useState(176);
  const composerDraftState = projectEvaluationComposerDraftState(activeSession, taskMessages);

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
            initialPrompt={composerDraftState.initialPrompt}
            injectedPrompt={injectedPrompt}
            discardStoredDraft={composerDraftState.discardStoredDraft}
            artifactContext={activeArtifactContext}
            model={model}
            thinkingDepth={thinkingDepth}
            modelOptions={modelOptions}
            latestDiffPatch={latestRun?.diffPatch || ''}
            realtimeStatus={realtimeStatus}
            isStopMode={canStopActiveRun}
            thinkingDepthOptions={thinkingDepthOptions}
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
