import { ArrowUp } from 'lucide-react';
import { useState } from 'react';
import type { ModelOption, ThinkingDepth, ThinkingDepthOption } from '../types';
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
  onSubmit: (prompt: string) => Promise<void>;
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
  const canSubmit = !disabled && !!prompt.trim();
  const hasDiff = !!latestDiffPatch.trim();
  const diffFiles = hasDiff ? getChangedFiles(latestDiffPatch).length : 0;
  const diffStats = hasDiff ? getDiffStats(latestDiffPatch) : { added: 0, deleted: 0 };
  const wsStatusLabel =
    realtimeStatus === 'connected'
      ? 'WS 接続完了'
      : realtimeStatus === 'connecting'
        ? 'WS 接続中'
        : realtimeStatus === 'disconnected'
          ? 'WS 切断'
          : 'WS 初期化中';
  const wsStatusClass =
    realtimeStatus === 'connected'
      ? 'text-slate-100 border-slate-500 bg-slate-700'
      : realtimeStatus === 'connecting'
        ? 'text-slate-100 border-slate-500 bg-slate-700'
        : realtimeStatus === 'disconnected'
          ? 'text-slate-100 border-slate-500 bg-slate-700'
          : 'text-slate-100 border-slate-500 bg-slate-800';

  return (
    <div className="bg-transparent p-4">
      <div className="relative mx-auto max-w-4xl rounded-2xl border border-slate-600/70 bg-[#1e293b] p-4 shadow-[0_0_0_1px_rgba(148,163,184,0.08)]">
        <div
          className={`absolute -top-3 left-4 rounded-full border px-3 py-1 text-[11px] ${wsStatusClass}`}
        >
          {wsStatusLabel}
        </div>
        {hasDiff ? (
          <div className="absolute -top-3 right-4 rounded-full border border-slate-600/80 bg-slate-800 px-3 py-1 text-[11px]">
            <span className="text-slate-200">{diffFiles} files</span>{' '}
            <span className="text-emerald-400">+{diffStats.added}</span>{' '}
            <span className="text-rose-400">-{diffStats.deleted}</span>
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
              await onSubmit(text);
            }
          }}
          disabled={disabled}
          placeholder="指示を入力（送信: Cmd+Enter / Ctrl+Enter）"
          className="min-h-[58px] w-full resize-none border-0 bg-transparent text-sm text-slate-100 placeholder:text-slate-300/60 focus:outline-none"
        />
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-600/50 pt-3">
          <ModelThinkingControls
            model={model}
            thinkingDepth={thinkingDepth}
            modelOptions={modelOptions}
            thinkingDepthOptions={thinkingDepthOptions}
            onModelChange={onModelChange}
            onThinkingDepthChange={onThinkingDepthChange}
          />
          <button
            type="button"
            onClick={async () => {
              if (!canSubmit) return;
              const text = prompt.trim();
              setPrompt('');
              await onSubmit(text);
            }}
            disabled={!canSubmit}
            className={`h-8 w-8 rounded-full flex items-center justify-center ${canSubmit ? 'bg-slate-200 text-slate-900' : 'bg-slate-700 text-slate-400'}`}
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
