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
  const intent: WorkbenchChatIntent = 'intake';
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
      <div className="nightworkers-composer relative mx-auto max-w-4xl rounded-2xl border border-slate-600/70 bg-[#1e293b] p-4 shadow-[0_0_0_1px_rgba(148,163,184,0.08)]">
        <div className={`absolute -top-[5px] left-4 h-3 w-3 rounded-full ${wsStatusDotClass}`} />
        {diffSummary ? (
          <div className="nightworkers-composer-badge absolute -top-3 right-4 rounded-full border border-slate-600/80 bg-slate-800 px-3 py-1 text-[11px]">
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
          className="nightworkers-composer-input min-h-[58px] w-full resize-none border-0 bg-transparent text-sm text-slate-100 placeholder:text-slate-300/60 focus:outline-none"
        />
        <div className="nightworkers-composer-toolbar mt-3 flex flex-wrap items-center gap-2 border-t border-slate-600/50 pt-3">
          <div className="flex shrink-0 items-center gap-2">
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
            className={`nightworkers-composer-submit ml-auto flex h-8 w-8 items-center justify-center rounded-full ${
              canSubmit
                ? 'nightworkers-composer-submit-ready bg-slate-200 text-slate-900'
                : 'nightworkers-composer-submit-idle bg-slate-700 text-slate-400'
            }`}
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
