import type { CodeBlockData } from '@repo/design-system';
import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ReviewResult, TaskEvent } from '../types';
import {
  asNumber,
  asString,
  buildApplyPatchCodeBlockData,
  buildReplaceContentCodeBlockData,
  estimateReplacementStats,
  getApplyPatchContent,
  getChangedFilesFromResult,
  getToolArguments,
  getToolName,
  getToolResult,
  parseApplyPatchSections,
} from './ThreadTimeline';
import { NightWorkersCodeBlock } from './ThreadTimelineMarkdown';

export function AgentEditSummaryCard({ event }: { event: TaskEvent }) {
  const summary = getAgentEditSummary(event);
  if (!summary) return null;

  return (
    <details className="rounded border border-slate-700/80 bg-slate-900/30">
      <summary className="cursor-pointer list-none px-3 py-2 text-xs text-slate-200">
        コード変更 ({summary.sections.length}){' '}
        <span className="text-slate-400">{summary.toolName}</span>
      </summary>
      <div className="space-y-3 border-t border-slate-700/80 px-3 py-2 text-xs">
        <div className="space-y-1">
          {summary.sections.map((section, idx) => (
            <div
              key={`${event.id}-section-${idx}`}
              className="rounded border border-slate-700/70 bg-slate-950/40 px-2 py-1"
            >
              <div className="truncate text-slate-200">{section.path}</div>
              <div className="text-slate-400">
                {typeof section.added === 'number' || typeof section.deleted === 'number' ? (
                  <>
                    <span className="text-emerald-400">+{section.added || 0}</span>{' '}
                    <span className="text-rose-400">-{section.deleted || 0}</span>
                  </>
                ) : null}
                {section.detail ? <span className="ml-2">{section.detail}</span> : null}
              </div>
            </div>
          ))}
        </div>
        {summary.codeBlocks?.length ? (
          <NightWorkersCodeBlock data={summary.codeBlocks} maxHeight={320} />
        ) : null}
      </div>
    </details>
  );
}

export function ReviewerEvaluationCard({ event }: { event: TaskEvent }) {
  const payload = event.payloadJson as any;
  const runEvent = payload?.runEvent;
  if (!isReviewerEvaluationEvent(event)) return null;
  const data = runEvent?.data || {};
  const eventType = runEvent?.type || event.eventType || event.type;
  const status = data.status || (eventType === 'review.evaluation_started' ? 'started' : 'loaded');
  const verdict = data.finalReviewerVerdict || data.deterministicVerdict;
  const blockingCount = data.blockingFindingCount;
  const degradedReasons = Array.isArray(data.degradedReasons) ? data.degradedReasons : [];

  return (
    <details className="rounded border border-amber-700/60 bg-amber-950/20">
      <summary className="cursor-pointer list-none px-3 py-2 text-xs text-amber-100">
        <span className="mr-2 rounded border border-amber-700/70 px-1.5 py-0.5">
          agent reviewer
        </span>
        {String(status)}
        {verdict ? <span className="ml-2 text-amber-200">verdict {String(verdict)}</span> : null}
        {typeof blockingCount === 'number' ? (
          <span className="ml-2 text-amber-200">blocking {blockingCount}</span>
        ) : null}
      </summary>
      <div className="space-y-2 border-t border-amber-800/60 px-3 py-2 text-[11px] text-amber-50">
        <div>{event.message}</div>
        {degradedReasons.length > 0 ? (
          <div className="text-amber-200">degraded: {degradedReasons.join(', ')}</div>
        ) : null}
        <pre className="max-h-[220px] overflow-auto whitespace-pre-wrap break-all rounded bg-slate-950/40 p-2 text-[10px] text-slate-300">
          {JSON.stringify(data, null, 2)}
        </pre>
      </div>
    </details>
  );
}

export function isReviewerEvaluationEvent(event: TaskEvent): boolean {
  const payload = event.payloadJson as any;
  const type = payload?.runEvent?.type || event.eventType || event.type;
  return (
    type === 'review.rubric_loaded' ||
    type === 'review.evaluation_started' ||
    type === 'review.llm_started' ||
    type === 'review.llm_finished' ||
    type === 'review.evaluation_finished'
  );
}

export function hasAgentEditSummary(event: TaskEvent): boolean {
  return getAgentEditSummary(event) !== null;
}

