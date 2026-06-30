import { ArrowUp, CircleStop, LoaderCircle, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  ModelOption,
  ThinkingDepth,
  ThinkingDepthOption,
  WorkbenchArtifactContext,
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
  draftStorageKey?: string;
  initialPrompt?: string;
  discardStoredDraft?: boolean;
  artifactContext?: WorkbenchArtifactContext | null;
  realtimeStatus?: 'initializing' | 'connecting' | 'connected' | 'disconnected';
  isStopMode?: boolean;
  isStopping?: boolean;
  onModelChange: (model: string) => void;
  onThinkingDepthChange: (depth: ThinkingDepth) => void;
  onSubmit: (prompt: string, intent: WorkbenchChatIntent) => Promise<void>;
  onClearArtifactContext?: () => void;
  onStop?: () => Promise<void>;
};

export function Composer({
  disabled,
  model,
  thinkingDepth,
  modelOptions,
  thinkingDepthOptions,
  latestDiffPatch = '',
  draftStorageKey,
  initialPrompt = '',
  discardStoredDraft = false,
  artifactContext = null,
  realtimeStatus = 'initializing',
  isStopMode = false,
  isStopping = false,
  onModelChange,
  onThinkingDepthChange,
  onSubmit,
  onClearArtifactContext,
  onStop,
}: ComposerProps) {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState('');
  const intent: WorkbenchChatIntent = 'intake';
  const canSubmit = !disabled && !!prompt.trim();
  const canStop = isStopMode && !!onStop && !isStopping;
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

  useEffect(() => {
    if (!draftStorageKey) {
      setPrompt('');
      return;
    }
    if (discardStoredDraft) {
      try {
        window.localStorage.removeItem(draftStorageKey);
      } catch {
        // localStorage can be unavailable in private contexts; the in-memory draft still works.
      }
      setPrompt('');
      return;
    }
    try {
      setPrompt(window.localStorage.getItem(draftStorageKey) || initialPrompt);
    } catch {
      setPrompt(initialPrompt);
    }
  }, [discardStoredDraft, draftStorageKey, initialPrompt]);

  useEffect(() => {
    if (!draftStorageKey || discardStoredDraft) return;
    try {
      if (prompt) window.localStorage.setItem(draftStorageKey, prompt);
      else window.localStorage.removeItem(draftStorageKey);
    } catch {
      // localStorage can be unavailable in private contexts; the in-memory draft still works.
    }
  }, [discardStoredDraft, draftStorageKey, prompt]);

  async function submitCurrentPrompt() {
    if (!canSubmit) return;
    const text = prompt.trim();
    await onSubmit(text, intent);
    if (draftStorageKey) {
      try {
        window.localStorage.removeItem(draftStorageKey);
      } catch {
        // localStorage cleanup is best-effort; prompt state still clears below.
      }
    }
    setPrompt('');
  }

  return (
    <div className="bg-transparent px-3 py-2">
      <div className="nightworkers-composer relative mx-auto max-w-4xl rounded-2xl border border-slate-600/55 bg-[#1e293b] p-4 shadow-[0_16px_40px_rgba(0,0,0,0.28)]">
        <div className={`absolute -top-[5px] left-4 h-3 w-3 rounded-full ${wsStatusDotClass}`} />
        {diffSummary ? (
          <div className="nightworkers-composer-badge absolute -top-3 right-4 rounded-full border border-slate-600/80 bg-slate-800 px-3 py-1 text-[11px]">
            <span className="text-slate-200">
              {t('composer.diffFiles', { count: diffSummary.files })}
            </span>{' '}
            <span className="text-emerald-400">+{diffSummary.stats.added}</span>{' '}
            <span className="text-rose-400">-{diffSummary.stats.deleted}</span>
          </div>
        ) : null}
        {artifactContext ? (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-cyan-500/40 bg-cyan-950/20 px-3 py-2 text-xs text-cyan-50">
            <span className="font-semibold">{t('composer.contextLabel')}</span>
            <span className="min-w-0 flex-1 truncate text-cyan-100/90">
              {artifactContext.title}
            </span>
            <span className="rounded border border-cyan-500/40 px-1.5 py-0.5 text-[10px] uppercase text-cyan-100/70">
              {artifactContext.kind}
            </span>
            {onClearArtifactContext ? (
              <button
                type="button"
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-cyan-500/40 text-cyan-100 hover:bg-cyan-900/40"
                onClick={onClearArtifactContext}
                aria-label={t('composer.clearContext')}
                title={t('composer.clearContext')}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        ) : null}
        <textarea
          rows={2}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={async (e) => {
            const isSubmitShortcut = e.key === 'Enter' && (e.metaKey || e.ctrlKey);
            // IME変換中のEnterでは送信しない
            const isComposing = (e.nativeEvent as KeyboardEvent).isComposing;
            if (isSubmitShortcut && !isComposing && canSubmit) {
              e.preventDefault();
              await submitCurrentPrompt();
            }
          }}
          disabled={disabled}
          placeholder={t('composer.placeholder')}
          className="nightworkers-composer-input min-h-[58px] w-full resize-none border-0 bg-transparent text-sm text-slate-100 placeholder:text-slate-300/60 focus:outline-none"
        />
        <div className="nightworkers-composer-toolbar mt-3 flex flex-wrap items-center gap-2 border-t border-slate-600/35 pt-3">
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
              if (isStopMode) {
                if (!canStop || !onStop) return;
                await onStop();
                return;
              }
              await submitCurrentPrompt();
            }}
            disabled={isStopMode ? !canStop : !canSubmit}
            aria-label={isStopMode ? t('composer.stop') : t('composer.send')}
            title={isStopMode ? t('composer.stop') : t('composer.send')}
            className={`nightworkers-composer-submit ml-auto flex h-8 w-8 items-center justify-center rounded-full ${
              isStopMode
                ? canStop
                  ? 'nightworkers-composer-stop bg-rose-500 text-white hover:bg-rose-400'
                  : 'nightworkers-composer-stop-idle bg-rose-900/50 text-rose-200'
                : canSubmit
                  ? 'nightworkers-composer-submit-ready bg-slate-200 text-slate-900'
                  : 'nightworkers-composer-submit-idle bg-slate-700 text-slate-400'
            }`}
          >
            {isStopMode ? (
              isStopping ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <CircleStop className="h-4 w-4" />
              )
            ) : (
              <ArrowUp className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
