import { Bug, FolderTree, LoaderCircle, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type {
  ModelOption,
  Repository,
  Task,
  TaskEvent,
  TaskMessage,
  TaskRun,
  TaskRunTodo,
  ThinkingDepth,
  WorkbenchArtifactRef,
  WorkbenchChatIntent,
  WorkbenchSessionView,
} from '../types';
import { THINKING_DEPTH_OPTIONS } from '../types';
import { getRelativeTimestamp } from '../utils/time';
import { Composer } from './Composer';
import { ThreadTimeline } from './ThreadTimeline';

type ThreadWorkspaceProps = {
  activeSession: Task | null;
  activeSessionView: WorkbenchSessionView | null;
  activeProject: Repository | null;
  runs: TaskRun[];
  latestRun?: TaskRun;
  taskMessages: TaskMessage[];
  latestRunEvents: TaskEvent[];
  latestRunTodos: TaskRunTodo[];
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
  onToggleDraftReady: () => Promise<void>;
  isUpdatingSessionStatus: boolean;
  onDeleteSession: () => void;
  onOpenArtifact: (artifact: WorkbenchArtifactRef) => void;
  isProjectFilesOpen: boolean;
  onOpenProjectFiles: () => void;
  onOpenDiffArtifact: (artifact: WorkbenchArtifactRef) => void;
};

export function ThreadWorkspace(props: ThreadWorkspaceProps) {
  const diffArtifacts = props.artifactRefs.filter((artifact) => artifact.kind === 'diff');
  const [showDebugEvents, setShowDebugEvents] = useState(false);
  const canToggleDraftReady =
    props.activeSession?.status === 'draft' || props.activeSession?.status === 'ready';
  return (
    <div className="relative flex min-h-screen min-w-0 flex-1 flex-col bg-[#111827]">
      <div className="shrink-0 border-b border-slate-700/70 bg-[#0f172a] px-6 py-3 pr-16">
        {props.activeSession ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-sm">
                <span className="max-w-[28%] shrink-0 truncate text-slate-300/80">
                  {props.activeProject?.name || 'No Project'}
                </span>
                <span className="shrink-0 text-slate-500">&gt;</span>
                <span className="min-w-0 flex-1 truncate font-semibold text-slate-100">
                  {props.activeSession.title}
                </span>
                <span className="shrink-0 text-xs text-slate-400">
                  {getRelativeTimestamp(props.activeSession.updatedAt)}
                </span>
                {props.activeSessionView ? (
                  <span className="shrink-0">
                    <SessionStateMarker session={props.activeSessionView} />
                  </span>
                ) : null}
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
                  title={showDebugEvents ? 'Hide debug events' : 'Show debug events'}
                >
                  <Bug className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  className="inline-flex overflow-hidden rounded border border-slate-600/80 bg-slate-900/30 text-[10px] uppercase text-slate-300 hover:border-slate-400 disabled:cursor-wait disabled:opacity-70"
                  onClick={() => void props.onToggleDraftReady()}
                  disabled={props.isUpdatingSessionStatus || !canToggleDraftReady}
                  aria-pressed={props.activeSession.status === 'ready'}
                  title="Draft / Ready"
                >
                  <span
                    className={`px-2 py-1 ${
                      props.activeSession.status === 'draft'
                        ? 'bg-slate-200 text-slate-950'
                        : 'text-slate-400'
                    }`}
                  >
                    Draft
                  </span>
                  <span
                    className={`border-slate-700 border-l px-2 py-1 ${
                      props.activeSession.status === 'ready'
                        ? 'bg-emerald-400 text-slate-950'
                        : 'text-slate-400'
                    }`}
                  >
                    Ready
                  </span>
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded border border-rose-500/60 bg-rose-950/20 px-2 py-1 text-[10px] uppercase text-rose-100 hover:bg-rose-900/40"
                  onClick={() => {
                    const ok = window.confirm(
                      `Task "${props.activeSession?.title}" を削除します。続行しますか？`
                    );
                    if (!ok) return;
                    props.onDeleteSession();
                  }}
                  title="Task削除"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Task削除</span>
                </button>
                <button
                  type="button"
                  className={`rounded border px-2 py-1 text-[10px] uppercase ${
                    props.isProjectFilesOpen
                      ? 'border-cyan-400/70 bg-cyan-950/30 text-cyan-100'
                      : 'border-slate-600/80 bg-slate-900/30 text-slate-200 hover:border-slate-400'
                  }`}
                  aria-pressed={props.isProjectFilesOpen}
                  onClick={props.onOpenProjectFiles}
                  title="Project files"
                >
                  <FolderTree className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            {diffArtifacts.length > 0 ? (
              <div className="flex gap-1 overflow-x-auto">
                {diffArtifacts.slice(0, 8).map((artifact) => (
                  <button
                    key={artifact.id}
                    type="button"
                    className="shrink-0 rounded border border-slate-700/80 px-2 py-1 text-[10px] uppercase text-slate-300 hover:border-cyan-500/70 hover:text-cyan-100"
                    onClick={() => props.onOpenDiffArtifact(artifact)}
                  >
                    {artifact.kind.replace(/_/g, ' ')}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-slate-300/70">
              作業スレッドを選択するか、下の入力欄から開始
            </p>
            <button
              type="button"
              className={`rounded border px-2 py-1 text-[10px] uppercase ${
                props.isProjectFilesOpen
                  ? 'border-cyan-400/70 bg-cyan-950/30 text-cyan-100'
                  : 'border-slate-600/80 bg-slate-900/30 text-slate-200 hover:border-slate-400'
              }`}
              aria-pressed={props.isProjectFilesOpen}
              onClick={props.onOpenProjectFiles}
              title="Project files"
            >
              <FolderTree className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
      <div className="pb-44">
        {props.activeSession ? (
          <ThreadTimeline
            session={props.activeSession}
            runs={props.runs}
            latestRun={props.latestRun}
            taskMessages={props.taskMessages}
            latestRunEvents={props.latestRunEvents}
            latestRunTodos={props.latestRunTodos}
            isAgentWorking={props.isAgentThinking}
            showDebugEvents={showDebugEvents}
            onOpenArtifact={props.onOpenArtifact}
          />
        ) : (
          <div className="h-[40vh]" />
        )}
      </div>
      <div className="sticky bottom-0 z-20 mt-auto">
        <Composer
          disabled={props.isAgentWorking}
          model={props.model}
          thinkingDepth={props.thinkingDepth}
          modelOptions={props.modelOptions}
          latestDiffPatch={props.latestRun?.diffPatch || ''}
          realtimeStatus={props.realtimeStatus}
          thinkingDepthOptions={THINKING_DEPTH_OPTIONS}
          onModelChange={props.onModelChange}
          onThinkingDepthChange={props.onThinkingDepthChange}
          onSubmit={async (prompt, intent) => {
            if (!props.activeSession) {
              await props.onSubmitInitialPrompt(prompt);
              return;
            }
            await props.onSubmitWorkbenchMessage(prompt, intent);
          }}
        />
      </div>
    </div>
  );
}

function SessionStateMarker({ session }: { session: WorkbenchSessionView }) {
  const taskStatus = session.task.status;
  const runStatus = session.latestRun?.status;
  const hasProblem =
    session.progress.blockers.length > 0 ||
    ['failed', 'blocked', 'timed_out', 'needs_human'].includes(taskStatus) ||
    (runStatus ? ['failed', 'blocked', 'timed_out', 'needs_human'].includes(runStatus) : false);
  const isComplete = taskStatus === 'completed' || session.phase === 'Completed';
  const isRunning =
    !hasProblem &&
    !isComplete &&
    (session.group === 'processing' ||
      ['running', 'context_compiling', 'compiling_context', 'finalizing', 'verifying'].includes(
        taskStatus
      ) ||
      (runStatus
        ? ['running', 'context_compiling', 'compiling_context', 'finalizing', 'verifying'].includes(
            runStatus
          )
        : false));

  if (hasProblem) {
    return <span className="h-2 w-2 shrink-0 rounded-full bg-rose-500" title="問題あり" />;
  }
  if (isComplete) {
    return <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" title="完了" />;
  }
  if (isRunning) {
    return (
      <LoaderCircle className="h-3 w-3 shrink-0 animate-spin text-cyan-300" aria-label="実行中" />
    );
  }
  return null;
}
