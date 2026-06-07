import { Bug, FolderTree, GitCompare, LoaderCircle, PanelsTopLeft, Trash2 } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Group, Panel, Separator } from 'react-resizable-panels';
import type {
  ActivityArtifact,
  ActivityEvent,
  ModelOption,
  Repository,
  Task,
  TaskEvent,
  TaskLlmUsageSummary,
  TaskMessage,
  TaskRun,
  ThinkingDepth,
  WorkbenchArtifactRef,
  WorkbenchChatIntent,
  WorkbenchSessionView,
} from '../types';
import { THINKING_DEPTH_OPTIONS } from '../types';
import { getRelativeTimestamp } from '../utils/time';
import { Composer } from './Composer';
import { ThreadMessage } from './ThreadMessage';
import { ThinkingIndicator, ThreadTimeline } from './ThreadTimeline';

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
  artifactRefs: WorkbenchArtifactRef[];
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
  isProjectFilesOpen: boolean;
  onOpenProjectFiles: () => void;
  onOpenDiffArtifact: (artifact: WorkbenchArtifactRef) => void;
  onGrantExternalPath: (path: string) => Promise<void>;
  sidePanel?: ReactNode;
  splitPanel?: ReactNode;
};

export function ThreadWorkspace(props: ThreadWorkspaceProps) {
  const { t } = useTranslation();
  const diffArtifacts = props.artifactRefs.filter((artifact) => artifact.kind === 'diff');
  const blueprintArtifact =
    props.artifactRefs.find((artifact) => artifact.kind === 'blueprint_workspace') ||
    props.artifactRefs.find((artifact) => artifact.kind === 'app_blueprint');
  const latestDiffArtifact = diffArtifacts[0];
  const [showDebugEvents, setShowDebugEvents] = useState(true);
  const specificationWorkspaceLabel = t('thread.specificationWorkspace');
  const noSpecificationWorkspaceLabel = t('thread.noSpecificationWorkspace');
  const workbenchBanner = props.activeSession ? (
    <WorkbenchStateBanner
      sessionView={props.sessionView}
      model={props.model}
      onQueueSession={props.onQueueSession}
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
          defaultLayout={{ 'nightworkers-thread-main': 62, 'nightworkers-artifact': 38 }}
          orientation="horizontal"
        >
          <Panel id="nightworkers-thread-main" minSize="38%">
            <ThreadBody
              activeSession={props.activeSession}
              activeStreamingResponse={props.activeStreamingResponse}
              activityArtifacts={props.activityArtifacts}
              activityEvents={props.activityEvents}
              isAgentThinking={props.isAgentThinking}
              isAgentWorking={props.isAgentWorking}
              latestRun={props.latestRun}
              latestRunEvents={props.latestRunEvents}
              model={props.model}
              modelOptions={props.modelOptions}
              onGrantExternalPath={props.onGrantExternalPath}
              onModelChange={props.onModelChange}
              onOpenArtifact={props.onOpenArtifact}
              onSubmitInitialPrompt={props.onSubmitInitialPrompt}
              onSubmitWorkbenchMessage={props.onSubmitWorkbenchMessage}
              onThinkingDepthChange={props.onThinkingDepthChange}
              realtimeStatus={props.realtimeStatus}
              runs={props.runs}
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
            activityEvents={props.activityEvents}
            isAgentThinking={props.isAgentThinking}
            isAgentWorking={props.isAgentWorking}
            latestRun={props.latestRun}
            latestRunEvents={props.latestRunEvents}
            model={props.model}
            modelOptions={props.modelOptions}
            onGrantExternalPath={props.onGrantExternalPath}
            onModelChange={props.onModelChange}
            onOpenArtifact={props.onOpenArtifact}
            onSubmitInitialPrompt={props.onSubmitInitialPrompt}
            onSubmitWorkbenchMessage={props.onSubmitWorkbenchMessage}
            onThinkingDepthChange={props.onThinkingDepthChange}
            realtimeStatus={props.realtimeStatus}
            runs={props.runs}
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

function ThreadBody({
  activeSession,
  activeStreamingResponse,
  activityArtifacts,
  activityEvents,
  isAgentThinking,
  isAgentWorking,
  latestRun,
  latestRunEvents,
  model,
  modelOptions,
  onGrantExternalPath,
  onModelChange,
  onOpenArtifact,
  onSubmitInitialPrompt,
  onSubmitWorkbenchMessage,
  onThinkingDepthChange,
  realtimeStatus,
  runs,
  showDebugEvents,
  taskMessages,
  thinkingDepth,
  workbenchBanner,
}: Pick<
  ThreadWorkspaceProps,
  | 'activeSession'
  | 'activeStreamingResponse'
  | 'activityArtifacts'
  | 'activityEvents'
  | 'isAgentThinking'
  | 'isAgentWorking'
  | 'latestRun'
  | 'latestRunEvents'
  | 'model'
  | 'modelOptions'
  | 'onGrantExternalPath'
  | 'onModelChange'
  | 'onOpenArtifact'
  | 'onSubmitInitialPrompt'
  | 'onSubmitWorkbenchMessage'
  | 'onThinkingDepthChange'
  | 'realtimeStatus'
  | 'runs'
  | 'taskMessages'
  | 'thinkingDepth'
> & {
  showDebugEvents: boolean;
  workbenchBanner: ReactNode;
}) {
  return (
    <div className="nightworkers-thread-main relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="nightworkers-thread-scroll nightworkers-scrollbar min-h-0 flex-1 overflow-y-auto pb-40">
        {activeSession ? (
          <>
            {workbenchBanner}
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
        <div className="pointer-events-auto">
          <Composer
            disabled={isAgentWorking}
            model={model}
            thinkingDepth={thinkingDepth}
            modelOptions={modelOptions}
            latestDiffPatch={latestRun?.diffPatch || ''}
            realtimeStatus={realtimeStatus}
            thinkingDepthOptions={THINKING_DEPTH_OPTIONS}
            onModelChange={onModelChange}
            onThinkingDepthChange={onThinkingDepthChange}
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

function WorkbenchStateBanner({
  sessionView,
  model,
  onQueueSession,
  onRemoveQueueEntry,
  onSubmitReview,
  onRequeueQueueEntry,
  onArchiveQueueExecution,
  onOpenDiff,
  hasDiff,
}: {
  sessionView: WorkbenchSessionView | null;
  model: string;
  onQueueSession: () => void;
  onRemoveQueueEntry: () => void;
  onSubmitReview: (action: 'complete' | 'cancel', note?: string) => void;
  onRequeueQueueEntry: (note?: string) => void;
  onArchiveQueueExecution: () => void;
  onOpenDiff: () => void;
  hasDiff: boolean;
}) {
  if (!sessionView) return null;
  if (sessionView.emailState === 'plan_ready') {
    return (
      <div className="border-b border-emerald-500/20 bg-emerald-950/20 px-6 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-emerald-100">実装計画が作成されました</div>
            <div className="mt-1 text-xs text-emerald-200/80">
              この Session を NightShift に追加できます。Model profile: {model}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              className="rounded bg-emerald-400 px-3 py-1.5 text-xs font-semibold text-emerald-950 hover:bg-emerald-300"
              onClick={onQueueSession}
            >
              NightShift に追加
            </button>
            <button
              type="button"
              className="rounded border border-emerald-300/40 px-3 py-1.5 text-xs text-emerald-100 hover:bg-emerald-900/40"
            >
              計画を編集
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (sessionView.emailState === 'queued') {
    return (
      <div className="border-b border-sky-500/20 bg-sky-950/20 px-6 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-sky-100">NightShift に追加済み</div>
            <div className="mt-1 text-xs text-sky-200/80">
              Queue position #{sessionView.queuePosition ?? '-'}。夜間 Processor が順次実行します。
            </div>
          </div>
          <button
            type="button"
            className="rounded border border-sky-300/40 px-3 py-1.5 text-xs text-sky-100 hover:bg-sky-900/40"
            onClick={onRemoveQueueEntry}
          >
            Queue から外す
          </button>
        </div>
      </div>
    );
  }
  if (sessionView.emailState === 'review_needed') {
    return (
      <div className="border-b border-amber-500/20 bg-amber-950/20 px-6 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-amber-100">
              実行が完了しました。レビューが必要です。
            </div>
            <div className="mt-1 text-xs text-amber-200/80">
              diff、test result、final report を確認してください。
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              className="rounded bg-amber-300 px-3 py-1.5 text-xs font-semibold text-amber-950 hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={onOpenDiff}
              disabled={!hasDiff}
            >
              Review
            </button>
            <button
              type="button"
              className="rounded border border-amber-300/40 px-3 py-1.5 text-xs text-amber-100 hover:bg-amber-900/40"
              onClick={() => onSubmitReview('complete', 'Accepted from Morning Review.')}
            >
              満足 / Accept
            </button>
            <button
              type="button"
              className="rounded border border-amber-300/40 px-3 py-1.5 text-xs text-amber-100 hover:bg-amber-900/40"
              onClick={() =>
                onRequeueQueueEntry(
                  'Manual review requested follow-up; requeue with preserved priority.'
                )
              }
            >
              修正を依頼して再投入
            </button>
            <button
              type="button"
              className="rounded border border-amber-300/40 px-3 py-1.5 text-xs text-amber-100 hover:bg-amber-900/40"
              onClick={onArchiveQueueExecution}
            >
              採用しない / Archive
            </button>
          </div>
        </div>
        <DecisionSupportPanel
          sessionView={sessionView}
          onRequeueQueueEntry={onRequeueQueueEntry}
          tone="amber"
        />
      </div>
    );
  }
  if (
    sessionView.emailState === 'needs_input' ||
    sessionView.emailState === 'failed' ||
    sessionView.emailState === 'running'
  ) {
    return (
      <div className="border-b border-slate-700/60 bg-slate-950/30 px-6 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-100">{stateLabel(sessionView)}</div>
            <div className="mt-1 text-xs text-slate-300">
              Session state: {sessionView.emailState} · Model profile: {model}
            </div>
          </div>
          {sessionView.emailState !== 'running' && sessionView.queueEntry ? (
            <button
              type="button"
              className="rounded border border-slate-500 px-3 py-1.5 text-xs text-slate-100 hover:bg-slate-800"
              onClick={() =>
                onRequeueQueueEntry(
                  sessionView.emailState === 'needs_input'
                    ? 'Human input supplied; requeue with preserved priority.'
                    : 'Manual retry requested; requeue with preserved priority.'
                )
              }
            >
              優先再投入
            </button>
          ) : null}
        </div>
        {sessionView.queueEntry ? (
          <DecisionSupportPanel
            sessionView={sessionView}
            onRequeueQueueEntry={onRequeueQueueEntry}
            tone="slate"
          />
        ) : null}
      </div>
    );
  }
  return (
    <div className="border-b border-slate-700/60 bg-slate-950/20 px-6 py-2 text-xs text-slate-300">
      Session state: {stateLabel(sessionView)} · Model profile: {model}
    </div>
  );
}

function DecisionSupportPanel({
  sessionView,
  onRequeueQueueEntry,
  tone,
}: {
  sessionView: WorkbenchSessionView;
  onRequeueQueueEntry: (note?: string) => void;
  tone: 'amber' | 'slate';
}) {
  const entry = sessionView.queueEntry;
  const borderClass = tone === 'amber' ? 'border-amber-300/25' : 'border-slate-600';
  const textClass = tone === 'amber' ? 'text-amber-100' : 'text-slate-100';
  const subTextClass = tone === 'amber' ? 'text-amber-200/75' : 'text-slate-300';
  const buttonClass =
    tone === 'amber'
      ? 'border-amber-300/40 text-amber-100 hover:bg-amber-900/40'
      : 'border-slate-500 text-slate-100 hover:bg-slate-800';
  return (
    <div className={`mt-3 rounded border ${borderClass} px-3 py-2`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={`text-xs font-semibold ${textClass}`}>Decision support</div>
          <div className={`mt-1 text-xs ${subTextClass}`}>
            contextStill advice は未接続です。いまは人間が結果を確認し、満足なら Accept、
            修正が必要なら優先再投入を選びます。
          </div>
          <div className={`mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] ${subTextClass}`}>
            <span>state: {sessionView.emailState}</span>
            {entry ? <span>queue: {entry.status}</span> : null}
            {entry ? <span>priority: {entry.priority}</span> : null}
            {entry?.queuePosition != null ? <span>position: #{entry.queuePosition}</span> : null}
          </div>
        </div>
        {entry ? (
          <button
            type="button"
            className={`rounded border px-3 py-1.5 text-xs ${buttonClass}`}
            onClick={() => onRequeueQueueEntry('Manual decision requested priority requeue.')}
          >
            優先再投入
          </button>
        ) : null}
      </div>
    </div>
  );
}

function stateLabel(sessionView: WorkbenchSessionView) {
  if (sessionView.emailState === 'draft') return 'Draft';
  if (sessionView.emailState === 'running') return 'Running';
  if (sessionView.emailState === 'needs_input') return 'Needs input';
  if (sessionView.emailState === 'done') return 'Done';
  if (sessionView.emailState === 'failed') return 'Failed';
  return sessionView.emailState;
}

function formatUsageBadge(summary: TaskLlmUsageSummary | null) {
  return `i:${formatTokenCount(summary?.inputTokens ?? 0)} / o:${formatTokenCount(
    summary?.outputTokens ?? 0
  )}`;
}

function formatUsageTitle(summary: TaskLlmUsageSummary | null) {
  if (!summary) return 'input 0 / output 0 / StateCard 0 / mode unavailable';
  return `provider input ${summary.inputTokens.toLocaleString()} / output ${summary.outputTokens.toLocaleString()} / prompt estimate ${summary.promptInputTokens.toLocaleString()} / StateCard ${summary.stateCardTokens.toLocaleString()} / mode ${summary.usageMode}`;
}

function formatTokenCount(value: number) {
  const count = Math.max(0, Math.floor(value));
  if (count < 1000) return String(count);
  if (count < 1_000_000) return trimCompactNumber(count / 1000, 'k');
  return trimCompactNumber(count / 1_000_000, 'm');
}

function trimCompactNumber(value: number, suffix: string) {
  return `${value.toFixed(1).replace(/\.0$/, '')}${suffix}`;
}
