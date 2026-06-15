import { useTranslation } from 'react-i18next';
import { isDeepRecord, toDeepRecord } from '../../../../shared/json-record';
import type { TaskEvent, TaskMessage, TaskRun } from '../types';
import { formatFinishedTime } from '../utils/time';
import { ThreadMessage } from './ThreadMessage';
import { ChatMarkdown, NightWorkersCodeBlock } from './ThreadTimelineMarkdown';

export function RuntimePromptSnapshotCard({ latestRun }: { latestRun?: TaskRun }) {
  if (!latestRun?.contextSnapshot) return null;
  const snapshot = latestRun.contextSnapshot;
  const conversationContext =
    snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
      ? (snapshot as { conversationContext?: unknown }).conversationContext
      : null;
  const stateCardText =
    conversationContext &&
    typeof conversationContext === 'object' &&
    !Array.isArray(conversationContext)
      ? (conversationContext as { stateCardText?: unknown }).stateCardText
      : null;
  if (typeof stateCardText !== 'string' || !stateCardText.trim()) return null;

  return (
    <details className="rounded border border-slate-700/80 bg-slate-900/25" open>
      <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-slate-100">
        Runtime Prompt Snapshot
      </summary>
      <div className="grid gap-3 border-t border-slate-800 p-3">
        <NightWorkersCodeBlock
          code={stateCardText}
          filename="StateCard Text"
          language="text"
          maxHeight={280}
          syntaxHighlighting={false}
        />
      </div>
    </details>
  );
}

export function FinalReportCard({ latestRun }: { latestRun?: TaskRun }) {
  if (!latestRun?.finalReport?.trim()) return null;
  return (
    <ThreadMessage messageRole="assistant" timestamp={formatFinishedTime(latestRun.finishedAt)}>
      <ChatMarkdown content={formatVisibleAssistantText(latestRun.finalReport)} />
    </ThreadMessage>
  );
}

export function StreamingResponsePreview({ preview }: { preview: StreamingPreview }) {
  return (
    <div className="space-y-2" aria-live="polite">
      <div className="inline-flex items-center gap-2 text-xs text-cyan-200">
        <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-cyan-300" />
        応答を生成中
      </div>
      {preview.visibleText ? (
        <div className="space-y-1">
          <ChatMarkdown content={preview.visibleText} />
          <span className="ml-0.5 inline-block h-4 w-1 animate-pulse bg-cyan-300 align-[-2px]" />
        </div>
      ) : (
        <div className="text-xs text-slate-400">{preview.statusText}</div>
      )}
    </div>
  );
}

export function PersistedStreamingResponse({ preview }: { preview: StreamingPreview }) {
  return <ChatMarkdown content={preview.visibleText || preview.statusText} />;
}

export type StreamingPreview = {
  visibleText: string;
  statusText: string;
};

export function buildStreamingResponsePreview(input: {
  events: TaskEvent[];
  activeStreamingResponse?: string;
}): StreamingPreview | null {
  if (input.activeStreamingResponse?.trim()) {
    return buildStreamingPreviewFromRaw(input.activeStreamingResponse);
  }
  const chunks = input.events
    .filter(isStreamingResponseDeltaEvent)
    .map(streamingResponseDeltaText)
    .filter(Boolean);

  if (chunks.length === 0) return null;

  return buildStreamingPreviewFromRaw(chunks.join(''));
}

function isStreamingResponseDeltaEvent(event: TaskEvent): boolean {
  const payload = toDeepRecord(event.payloadJson);
  const runEvent = toDeepRecord(payload.runEvent);
  return (
    String(runEvent.type) === 'model.response_delta' ||
    String(payload.agentEventType) === 'model.response_delta'
  );
}

function streamingResponseDeltaText(event: TaskEvent): string {
  const payload = toDeepRecord(event.payloadJson);
  const runEventData = toDeepRecord(toDeepRecord(payload.runEvent).data);
  const nestedPayload = toDeepRecord(payload.payload);
  if (typeof (runEventData.text as unknown) === 'string') return String(runEventData.text);
  if (typeof (payload.text as unknown) === 'string') return String(payload.text);
  if (typeof (nestedPayload.text as unknown) === 'string') return String(nestedPayload.text);
  return event.message || '';
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
  if (isStructuredArtifactJson(raw)) {
    return {
      visibleText: '',
      statusText: 'Artifact を生成しています。',
    };
  }
  const visibleText = formatVisibleAssistantText(raw);
  if (visibleText !== raw && visibleText.trim()) {
    return { visibleText, statusText: '最終回答を組み立てています。' };
  }

  const partialFinalizeMessage = extractLatestPartialJsonStringValue(raw, 'message');
  if (partialFinalizeMessage.trim()) {
    return {
      visibleText: partialFinalizeMessage,
      statusText: '最終回答を生成しています。',
    };
  }

  return {
    visibleText: raw,
    statusText: 'Supervisor の応答構造を生成しています。',
  };
}

export function formatVisibleAssistantText(raw: string): string {
  const parsed = toDeepRecord(tryParseJsonObject(raw));
  if (isStructuredArtifactJsonObject(parsed)) return '';
  const directMessage = stringValue(parsed?.message);
  const finalizeToolMessage = stringValue(parsed?.toolCall?.arguments?.message);
  return firstNonEmpty(finalizeToolMessage, directMessage) || raw;
}

function isStructuredArtifactJson(raw: string): boolean {
  return isStructuredArtifactJsonObject(tryParseJsonObject(raw));
}

function isStructuredArtifactJsonObject(parsed: unknown | null): boolean {
  return Boolean(
    isDeepRecord(parsed) &&
      typeof parsed.title === 'string' &&
      typeof parsed.content === 'string' &&
      !parsed.message &&
      !parsed.toolCall
  );
}

function firstNonEmpty(...values: string[]): string {
  return values.find((value) => value.trim()) || '';
}

export function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function tryParseJsonObject(raw: string): unknown | null {
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
  const { t } = useTranslation();

  return (
    <div
      className="inline-flex h-[1em] items-center gap-[0.3em]"
      aria-label={t('timeline.thinking')}
      role="status"
    >
      <span className="sr-only">AIが返答を生成中です</span>
      {[0, 1, 2].map((dot) => (
        <span
          key={dot}
          className="nightworkers-thinking-dot h-[0.38em] w-[0.38em] rounded-full bg-cyan-400 shadow-[0_0_3px_rgba(34,211,238,0.25)]"
          style={{ animationDelay: `${dot * 140}ms` }}
        />
      ))}
    </div>
  );
}
