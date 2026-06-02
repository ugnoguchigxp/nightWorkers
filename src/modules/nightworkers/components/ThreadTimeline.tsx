import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import type { ReviewResult, Task, TaskEvent, TaskMessage, TaskRun } from '../types';
import { formatFinishedTime } from '../utils/time';
import { ThreadMessage } from './ThreadMessage';

type ThreadTimelineProps = {
  session: Task;
  runs: TaskRun[];
  latestRun?: TaskRun;
  taskMessages: TaskMessage[];
  latestRunEvents: TaskEvent[];
  isAgentWorking: boolean;
  onReviewRun: (runId: string) => void;
};

export function ThreadTimeline({
  session,
  runs,
  taskMessages,
  latestRunEvents,
  isAgentWorking,
  onReviewRun,
}: ThreadTimelineProps) {
  const [showDebugEvents, setShowDebugEvents] = useState(false);
  const chatMessages = taskMessages.filter(
    (message) => message.role === 'user' || message.role === 'assistant'
  );
  const timelineItems = [
    ...chatMessages.map((message) => ({
      kind: 'message' as const,
      id: `msg-${message.id}`,
      ts: toMs(message.createdAt),
      message,
    })),
    ...latestRunEvents.map((event) => ({
      kind: 'event' as const,
      id: `evt-${event.id}`,
      ts: toMs(event.timestamp || event.createdAt),
      event,
    })),
  ].sort((a, b) => a.ts - b.ts);

  const latestEvent = latestRunEvents[latestRunEvents.length - 1];
  const streamingPreview = isAgentWorking ? buildStreamingResponsePreview(latestRunEvents) : null;

  return (
    <div className="space-y-5 p-6">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setShowDebugEvents((v) => !v)}
          className="rounded border border-slate-600/80 bg-slate-900/40 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800/50"
        >
          {showDebugEvents ? 'Hide Debug' : 'Show Debug'}
        </button>
      </div>
      {showDebugEvents && isAgentWorking && latestEvent ? (
        <div className="rounded-lg border border-slate-700/80 bg-slate-900/50 px-3 py-2 text-xs text-slate-200">
          <span className="mr-2 inline-flex h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
          Live: {latestEvent.message}
        </div>
      ) : null}
      {timelineItems.map((item) =>
        item.kind === 'message' ? (
          <ThreadMessage
            key={item.id}
            messageRole={
              item.message.role === 'assistant'
                ? 'assistant'
                : item.message.role === 'user'
                  ? 'user'
                  : 'system'
            }
            timestamp={formatFinishedTime(item.message.createdAt)}
          >
            <MessagePayload message={item.message} />
          </ThreadMessage>
        ) : showDebugEvents ||
          hasApplyPatchContent(item.event) ||
          isReviewerEvaluationEvent(item.event) ? (
          <div key={item.id} className="space-y-2">
            <ReviewerEvaluationCard event={item.event} />
            <AgentPatchSummaryCard event={item.event} />
            {showDebugEvents ? <AgentDebugEventCard event={item.event} /> : null}
          </div>
        ) : null
      )}
      {streamingPreview ? (
        <ThreadMessage messageRole="assistant">
          <StreamingResponsePreview preview={streamingPreview} />
        </ThreadMessage>
      ) : null}
      {isAgentWorking ? (
        <ThreadMessage messageRole="assistant">
          <ThinkingIndicator />
        </ThreadMessage>
      ) : null}
    </div>
  );
}

function StreamingResponsePreview({ preview }: { preview: StreamingPreview }) {
  return (
    <div className="space-y-2" aria-live="polite">
      <div className="inline-flex items-center gap-2 text-xs text-cyan-200">
        <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-cyan-300" />
        応答を生成中
      </div>
      {preview.visibleText ? (
        <div className="whitespace-pre-wrap text-sm leading-6 text-slate-100">
          {preview.visibleText}
          <span className="ml-0.5 inline-block h-4 w-1 animate-pulse bg-cyan-300 align-[-2px]" />
        </div>
      ) : (
        <div className="text-xs text-slate-400">{preview.statusText}</div>
      )}
    </div>
  );
}

type StreamingPreview = {
  visibleText: string;
  statusText: string;
};

