import { ArrowUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import type {
  ModelOption,
  ThinkingDepth,
  ThinkingDepthOption,
  WorkbenchChatIntent,
} from '../types';
import { getChangedFiles, getDiffStats } from '../utils/diff';
import { ModelThinkingControls } from './ModelThinkingControls';

type ComposerProps = {
  disabled: boolean;
  model: string;
  thinkingDepth: ThinkingDepth;
  modelOptions: ModelOption[];
  thinkingDepthOptions: ThinkingDepthOption[];
  latestDiffPatch?: string;
  realtimeStatus?: 'initializing' | 'connecting' | 'connected' | 'disconnected';
  onModelChange: (model: string) => void;
  onThinkingDepthChange: (depth: ThinkingDepth) => void;
  onSubmit: (prompt: string, intent: WorkbenchChatIntent) => Promise<void>;
};

export function Composer({
  disabled,
  model,
  thinkingDepth,
  modelOptions,
  thinkingDepthOptions,
  latestDiffPatch = '',
  realtimeStatus = 'initializing',
  onModelChange,
  onThinkingDepthChange,
  onSubmit,
}: ComposerProps) {
  const [prompt, setPrompt] = useState('');
  const [planMode, setPlanMode] = useState(false);
  const intent: WorkbenchChatIntent = planMode ? 'draft_spec' : 'draft';
  const canSubmit = !disabled && !!prompt.trim();
  const diffSummary = useMemo(() => {
    if (!latestDiffPatch.trim()) return null;
    return {
      files: getChangedFiles(latestDiffPatch).length,
      stats: getDiffStats(latestDiffPatch),
    };
  }, [latestDiffPatch]);
  const wsStatusDotClass =
    realtimeStatus === 'connected'
      ? 'bg-emerald-400'
      : realtimeStatus === 'connecting'
        ? 'bg-orange-400'
        : realtimeStatus === 'disconnected'
          ? 'bg-red-500'
          : 'bg-orange-400';

  return (
    <div className="bg-transparent p-4">
      <div className="relative mx-auto max-w-4xl rounded-2xl border border-slate-600/70 bg-[#1e293b] p-4 shadow-[0_0_0_1px_rgba(148,163,184,0.08)]">
        <div className={`absolute -top-[5px] left-4 h-3 w-3 rounded-full ${wsStatusDotClass}`} />
        {diffSummary ? (
          <div className="absolute -top-3 right-4 rounded-full border border-slate-600/80 bg-slate-800 px-3 py-1 text-[11px]">
            <span className="text-slate-200">{diffSummary.files} files</span>{' '}
            <span className="text-emerald-400">+{diffSummary.stats.added}</span>{' '}
            <span className="text-rose-400">-{diffSummary.stats.deleted}</span>
          </div>
        ) : null}
        <textarea
          rows={3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={async (e) => {
            const isSubmitShortcut = e.key === 'Enter' && (e.metaKey || e.ctrlKey);
            // IME変換中のEnterでは送信しない
            const isComposing = (e.nativeEvent as KeyboardEvent).isComposing;
            if (isSubmitShortcut && !isComposing && canSubmit) {
              e.preventDefault();
              const text = prompt.trim();
              setPrompt('');
              await onSubmit(text, intent);
            }
          }}
          disabled={disabled}
          placeholder="指示を入力（送信: Cmd+Enter / Ctrl+Enter）"
          className="min-h-[58px] w-full resize-none border-0 bg-transparent text-sm text-slate-100 placeholder:text-slate-300/60 focus:outline-none"
        />
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-600/50 pt-3">
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setPlanMode((value) => !value)}
              className={`rounded border px-2 py-1 text-[10px] uppercase ${
                planMode
                  ? 'border-cyan-400/70 bg-cyan-950/30 text-cyan-100'
                  : 'border-slate-600/70 text-slate-300 hover:border-slate-400'
              }`}
            >
              Plan {planMode ? 'On' : 'Off'}
            </button>
            <ModelThinkingControls
              model={model}
              thinkingDepth={thinkingDepth}
              modelOptions={modelOptions}
              thinkingDepthOptions={thinkingDepthOptions}
              onModelChange={onModelChange}
              onThinkingDepthChange={onThinkingDepthChange}
            />
          </div>
          <button
            type="button"
            onClick={async () => {
              if (!canSubmit) return;
              const text = prompt.trim();
              setPrompt('');
              await onSubmit(text, intent);
            }}
            disabled={!canSubmit}
            className={`ml-auto flex h-8 w-8 items-center justify-center rounded-full ${canSubmit ? 'bg-slate-200 text-slate-900' : 'bg-slate-700 text-slate-400'}`}
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
