import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Circle,
  Copy,
  GitCompare,
  LoaderCircle,
  PanelsTopLeft,
  PauseCircle,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import type {
  ReviewResult,
  Task,
  TaskEvent,
  TaskMessage,
  TaskRun,
  TaskRunTodo,
  TodoStatus,
  WorkbenchArtifactRef,
} from '../types';
import { getChangedFiles } from '../utils/diff';
import { formatFinishedTime } from '../utils/time';
import { ThreadMessage } from './ThreadMessage';

type ThreadTimelineProps = {
  session: Task;
  runs: TaskRun[];
  latestRun?: TaskRun;
  taskMessages: TaskMessage[];
  latestRunEvents: TaskEvent[];
  activeStreamingResponse: string;
  latestRunTodos: TaskRunTodo[];
  isAgentWorking: boolean;
  showDebugEvents: boolean;
  onOpenArtifact: (artifact: WorkbenchArtifactRef) => void;
};

export function ThreadTimeline({
  session,
  runs,
  latestRun,
  taskMessages,
  latestRunEvents,
  activeStreamingResponse,
  latestRunTodos,
  isAgentWorking,
  showDebugEvents,
  onOpenArtifact,
}: ThreadTimelineProps) {
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
  const streamingPreview = isAgentWorking
    ? buildStreamingResponsePreview({
        events: latestRunEvents,
        activeStreamingResponse,
      })
    : null;
  const persistedStreamingPreview = !isAgentWorking
    ? buildPersistedStreamingResponsePreview({
        events: latestRunEvents,
        taskMessages,
        runId: latestRun?.id,
      })
    : null;

  return (
    <div className="nightworkers-chat-window space-y-5 p-6">
      <TodoProgress todos={latestRunTodos} />
      <ContextPackCard latestRun={latestRun} />
      <DiffSummaryCard session={session} latestRun={latestRun} onOpenArtifact={onOpenArtifact} />
      <FinalReportCard latestRun={latestRun} />
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
            <MessagePayload message={item.message} onOpenArtifact={onOpenArtifact} />
          </ThreadMessage>
        ) : showDebugEvents ||
          hasAgentEditSummary(item.event) ||
          isReviewerEvaluationEvent(item.event) ? (
          <div key={item.id} className="space-y-2">
            <ReviewerEvaluationCard event={item.event} />
            <AgentEditSummaryCard event={item.event} />
            {showDebugEvents ? <AgentDebugEventCard event={item.event} /> : null}
          </div>
        ) : null
      )}
      {streamingPreview ? (
        <ThreadMessage messageRole="assistant">
          <StreamingResponsePreview preview={streamingPreview} />
        </ThreadMessage>
      ) : null}
      {persistedStreamingPreview ? (
        <ThreadMessage messageRole="assistant">
          <PersistedStreamingResponse preview={persistedStreamingPreview} />
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

function ContextPackCard({ latestRun }: { latestRun?: TaskRun }) {
  if (!latestRun?.contextSnapshot) return null;
  return (
    <details className="rounded border border-slate-700/80 bg-slate-900/25">
      <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-slate-100">
        Context Pack
      </summary>
      <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap border-t border-slate-800 p-3 font-mono text-[11px] leading-5 text-slate-300">
        {JSON.stringify(latestRun.contextSnapshot, null, 2)}
      </pre>
    </details>
  );
}

function DiffSummaryCard({
  session,
  latestRun,
  onOpenArtifact,
}: {
  session: Task;
  latestRun?: TaskRun;
  onOpenArtifact: (artifact: WorkbenchArtifactRef) => void;
}) {
  if (!latestRun?.diffPatch?.trim()) return null;
  const changedFiles = getChangedFiles(latestRun.diffPatch);
  return (
    <div className="rounded border border-slate-700/80 bg-slate-900/25 px-3 py-2">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="min-w-0 text-xs font-medium text-slate-100">Code diff</div>
        <button
          type="button"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-slate-600/80 text-slate-200 hover:border-cyan-500/70 hover:text-cyan-100"
          onClick={() =>
            onOpenArtifact({
              id: `run-${latestRun.id}-diffPatch`,
              taskId: session.id,
              runId: latestRun.id,
              kind: 'diff',
              title: 'Code Diff',
              source: { type: 'run_field', runId: latestRun.id, field: 'diffPatch' },
              createdAt: String(latestRun.finishedAt || latestRun.updatedAt || latestRun.createdAt),
            })
          }
          title="Open diff viewer"
        >
          <GitCompare className="h-3.5 w-3.5" />
        </button>
      </div>
      {changedFiles.length > 0 ? (
        <ul className="grid gap-1">
          {changedFiles.slice(0, 6).map((file) => (
            <li key={file.path} className="flex items-center justify-between gap-3 text-[11px]">
              <span className="min-w-0 truncate text-slate-300">{file.path}</span>
              <span className="shrink-0 text-slate-500">
                <span className="text-emerald-300">+{file.added}</span>{' '}
                <span className="text-rose-300">-{file.deleted}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[11px] text-slate-500">Diff is available.</p>
      )}
    </div>
  );
}

function FinalReportCard({ latestRun }: { latestRun?: TaskRun }) {
  if (!latestRun?.finalReport?.trim()) return null;
  return (
    <ThreadMessage messageRole="assistant" timestamp={formatFinishedTime(latestRun.finishedAt)}>
      <div className="nightworkers-message-content whitespace-pre-wrap text-sm leading-6 text-slate-100">
        {latestRun.finalReport}
      </div>
    </ThreadMessage>
  );
}

function TodoProgress({ todos }: { todos: TaskRunTodo[] }) {
  if (todos.length === 0) return null;
  const completedCount = todos.filter((todo) => todo.status === 'passed').length;
  return (
    <section
      className="border-slate-700/80 border-y bg-slate-950/25 py-3"
      aria-label="Todo progress"
    >
      <div className="mb-2 flex items-center justify-between gap-3 px-1 text-xs text-slate-300">
        <span className="font-medium text-slate-100">Todo progress</span>
        <span className="shrink-0 text-slate-400">
          {completedCount}/{todos.length}
        </span>
      </div>
      <ol className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {todos.map((todo) => {
          const style = todoStatusStyle(todo.status);
          const Icon = style.icon;
          return (
            <li key={todo.id} className={`min-h-14 rounded border px-3 py-2 ${style.container}`}>
              <div className="flex min-w-0 items-start gap-2">
                <Icon
                  aria-hidden="true"
                  className={`mt-0.5 h-4 w-4 shrink-0 ${style.iconClass} ${
                    todo.status === 'running' ? 'animate-spin' : ''
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 text-[10px] text-slate-400">#{todo.seq}</span>
                    <span className="min-w-0 truncate text-xs font-medium text-slate-100">
                      {todo.title}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px]">
                    <span className={style.textClass}>{style.label}</span>
                    <span className="text-slate-500">{todo.taskType}</span>
                    {todo.procedureId ? (
                      <span className="max-w-full truncate text-slate-500">{todo.procedureId}</span>
                    ) : null}
                  </div>
                  {todo.statusReason ? (
                    <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-slate-400">
                      {todo.statusReason}
                    </p>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function todoStatusStyle(status: TodoStatus): {
  label: string;
  icon: typeof Circle;
  iconClass: string;
  textClass: string;
  container: string;
} {
  switch (status) {
    case 'passed':
      return {
        label: 'passed',
        icon: CheckCircle2,
        iconClass: 'text-emerald-300',
        textClass: 'text-emerald-200',
        container: 'border-emerald-500/35 bg-emerald-950/15',
      };
    case 'running':
      return {
        label: 'running',
        icon: LoaderCircle,
        iconClass: 'text-cyan-300',
        textClass: 'text-cyan-200',
        container: 'border-cyan-500/35 bg-cyan-950/15',
      };
    case 'failed':
      return {
        label: 'failed',
        icon: XCircle,
        iconClass: 'text-rose-300',
        textClass: 'text-rose-200',
        container: 'border-rose-500/35 bg-rose-950/15',
      };
    case 'skipped':
      return {
        label: 'skipped',
        icon: PauseCircle,
        iconClass: 'text-slate-400',
        textClass: 'text-slate-300',
        container: 'border-slate-600/50 bg-slate-900/25',
      };
    case 'needs_human':
      return {
        label: 'needs human',
        icon: AlertTriangle,
        iconClass: 'text-amber-300',
        textClass: 'text-amber-200',
        container: 'border-amber-500/35 bg-amber-950/15',
      };
    case 'pending':
      return {
        label: 'pending',
        icon: Circle,
        iconClass: 'text-slate-400',
        textClass: 'text-slate-300',
        container: 'border-slate-700/70 bg-slate-900/20',
      };
  }
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

function PersistedStreamingResponse({ preview }: { preview: StreamingPreview }) {
  return (
    <div className="whitespace-pre-wrap text-sm leading-6 text-slate-100">
      {preview.visibleText || preview.statusText}
    </div>
  );
}

type StreamingPreview = {
  visibleText: string;
  statusText: string;
};

function buildStreamingResponsePreview(input: {
  events: TaskEvent[];
  activeStreamingResponse?: string;
}): StreamingPreview | null {
  if (input.activeStreamingResponse?.trim()) {
    return buildStreamingPreviewFromRaw(input.activeStreamingResponse);
  }
  const chunks = input.events
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

  return buildStreamingPreviewFromRaw(chunks.join(''));
}

export function buildPersistedStreamingResponsePreview(input: {
  events: TaskEvent[];
  taskMessages: TaskMessage[];
  runId?: string;
}): StreamingPreview | null {
  if (!input.runId) return null;
  const preview = buildStreamingResponsePreview({ events: input.events });
  if (!preview?.visibleText.trim()) return null;

  const normalizedPreview = normalizeMessageText(preview.visibleText);
  const alreadyPersisted = input.taskMessages.some((message) => {
    if (message.role !== 'assistant' || message.runId !== input.runId) return false;
    return normalizeMessageText(message.content).includes(normalizedPreview);
  });

  return alreadyPersisted ? null : preview;
}

function buildStreamingPreviewFromRaw(raw: string): StreamingPreview {
  const parsed = tryParseJsonObject(raw);
  if (typeof parsed?.finalResponse === 'string' && parsed.finalResponse.trim()) {
    return { visibleText: parsed.finalResponse, statusText: '最終回答を組み立てています。' };
  }

  const partialFinalResponse = extractLatestPartialJsonStringValue(raw, 'finalResponse');
  if (partialFinalResponse.trim()) {
    return {
      visibleText: partialFinalResponse,
      statusText: '最終回答を生成しています。',
    };
  }

  return {
    visibleText: raw,
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

function extractLatestPartialJsonStringValue(raw: string, key: string): string {
  const matches = Array.from(raw.matchAll(new RegExp(`"${key}"\\s*:\\s*"`, 'g')));
  const match = matches[matches.length - 1];
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

function normalizeMessageText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function decodeJsonEscape(char: string): string {
  if (char === 'n') return '\n';
  if (char === 'r') return '\r';
  if (char === 't') return '\t';
  return char;
}

export function ThinkingIndicator() {
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

function AgentEditSummaryCard({ event }: { event: TaskEvent }) {
  const summary = getAgentEditSummary(event);
  if (!summary) return null;

  return (
    <details className="rounded border border-slate-700/80 bg-slate-900/30">
      <summary className="cursor-pointer list-none px-3 py-2 text-xs text-slate-200">
        コード変更 ({summary.sections.length}){' '}
        <span className="text-slate-400">{summary.toolName}</span>
      </summary>
      <div className="space-y-1 border-t border-slate-700/80 px-3 py-2 text-xs">
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

function hasAgentEditSummary(event: TaskEvent): boolean {
  return getAgentEditSummary(event) !== null;
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

type AgentEditSummary = {
  toolName: 'apply_patch' | 'replace_content';
  sections: Array<{ path: string; added?: number; deleted?: number; detail?: string }>;
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
      if (sections.length > 0) return { toolName, sections };
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
    };
  }

  return null;
}

function getApplyPatchContent(payload: any): string | null {
  return (
    payload?.arguments?.patchContent ||
    payload?.args?.patchContent ||
    payload?.toolCall?.arguments?.patchContent ||
    payload?.decision?.toolCall?.arguments?.patchContent ||
    payload?.runEvent?.data?.arguments?.patchContent ||
    payload?.runEvent?.data?.toolCall?.arguments?.patchContent ||
    null
  );
}

function getToolName(payload: any): string | null {
  return (
    payload?.toolName ||
    payload?.toolCall?.name ||
    payload?.decision?.toolCall?.name ||
    payload?.runEvent?.data?.toolName ||
    payload?.runEvent?.data?.result?.toolName ||
    null
  );
}

function getToolArguments(payload: any): any {
  return (
    payload?.arguments ||
    payload?.args ||
    payload?.toolCall?.arguments ||
    payload?.decision?.toolCall?.arguments ||
    payload?.runEvent?.data?.arguments ||
    payload?.runEvent?.data?.toolCall?.arguments ||
    null
  );
}

function getToolResult(payload: any): any {
  if (payload?.result) return payload.result;
  if (payload?.runEvent?.data?.result) return payload.runEvent.data.result;
  if (typeof payload?.ok === 'boolean' && payload?.payload) return payload;
  return null;
}

function getChangedFilesFromResult(result: any): string[] {
  const changedFiles = result?.payload?.changedFiles;
  return Array.isArray(changedFiles) ? changedFiles.filter((file) => typeof file === 'string') : [];
}

function estimateReplacementStats(input: {
  needle: string;
  replacement: string;
  occurrences?: number;
}): { added: number; deleted: number } | null {
  if (!input.needle && !input.replacement) return null;
  const occurrences =
    typeof input.occurrences === 'number' && input.occurrences > 0 ? input.occurrences : 1;
  return {
    added: countContentLines(input.replacement) * occurrences,
    deleted: countContentLines(input.needle) * occurrences,
  };
}

function countContentLines(value: string): number {
  if (!value) return 0;
  return value.split('\n').length;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
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
      activeSection = { path: activePath || 'unknown', added: 0, deleted: 0 };
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

function MessagePayload({
  message,
  onOpenArtifact,
}: {
  message: TaskMessage;
  onOpenArtifact: (artifact: WorkbenchArtifactRef) => void;
}) {
  const metadata = message.metadataJson as any;
  if (message.messageType === 'markdown_document' && metadata?.appBlueprint) {
    const validation = metadata.validation;
    const issueCount = Array.isArray(validation?.issues) ? validation.issues.length : 0;
    return (
      <div className="nightworkers-artifact-message space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="nightworkers-artifact-kicker text-xs font-semibold uppercase text-cyan-200">
              Blueprint artifact
            </div>
            <div className="nightworkers-artifact-title mt-1 truncate text-sm font-semibold text-slate-100">
              {metadata.appBlueprint.name || metadata.title || 'App Blueprint'}
            </div>
            <div className="nightworkers-artifact-meta mt-1 text-xs text-slate-400">
              {metadata.appBlueprint.screens?.length || 0} screens /{' '}
              {countBlueprintSections(metadata.appBlueprint)} sections / {issueCount} issues
            </div>
          </div>
          <button
            type="button"
            className="nightworkers-artifact-open-button inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border border-cyan-500/60 text-cyan-100 hover:bg-cyan-950/30"
            onClick={() =>
              onOpenArtifact({
                id: `message-${message.id}`,
                taskId: message.taskId,
                runId: message.runId || undefined,
                kind: 'app_blueprint',
                title: `Blueprint: ${metadata.appBlueprint.name || metadata.title || 'Draft'}`,
                summary: message.content.slice(0, 160),
                source: { type: 'task_message', messageId: message.id },
                createdAt: String(message.createdAt),
                metadata,
              })
            }
            title="Open Blueprint artifact"
          >
            <PanelsTopLeft className="h-4 w-4" />
          </button>
        </div>
        <p className="nightworkers-artifact-summary line-clamp-3 text-xs leading-5 text-slate-300">
          {summarizeBlueprintCard(metadata.appBlueprint, message.content)}
        </p>
      </div>
    );
  }
  if (message.messageType === 'markdown_document' && metadata?.componentDesign) {
    const componentDesign = metadata.componentDesign;
    return (
      <div className="nightworkers-artifact-message space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="nightworkers-artifact-kicker text-xs font-semibold uppercase text-cyan-200">
              Component design artifact
            </div>
            <div className="nightworkers-artifact-title mt-1 truncate text-sm font-semibold text-slate-100">
              {componentDesign.componentName || metadata.title || 'Component Design'}
            </div>
            <div className="nightworkers-artifact-meta mt-1 text-xs text-slate-400">
              {componentDesign.variants?.length || 0} variants /{' '}
              {componentDesign.tokenChanges?.length || 0} token changes
            </div>
          </div>
          <button
            type="button"
            className="nightworkers-artifact-open-button inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border border-cyan-500/60 text-cyan-100 hover:bg-cyan-950/30"
            onClick={() =>
              onOpenArtifact({
                id: `message-${message.id}`,
                taskId: message.taskId,
                runId: message.runId || undefined,
                kind: 'component_design',
                title: `Component: ${componentDesign.componentName || metadata.title || 'Design'}`,
                summary: message.content.slice(0, 160),
                source: { type: 'task_message', messageId: message.id },
                createdAt: String(message.createdAt),
                metadata,
              })
            }
            title="Open component design artifact"
          >
            <PanelsTopLeft className="h-4 w-4" />
          </button>
        </div>
        <p className="nightworkers-artifact-summary line-clamp-3 text-xs leading-5 text-slate-300">
          {componentDesign.summary || message.content}
        </p>
      </div>
    );
  }
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

function summarizeBlueprintCard(blueprint: any, fallback: string) {
  if (!blueprint || typeof blueprint !== 'object') return fallback;
  const screens = Array.isArray(blueprint.screens) ? blueprint.screens : [];
  const sectionNames = screens
    .flatMap((screen: any) => (Array.isArray(screen?.sections) ? screen.sections : []))
    .map((section: any) => String(section?.name || section?.id || '').trim())
    .filter(Boolean)
    .slice(0, 4);
  const description = String(blueprint.description || '').trim();
  const details = [sectionNames.length > 0 ? `Sections: ${sectionNames.join(', ')}` : ''].filter(
    Boolean
  );
  return [description, ...details].filter(Boolean).join(' ');
}

function countBlueprintSections(blueprint: any) {
  const screens = Array.isArray(blueprint?.screens) ? blueprint.screens : [];
  return screens.reduce(
    (total: number, screen: any) =>
      total + (Array.isArray(screen?.sections) ? screen.sections.length : 0),
    0
  );
}