function buildStreamingResponsePreview(events: TaskEvent[]): StreamingPreview | null {
  const chunks = events
    .filter((event) => {
      const payload = event.payloadJson as any;
      return payload?.runEvent?.type === 'model.response_delta';
    })
    .map((event) => {
      const payload = event.payloadJson as any;
      return String(payload?.runEvent?.data?.text || event.message || '');
    })
    .filter(Boolean);

  if (chunks.length === 0) return null;

  const raw = chunks.join('');
  const parsed = tryParseJsonObject(raw);
  if (typeof parsed?.finalResponse === 'string' && parsed.finalResponse.trim()) {
    return { visibleText: parsed.finalResponse, statusText: '最終回答を組み立てています。' };
  }

  const partialFinalResponse = extractPartialJsonStringValue(raw, 'finalResponse');
  if (partialFinalResponse.trim()) {
    return {
      visibleText: partialFinalResponse,
      statusText: '最終回答を生成しています。',
    };
  }

  return {
    visibleText: '',
    statusText: 'Supervisor の応答構造を生成しています。',
  };
}

function tryParseJsonObject(raw: string): any | null {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function extractPartialJsonStringValue(raw: string, key: string): string {
  const match = new RegExp(`"${key}"\\s*:\\s*"`).exec(raw);
  if (!match) return '';
  const valueStart = match.index + match[0].length;
  let value = '';
  let escaped = false;
  for (let i = valueStart; i < raw.length; i += 1) {
    const char = raw[i];
    if (escaped) {
      value += decodeJsonEscape(char);
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') break;
    value += char;
  }
  return value;
}

function decodeJsonEscape(char: string): string {
  if (char === 'n') return '\n';
  if (char === 'r') return '\r';
  if (char === 't') return '\t';
  return char;
}

function ThinkingIndicator() {
  return (
    <div
      className="inline-flex h-8 items-center gap-2"
      aria-label="AIが返答を生成中です"
      role="status"
    >
      {[0, 1, 2, 3].map((dot) => (
        <span
          key={dot}
          className="nightworkers-thinking-dot h-3 w-3 rounded-full bg-cyan-400 shadow-[0_0_14px_rgba(34,211,238,0.55)]"
          style={{ animationDelay: `${dot * 140}ms` }}
        />
      ))}
    </div>
  );
}

function AgentPatchSummaryCard({ event }: { event: TaskEvent }) {
  const payload = event.payloadJson as any;
  const patchContent = getApplyPatchContent(payload);
  const sections =
    typeof patchContent === 'string' && patchContent.trim()
      ? parseApplyPatchSections(patchContent)
      : [];

  if (sections.length === 0) return null;

  return (
    <details className="rounded border border-slate-700/80 bg-slate-900/30">
      <summary className="cursor-pointer list-none px-3 py-2 text-xs text-slate-200">
        コード変更 ({sections.length})
      </summary>
      <div className="space-y-1 border-t border-slate-700/80 px-3 py-2 text-xs">
        {sections.map((section, idx) => (
          <div
            key={`${event.id}-section-${idx}`}
            className="rounded border border-slate-700/70 bg-slate-950/40 px-2 py-1"
          >
            <div className="truncate text-slate-200">{section.path}</div>
            <div className="text-slate-400">
              <span className="text-emerald-400">+{section.added}</span>{' '}
              <span className="text-rose-400">-{section.deleted}</span>
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}

function ReviewerEvaluationCard({ event }: { event: TaskEvent }) {
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

function isReviewerEvaluationEvent(event: TaskEvent): boolean {
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

function hasApplyPatchContent(event: TaskEvent): boolean {
  const payload = event.payloadJson as any;
  const patchContent = getApplyPatchContent(payload);
  return typeof patchContent === 'string' && patchContent.trim().length > 0;
}

function AgentDebugEventCard({ event }: { event: TaskEvent }) {
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
            round {round}
          </span>
        ) : null}
        {phase ? (
          <span className="rounded border border-slate-600/80 px-1.5 py-0.5 text-slate-300">
            {phase}
          </span>
        ) : null}
        {toolName ? (
          <span className="rounded border border-slate-600/80 px-1.5 py-0.5 text-slate-300">
            tool: {toolName}
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
              aria-label="Copy debug JSON"
            >
              {copiedEventId === event.id ? (
                <>
                  <Check className="h-3 w-3" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3" />
                  Copy
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

function ReviewResultSummary({ reviewResult }: { reviewResult: ReviewResult }) {
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

function getApplyPatchContent(payload: any): string | null {
  const toolName = payload?.toolName || payload?.toolCall?.name;
  if (toolName !== 'apply_patch') return null;
  return (
    payload?.arguments?.patchContent ||
    payload?.toolCall?.arguments?.patchContent ||
    payload?.decision?.toolCall?.arguments?.patchContent ||
    null
  );
}

function parseApplyPatchSections(
  patchContent: string
): Array<{ path: string; added: number; deleted: number }> {
  const lines = patchContent.split('\n');
  const sections: Array<{ path: string; added: number; deleted: number }> = [];
  let activePath: string | null = null;
  let activeSection: { path: string; added: number; deleted: number } | null = null;

  const pushSection = () => {
    if (activeSection) sections.push(activeSection);
  };

  for (const line of lines) {
    if (line.startsWith('*** Update File: ')) {
      pushSection();
      activePath = line.replace('*** Update File: ', '').trim();
      activeSection = null;
      continue;
    }
    if (line.startsWith('*** Add File: ')) {
      pushSection();
      activePath = line.replace('*** Add File: ', '').trim();
      activeSection = null;
      continue;
    }
    if (line.startsWith('*** Delete File: ')) {
      pushSection();
      const deletedPath = line.replace('*** Delete File: ', '').trim();
      sections.push({ path: deletedPath, added: 0, deleted: 0 });
      activePath = null;
      activeSection = null;
      continue;
    }
    if (line.startsWith('@@')) {
      pushSection();
      activeSection = { path: activePath || 'unknown', added: 0, deleted: 0 };
      continue;
    }
    if (!activeSection) continue;
    if (line.startsWith('+') && !line.startsWith('+++')) activeSection.added += 1;
    if (line.startsWith('-') && !line.startsWith('---')) activeSection.deleted += 1;
  }
  pushSection();

  return sections;
}

function toMs(value: unknown): number {
  if (!value) return Number.MAX_SAFE_INTEGER;
  const n = Date.parse(String(value));
  return Number.isNaN(n) ? Number.MAX_SAFE_INTEGER : n;
}

function MessagePayload({ message }: { message: TaskMessage }) {
  const metadata = message.metadataJson as any;
  if (message.messageType === 'chart' && metadata?.chartData) {
    return (
      <div className="space-y-2">
        <div className="text-xs font-semibold text-zinc-300">Chart</div>
        <pre className="whitespace-pre-wrap break-all rounded-md bg-black/30 p-2 text-xs">
          {JSON.stringify(metadata.chartData, null, 2)}
        </pre>
      </div>
    );
  }
  if (message.messageType === 'browser' && metadata?.browserFrameData?.url) {
    return (
      <div className="space-y-2">
        <div className="text-xs font-semibold text-zinc-300">Browser</div>
        <a
          className="text-cyan-300 underline"
          href={metadata.browserFrameData.url}
          target="_blank"
          rel="noreferrer"
        >
          {metadata.browserFrameData.url}
        </a>
      </div>
    );
  }
  if (message.messageType === 'flow' && metadata?.flowData) {
    return (
      <div className="space-y-2">
        <div className="text-xs font-semibold text-zinc-300">Flow</div>
        <pre className="whitespace-pre-wrap break-all rounded-md bg-black/30 p-2 text-xs">
          {JSON.stringify(metadata.flowData, null, 2)}
        </pre>
      </div>
    );
  }
  if (message.messageType === 'playwright' && metadata?.playwrightResult) {
    return (
      <div className="space-y-2">
        <div className="text-xs font-semibold text-zinc-300">Playwright</div>
        <pre className="whitespace-pre-wrap break-all rounded-md bg-black/30 p-2 text-xs">
          {JSON.stringify(metadata.playwrightResult, null, 2)}
        </pre>
      </div>
    );
  }
  if (message.messageType === 'markdown_document' && metadata?.markdownDocumentData?.content) {
    return (
      <pre className="whitespace-pre-wrap break-all rounded-md bg-black/30 p-2 text-xs">
        {metadata.markdownDocumentData.content}
      </pre>
    );
  }
  return <>{message.content}</>;
}
