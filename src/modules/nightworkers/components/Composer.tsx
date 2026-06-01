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
      ? 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10'
      : realtimeStatus === 'connecting'
        ? 'text-cyan-300 border-cyan-500/30 bg-cyan-500/10'
        : realtimeStatus === 'disconnected'
          ? 'text-rose-300 border-rose-500/30 bg-rose-500/10'
          : 'text-zinc-300 border-zinc-600/40 bg-zinc-800/40';

  return (
    <div className="border-t border-zinc-800/80 bg-[#121214] p-4">
      <div className="relative mx-auto max-w-4xl rounded-2xl border border-[#30303b] bg-[#22222a] p-4">
        <div
          className={`absolute -top-3 left-4 rounded-full border px-3 py-1 text-[11px] ${wsStatusClass}`}
        >
          {wsStatusLabel}
        </div>
        {hasDiff ? (
          <div className="absolute -top-3 right-4 rounded-full border border-zinc-700 bg-[#121214] px-3 py-1 text-[11px]">
            <span className="text-zinc-300">{diffFiles} files</span>{' '}
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
          className="min-h-[58px] w-full resize-none border-0 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
        />
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-[#30303b]/20 pt-3">
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
            className={`h-8 w-8 rounded-full flex items-center justify-center ${canSubmit ? 'bg-zinc-200 text-black' : 'bg-zinc-800 text-zinc-600'}`}
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
