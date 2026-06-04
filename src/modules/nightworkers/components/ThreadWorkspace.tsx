import { Bug, FolderTree, GitCompare, LoaderCircle, PanelsTopLeft, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type {
  ActivityEvent,
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
} from '../types';
import { THINKING_DEPTH_OPTIONS } from '../types';
import { getRelativeTimestamp } from '../utils/time';
import { Composer } from './Composer';
import { ThreadMessage } from './ThreadMessage';
import { ThinkingIndicator, ThreadTimeline } from './ThreadTimeline';

type ThreadWorkspaceProps = {
  activeSession: Task | null;
  activeProject: Repository | null;
  runs: TaskRun[];
  latestRun?: TaskRun;
  taskMessages: TaskMessage[];
  latestRunEvents: TaskEvent[];
  activityEvents: ActivityEvent[];
  activeStreamingResponse: string;
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
  onOpenBlueprintArtifact: () => Promise<void>;
  isBlueprintArtifactOpen: boolean;
  isBlueprintActionBusy: boolean;
  isDiffArtifactOpen: boolean;
  onDeleteSession: () => void;
  onOpenArtifact: (artifact: WorkbenchArtifactRef) => void;
  isProjectFilesOpen: boolean;
  onOpenProjectFiles: () => void;
  onOpenDiffArtifact: (artifact: WorkbenchArtifactRef) => void;
};

export function ThreadWorkspace(props: ThreadWorkspaceProps) {
  const diffArtifacts = props.artifactRefs.filter((artifact) => artifact.kind === 'diff');
  const blueprintArtifact = props.artifactRefs.find(
    (artifact) => artifact.kind === 'app_blueprint'
  );
  const latestDiffArtifact = diffArtifacts[0];
  const [showDebugEvents, setShowDebugEvents] = useState(false);
  return (
    <div className="relative flex h-screen min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#111827]">
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
                  title={showDebugEvents ? 'Hide debug events' : 'Show debug events'}
                >
                  <Bug className="h-3.5 w-3.5" />
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
                  className={`inline-flex h-7 w-7 items-center justify-center rounded border ${
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
                      ? 'Hide Code Diff artifact'
                      : latestDiffArtifact
                        ? 'Open Code Diff artifact'
                        : 'No Code Diff artifact'
                  }
                  aria-label={
                    props.isDiffArtifactOpen
                      ? 'Hide Code Diff artifact'
                      : latestDiffArtifact
                        ? 'Open Code Diff artifact'
                        : 'No Code Diff artifact'
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
                  disabled={props.isBlueprintActionBusy || !props.activeSession}
                  title={
                    props.isBlueprintArtifactOpen
                      ? 'Hide Blueprint artifact'
                      : blueprintArtifact
                        ? 'Open Blueprint artifact'
                        : 'Create Blueprint artifact'
                  }
                  aria-label={
                    props.isBlueprintArtifactOpen
                      ? 'Hide Blueprint artifact'
                      : blueprintArtifact
                        ? 'Open Blueprint artifact'
                        : 'Create Blueprint artifact'
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
            <p className="text-sm text-slate-300/70">
              作業スレッドを選択するか、下の入力欄から開始
            </p>
            <button
              type="button"
              className={`inline-flex h-7 w-7 items-center justify-center rounded border ${
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
      <div className="nightworkers-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain pb-44">
        {props.activeSession ? (
          <ThreadTimeline
            session={props.activeSession}
            runs={props.runs}
            latestRun={props.latestRun}
            taskMessages={props.taskMessages}
            latestRunEvents={props.latestRunEvents}
            activityEvents={props.activityEvents}
            activeStreamingResponse={props.activeStreamingResponse}
            latestRunTodos={props.latestRunTodos}
            isAgentWorking={props.isAgentThinking}
            showDebugEvents={showDebugEvents}
            onOpenArtifact={props.onOpenArtifact}
          />
        ) : props.isAgentThinking ? (
          <div className="nightworkers-chat-window space-y-5 p-6">
            <ThreadMessage messageRole="assistant">
              <ThinkingIndicator />
            </ThreadMessage>
          </div>
        ) : (
          <div className="h-[40vh]" />
        )}
      </div>
      <div className="absolute right-0 bottom-0 left-0 z-20">
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