export function AgentDebugEventCard({ event }: { event: TaskEvent }) {
  const { t } = useTranslation();
  const [copiedEventId, setCopiedEventId] = useState<string | null>(null);
  const payload = event.payloadJson as any;
  const runEventType = payload?.runEvent?.type;
  const reviewResult = payload?.reviewResult;
  const toolName = payload?.toolName || payload?.toolCall?.name;
  const patchContent = getApplyPatchContent(payload);
  const round = payload?.round;
  const phase = payload?.phase;
  const patchLines = typeof patchContent === 'string' ? patchContent.split('\n') : [];

  return (
    <div className="rounded border border-slate-700/80 bg-slate-900/30 p-3">
      <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px]">
        <span className="rounded border border-slate-600/80 px-1.5 py-0.5 text-slate-200">
          {runEventType || event.eventType || event.type || 'event'}
        </span>
        {event.actor ? (
          <span className="rounded border border-slate-600/80 px-1.5 py-0.5 text-slate-300">
            {event.actor}
          </span>
        ) : null}
        {typeof round === 'number' ? (
          <span className="rounded border border-slate-600/80 px-1.5 py-0.5 text-slate-300">
            {t('timeline.roundLabel', { round })}
          </span>
        ) : null}
        {phase ? (
          <span className="rounded border border-slate-600/80 px-1.5 py-0.5 text-slate-300">
            {phase}
          </span>
        ) : null}
        {toolName ? (
          <span className="rounded border border-slate-600/80 px-1.5 py-0.5 text-slate-300">
            {t('timeline.toolLabel', { tool: toolName })}
          </span>
        ) : null}
      </div>
      <div className="mb-2 text-xs text-slate-100">{event.message}</div>
      {reviewResult ? <ReviewResultSummary reviewResult={reviewResult} /> : null}
      {typeof patchContent === 'string' && patchContent.trim() ? (
        <div className="mt-2 overflow-hidden rounded border border-slate-700/80 bg-[#0b1020]">
          <div className="flex items-center border-b border-slate-700/80 bg-[#131a2e] px-3 py-2 text-xs text-slate-300">
            apply_patch.patch
          </div>
          <div className="max-h-[320px] overflow-auto p-3 font-mono text-[12px] leading-6">
            {patchLines.map((line, idx) => {
              const lineClass = line.startsWith('+')
                ? 'bg-emerald-900/55 text-emerald-100'
                : line.startsWith('-')
                  ? 'bg-rose-900/55 text-rose-100'
                  : 'text-slate-100';
              return (
                <div
                  key={`${event.id}-patch-${idx}`}
                  className={`whitespace-pre-wrap break-all rounded px-2 ${lineClass}`}
                >
                  {line.length > 0 ? line : ' '}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
      {payload ? (
        <div className="mt-2">
          <div className="mb-1 flex justify-end">
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded border border-slate-600/80 bg-slate-900/40 px-2 py-1 text-[10px] text-slate-200 hover:bg-slate-800/50"
              onClick={async () => {
                const text = JSON.stringify(payload, null, 2);
                await navigator.clipboard.writeText(text);
                setCopiedEventId(event.id);
                setTimeout(
                  () => setCopiedEventId((current) => (current === event.id ? null : current)),
                  1200
                );
              }}
              aria-label={t('timeline.copyDebugJson')}
            >
              {copiedEventId === event.id ? (
                <>
                  <Check className="h-3 w-3" />
                  {t('timeline.copied')}
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3" />
                  {t('timeline.copy')}
                </>
              )}
            </button>
          </div>
          <pre className="whitespace-pre-wrap break-all rounded bg-slate-950/40 p-2 text-[10px] text-slate-300">
            {JSON.stringify(payload, null, 2)}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

export function ReviewResultSummary({ reviewResult }: { reviewResult: ReviewResult }) {
  return (
    <div className="mt-2 rounded border border-cyan-700/60 bg-cyan-950/25 px-3 py-2 text-[11px] text-cyan-50">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded border border-cyan-700/70 px-1.5 py-0.5 text-cyan-100">
          review_result
        </span>
        <span className="text-cyan-100">{reviewResult.action}</span>
        <span className="text-cyan-300">→ {reviewResult.verdict}</span>
        <span className="text-cyan-300">status {reviewResult.statusAfter}</span>
      </div>
      {reviewResult.note ? <div className="mt-1 text-cyan-100">{reviewResult.note}</div> : null}
      {reviewResult.outcome?.summary ? (
        <div className="mt-1 text-cyan-200">{reviewResult.outcome.summary}</div>
      ) : null}
    </div>
  );
}

export type AgentEditSummary = {
  toolName: 'apply_patch' | 'replace_content';
  sections: Array<{ path: string; added?: number; deleted?: number; detail?: string }>;
  codeBlocks?: CodeBlockData[];
};

export function getAgentEditSummary(event: TaskEvent): AgentEditSummary | null {
  const payload = event.payloadJson as any;
  const toolName = getToolName(payload);
  const args = getToolArguments(payload);
  const result = getToolResult(payload);

  if (toolName === 'apply_patch') {
    const patchContent = asString(args?.patchContent || getApplyPatchContent(payload));
    if (patchContent.trim()) {
      const sections = parseApplyPatchSections(patchContent);
      if (sections.length > 0) {
        return { toolName, sections, codeBlocks: buildApplyPatchCodeBlockData(patchContent) };
      }
    }
    const changedFiles = getChangedFilesFromResult(result);
    if (changedFiles.length > 0) {
      return {
        toolName,
        sections: changedFiles.map((path) => ({ path, detail: result?.ok ? 'applied' : 'failed' })),
      };
    }
    return null;
  }

  if (toolName === 'replace_content') {
    const filePath = asString(args?.filePath || result?.payload?.filePath);
    if (!filePath.trim()) return null;
    const occurrences = asNumber(result?.payload?.occurrences);
    const estimate = estimateReplacementStats({
      needle: asString(args?.needle),
      replacement: asString(args?.replacement),
      occurrences,
    });
    return {
      toolName,
      sections: [
        {
          path: filePath,
          added: estimate?.added,
          deleted: estimate?.deleted,
          detail:
            typeof occurrences === 'number'
              ? `${occurrences} occurrence${occurrences === 1 ? '' : 's'}`
              : 'replacement requested',
        },
      ],
      codeBlocks: buildReplaceContentCodeBlockData({
        filePath,
        needle: asString(args?.needle),
        replacement: asString(args?.replacement),
        occurrences,
      }),
    };
  }

  return null;
}
