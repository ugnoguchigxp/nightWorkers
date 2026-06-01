import type { ModelOption, Repository, Task, TaskMessage, TaskRun, ThinkingDepth } from '../types';
import { THINKING_DEPTH_OPTIONS } from '../types';
import { Composer } from './Composer';
import { ThreadTimeline } from './ThreadTimeline';

type ThreadWorkspaceProps = {
  activeSession: Task | null;
  activeProject: Repository | null;
  runs: TaskRun[];
  latestRun?: TaskRun;
  taskMessages: TaskMessage[];
  latestRunEvents: Array<{
    id: string;
    actor?: string;
    type?: string;
    message: string;
    timestamp?: unknown;
  }>;
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
    <div className="flex h-full flex-1 flex-col overflow-hidden bg-[#151518]">
      <div className="shrink-0 border-b border-zinc-800/80 bg-[#0f0f11] px-6 py-4 pr-16">
        {props.activeSession ? (
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">{props.activeSession.title}</h2>
              <p className="text-xs text-zinc-500">{props.activeProject?.name || 'No Project'}</p>
            </div>
            <span className="rounded-full border border-zinc-700/60 bg-zinc-900 px-2.5 py-0.5 text-[10px] uppercase text-zinc-400">
              {props.activeSession.status}
            </span>
          </div>
        ) : (
          <p className="text-sm text-zinc-400">作業スレッドを選択するか、下の入力欄から開始</p>
        )}
      </div>
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
        <div className="flex-1" />
      )}
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
  );
}
