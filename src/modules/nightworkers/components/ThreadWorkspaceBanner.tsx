import type { TaskLlmUsageSummary, WorkbenchSessionView } from '../types';

export function WorkbenchStateBanner({
  sessionView,
  model,
  onRemoveQueueEntry,
  onSubmitReview,
  onRequeueQueueEntry,
  onArchiveQueueExecution,
  onOpenDiff,
  hasDiff,
}: {
  sessionView: WorkbenchSessionView | null;
  model: string;
  onRemoveQueueEntry: () => void;
  onSubmitReview: (action: 'complete' | 'cancel', note?: string) => void;
  onRequeueQueueEntry: (note?: string) => void;
  onArchiveQueueExecution: () => void;
  onOpenDiff: () => void;
  hasDiff: boolean;
}) {
  if (!sessionView) return null;
  if (sessionView.emailState === 'plan_ready') return null;
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
        <CodexDiagnosticsPanel sessionView={sessionView} tone="amber" />
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
        <CodexDiagnosticsPanel sessionView={sessionView} tone="slate" />
      </div>
    );
  }
  return (
    <div className="border-b border-slate-700/60 bg-slate-950/20 px-6 py-2 text-xs text-slate-300">
      <div>
        Session state: {stateLabel(sessionView)} · Model profile: {model}
      </div>
      <CodexDiagnosticsPanel sessionView={sessionView} tone="slate" compact />
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

function CodexDiagnosticsPanel({
  sessionView,
  tone,
  compact = false,
}: {
  sessionView: WorkbenchSessionView;
  tone: 'amber' | 'slate';
  compact?: boolean;
}) {
  const warnings = sessionView.codexContractWarnings;
  const mcp = sessionView.codexMcpDiagnostics;
  if (!warnings?.totalCount && !mcp) return null;
  const borderClass = tone === 'amber' ? 'border-amber-300/25' : 'border-slate-600';
  const textClass = tone === 'amber' ? 'text-amber-100' : 'text-slate-100';
  const subTextClass = tone === 'amber' ? 'text-amber-200/75' : 'text-slate-300';
  const mcpToneClass =
    mcp?.tone === 'warning'
      ? 'border-amber-300/40 text-amber-100'
      : mcp?.tone === 'info'
        ? 'border-sky-300/35 text-sky-100'
        : 'border-slate-500 text-slate-200';
  return (
    <div
      className={`${compact ? 'mt-2' : 'mt-3 rounded border px-3 py-2'} ${compact ? '' : borderClass}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {warnings?.totalCount ? (
          <span
            className={`rounded border px-2 py-0.5 text-[11px] ${
              warnings.errorCount > 0
                ? 'border-red-300/45 text-red-100'
                : 'border-amber-300/40 text-amber-100'
            }`}
          >
            Contract warnings: {warnings.warningCount} warning / {warnings.errorCount} error
          </span>
        ) : null}
        {mcp ? (
          <span className={`rounded border px-2 py-0.5 text-[11px] ${mcpToneClass}`}>
            {mcp.label}
            {mcp.observedNightWorkersTools.length > 0
              ? ` · observed ${mcp.observedNightWorkersTools.length}`
              : ''}
          </span>
        ) : null}
      </div>
      {warnings?.items.length ? (
        <div className={`mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] ${subTextClass}`}>
          {warnings.items.slice(0, 4).map((item) => (
            <span key={item.code} title={item.changedFiles.join(', ')}>
              {item.code} x{item.count}
            </span>
          ))}
        </div>
      ) : null}
      {!compact && mcp?.expectedTools.length ? (
        <div className={`mt-1 text-[11px] ${subTextClass}`}>
          MCP expected tools: {mcp.expectedTools.length}
        </div>
      ) : null}
      {!compact && warnings?.totalCount ? (
        <div className={`mt-1 text-[11px] ${textClass}`}>Codex contract diagnostics</div>
      ) : null}
    </div>
  );
}

function stateLabel(sessionView: WorkbenchSessionView) {
  if (sessionView.emailState === 'draft') return 'Draft';
  if (sessionView.emailState === 'running') return 'Running';
  if (sessionView.emailState === 'needs_input') return 'Needs Attention';
  if (sessionView.emailState === 'done') return 'Done';
  if (sessionView.emailState === 'failed') return 'Failed';
  return sessionView.emailState;
}

export function formatUsageBadge(summary: TaskLlmUsageSummary | null) {
  return `i:${formatTokenCount(summary?.inputTokens ?? 0)} / o:${formatTokenCount(
    summary?.outputTokens ?? 0
  )}`;
}

export function formatUsageTitle(summary: TaskLlmUsageSummary | null) {
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
