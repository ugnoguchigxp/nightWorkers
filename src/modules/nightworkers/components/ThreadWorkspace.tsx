import type {
  ModelOption,
  Repository,
  Task,
  TaskEvent,
  TaskMessage,
  TaskRun,
  ThinkingDepth,
} from '../types';
import { THINKING_DEPTH_OPTIONS } from '../types';
import { Composer } from './Composer';
import { ThreadTimeline } from './ThreadTimeline';

type ThreadWorkspaceProps = {
  activeSession: Task | null;
  activeProject: Repository | null;
  runs: TaskRun[];
  latestRun?: TaskRun;
  taskMessages: TaskMessage[];
  latestRunEvents: TaskEvent[];
  isAgentWorking: boolean;
  realtimeStatus: 'initializing' | 'connecting' | 'connected' | 'disconnected';
  model: string;
  thinkingDepth: ThinkingDepth;
  onModelChange: (model: string) => void;
  modelOptions: ModelOption[];
  onThinkingDepthChange: (depth: ThinkingDepth) => void;
  onSubmitInitialPrompt: (prompt: string) => Promise<void>;
  onReviewRun: (runId: string) => void;
};

export function ThreadWorkspace(props: ThreadWorkspaceProps) {
  return (
    <div className="relative flex min-h-screen min-w-0 flex-1 flex-col bg-[#111827]">
      <div className="shrink-0 border-b border-slate-700/70 bg-[#0f172a] px-6 py-4 pr-16">
        {props.activeSession ? (
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">{props.activeSession.title}</h2>
              <p className="text-xs text-slate-300/70">
                {props.activeProject?.name || 'No Project'}
              </p>
            </div>
            <span className="rounded-full border border-slate-600/80 bg-slate-800 px-2.5 py-0.5 text-[10px] uppercase text-slate-200">
              {props.activeSession.status}
            </span>
          </div>
        ) : (
          <p className="text-sm text-slate-300/70">作業スレッドを選択するか、下の入力欄から開始</p>
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
            isAgentWorking={props.isAgentWorking}
            onReviewRun={props.onReviewRun}
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
          onSubmit={props.onSubmitInitialPrompt}
        />
      </div>
    </div>
  );
}
