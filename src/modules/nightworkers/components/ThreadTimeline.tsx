import type { CodeBlockData, CodeBlockProps } from '@repo/design-system';
import { CodeBlock, cn } from '@repo/design-system';
import { Check, Copy, PanelsTopLeft } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Components } from 'react-markdown';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  buildTranscriptItems,
  type TranscriptChild,
  type TranscriptItem,
} from '../activityTranscript';
import type {
  ActivityArtifact,
  ActivityEvent,
  ReviewResult,
  Task,
  TaskEvent,
  TaskMessage,
  TaskRun,
  WorkbenchArtifactRef,
} from '../types';
import { formatFinishedTime } from '../utils/time';
import { ThreadMessage } from './ThreadMessage';

const chatCodeBlockThemes = {
  light: 'github-dark-default',
  dark: 'github-dark-default',
} as const;
const chatCodeBlockClassName =
  'nightworkers-code-block dark max-w-full rounded-[var(--radius-md)] border-[color:var(--nw-border)] bg-[var(--nw-surface)] text-[var(--nw-text)] text-xs shadow-none [&_.line]:whitespace-pre-wrap [&_code]:break-words [&_code]:whitespace-pre-wrap [&_pre]:overflow-x-hidden';
const UNKNOWN_ACTIVITY_TITLE_KEY = 'timeline.unknownActivity';

type NightWorkersCodeBlockProps = Omit<
  CodeBlockProps,
  'data' | 'themes' | 'className' | 'children'
> & {
  data?: CodeBlockData[];
  code?: string;
  filename?: string;
  language?: CodeBlockData['language'];
  className?: string;
};

function NightWorkersCodeBlock({
  className,
  data,
  code,
  filename = 'text',
  language = 'text',
  lineNumbers = false,
  maxHeight = 360,
  showHeader = true,
  syntaxHighlighting = true,
  ...props
}: NightWorkersCodeBlockProps) {
  const codeData = data ?? [
    {
      code: code ?? '',
      filename,
      language,
    },
  ];

  return (
    <CodeBlock
      className={cn(chatCodeBlockClassName, className)}
      data={codeData}
      lineNumbers={lineNumbers}
      maxHeight={maxHeight}
      showHeader={showHeader}
      syntaxHighlighting={syntaxHighlighting}
      themes={chatCodeBlockThemes}
      {...props}
    />
  );
}

const chatMarkdownRemarkPlugins = [remarkGfm];
const chatMarkdownComponents: Components = {
  a: ({ children, ...props }) => (
    <a
      className="text-cyan-200 underline underline-offset-2 hover:text-cyan-100"
      target="_blank"
      rel="noreferrer"
      {...props}
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-slate-600 border-l-2 pl-3 text-slate-300">
      {children}
    </blockquote>
  ),
  code: ({ children, className }) => {
    const language = /language-(\w+)/.exec(className || '')?.[1];
    if (language) {
      return (
        <NightWorkersCodeBlock
          className="my-3"
          code={String(children).replace(/\n$/, '')}
          filename={language}
          language={language}
        />
      );
    }
    return (
      <code
        className="rounded-[var(--radius-sm)] px-1 py-0.5 font-mono text-[0.92em]"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--nw-surface-soft) 52%, transparent)',
          boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--nw-primary) 14%, transparent)',
          color: 'color-mix(in srgb, var(--nw-primary) 68%, var(--nw-text))',
        }}
      >
        {children}
      </code>
    );
  },
  h1: ({ children }) => (
    <h1 className="mt-1 mb-3 text-lg font-semibold text-slate-50">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-4 mb-2 text-base font-semibold text-slate-50">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-3 mb-2 text-sm font-semibold text-slate-50">{children}</h3>
  ),
  li: ({ children }) => <li className="my-1 pl-1">{children}</li>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  pre: ({ children }) => <>{children}</>,
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  td: ({ children }) => (
    <td className="border border-slate-700 px-2 py-1 align-top text-slate-200">{children}</td>
  ),
  th: ({ children }) => (
    <th className="border border-slate-700 bg-slate-950/60 px-2 py-1 text-left font-medium text-slate-100">
      {children}
    </th>
  ),
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
};

type ThreadTimelineProps = {
  session: Task;
  runs: TaskRun[];
  latestRun?: TaskRun;
  taskMessages: TaskMessage[];
  latestRunEvents: TaskEvent[];
  activityEvents: ActivityEvent[];
  activityArtifacts: ActivityArtifact[];
  activeStreamingResponse: string;
  isAgentWorking: boolean;
  showDebugEvents: boolean;
  onOpenArtifact: (artifact: WorkbenchArtifactRef) => void;
};

export function ThreadTimeline({
  runs,
  latestRun,
  taskMessages,
  latestRunEvents,
  activityEvents,
  activityArtifacts,
  activeStreamingResponse,
  isAgentWorking,
  showDebugEvents,
  onOpenArtifact,
}: ThreadTimelineProps) {
  const transcriptItems = buildTranscriptItems({
    events: activityEvents,
    artifacts: activityArtifacts,
  });
  const visibleTranscriptItems = showDebugEvents
    ? transcriptItems
    : buildNormalTranscriptItems(transcriptItems);
  const hasActivityTranscript = transcriptItems.length > 0;
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
  const runtimeSnapshotTranscriptAnchorId =
    showDebugEvents && hasActivityTranscript
      ? findRuntimePromptSnapshotTranscriptAnchorId(visibleTranscriptItems, latestRun)
      : null;
  const runtimeSnapshotTimelineAnchorId =
    showDebugEvents && !hasActivityTranscript
      ? findRuntimePromptSnapshotTimelineAnchorId(timelineItems, latestRun)
      : null;
  const shouldRenderTrailingRuntimeSnapshot =
    showDebugEvents &&
    Boolean(latestRun?.contextSnapshot) &&
    !runtimeSnapshotTranscriptAnchorId &&
    !runtimeSnapshotTimelineAnchorId;

  return (
    <div className="nightworkers-chat-window space-y-5 p-6">
      {showDebugEvents && isAgentWorking && latestEvent ? (
        <div className="rounded-lg border border-slate-700/80 bg-slate-900/50 px-3 py-2 text-xs text-slate-200">
          <span className="mr-2 inline-flex h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
          Live: {latestEvent.message}
        </div>
      ) : null}
      {hasActivityTranscript
        ? visibleTranscriptItems.map((item) =>
            showDebugEvents ? (
              <TimelineDebugFragment
                key={item.id}
                insertRuntimeSnapshot={item.id === runtimeSnapshotTranscriptAnchorId}
                latestRun={latestRun}
              >
                <TranscriptItemView item={item} onOpenArtifact={onOpenArtifact} />
              </TimelineDebugFragment>
            ) : (
              <NormalTranscriptItemView key={item.id} item={item} onOpenArtifact={onOpenArtifact} />
            )
          )
        : timelineItems.map((item) =>
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
              <TimelineDebugFragment
                key={item.id}
                insertRuntimeSnapshot={item.id === runtimeSnapshotTimelineAnchorId}
                latestRun={latestRun}
              >
                <div className="space-y-2">
                  <ReviewerEvaluationCard event={item.event} />
                  <AgentEditSummaryCard event={item.event} />
                  {showDebugEvents ? <AgentDebugEventCard event={item.event} /> : null}
                </div>
              </TimelineDebugFragment>
            ) : null
          )}
      {shouldRenderTrailingRuntimeSnapshot ? (
        <RuntimePromptSnapshotCard latestRun={latestRun} />
      ) : null}
      {!hasActivityTranscript && streamingPreview ? (
        <ThreadMessage messageRole="assistant">
          <StreamingResponsePreview preview={streamingPreview} />
        </ThreadMessage>
      ) : null}
      {!hasActivityTranscript && persistedStreamingPreview ? (
        <ThreadMessage messageRole="assistant">
          <PersistedStreamingResponse preview={persistedStreamingPreview} />
        </ThreadMessage>
      ) : null}
      {isAgentWorking ? (
        <ThreadMessage messageRole="assistant">
          <ThinkingIndicator />
        </ThreadMessage>
      ) : null}
      {!hasActivityTranscript ? <FinalReportCard latestRun={latestRun} /> : null}
    </div>
  );
}

function TimelineDebugFragment({
  children,
  insertRuntimeSnapshot,
  latestRun,
}: {
  children: ReactNode;
  insertRuntimeSnapshot: boolean;
  latestRun?: TaskRun;
}) {
  return (
    <>
      {children}
      {insertRuntimeSnapshot ? <RuntimePromptSnapshotCard latestRun={latestRun} /> : null}
    </>
  );
}

export function findRuntimePromptSnapshotTranscriptAnchorId(
  items: TranscriptItem[],
  latestRun?: TaskRun
) {
  if (!latestRun?.contextSnapshot) return null;
  const item = items.find((candidate) =>
    transcriptItemEvents(candidate).some((event) =>
      isRuntimePromptSnapshotAnchorEvent(event, latestRun)
    )
  );
  return item?.id ?? null;
}

function findRuntimePromptSnapshotTimelineAnchorId(
  items: Array<
    | { kind: 'message'; id: string; ts: number; message: TaskMessage }
    | { kind: 'event'; id: string; ts: number; event: TaskEvent }
  >,
  latestRun?: TaskRun
) {
  if (!latestRun?.contextSnapshot) return null;
  const item = items.find(
    (candidate) =>
      candidate.kind === 'event' &&
      isRuntimePromptSnapshotAnchorTaskEvent(candidate.event, latestRun)
  );
  return item?.id ?? null;
}

function transcriptItemEvents(item: TranscriptItem): ActivityEvent[] {
  if (item.kind === 'user_turn' || item.kind === 'assistant_turn') return item.events;
  if (item.kind === 'activity' || item.kind === 'unknown') return [item.event];
  return [];
}

function isRuntimePromptSnapshotAnchorEvent(event: ActivityEvent, latestRun: TaskRun) {
  return event.runId === latestRun.id && schemaFirstAgentEventType(event) === 'run.started';
}

function isRuntimePromptSnapshotAnchorTaskEvent(event: TaskEvent, latestRun: TaskRun) {
  const agentEventType =
    typeof event.payloadJson?.agentEventType === 'string'
      ? event.payloadJson.agentEventType
      : typeof event.payloadJson?.runEvent?.data?.agentEventType === 'string'
        ? event.payloadJson.runEvent.data.agentEventType
        : '';
  const runId = event.runId || event.taskRunId || event.payloadJson?.runEvent?.runId;
  return runId === latestRun.id && agentEventType === 'run.started';
}

export function buildNormalTranscriptItems(items: TranscriptItem[]): TranscriptItem[] {
  const filtered: TranscriptItem[] = [];
  const seenEditDiffs = new Set<string>();

  for (const item of items) {
    if (item.kind === 'user_turn') {
      filtered.push(item);
      continue;
    }

    if (item.kind === 'assistant_turn') {
      const text = isPatchEnvelopeText(item.text) ? '' : item.text;
      const children = item.children.filter((child) => {
        const event = transcriptChildEvent(child);
        return event ? rememberVisibleEditDiff(event, seenEditDiffs) : false;
      });
      if (text.trim() || children.length > 0) filtered.push({ ...item, text, children });
      continue;
    }

    if (item.kind === 'activity' && rememberVisibleEditDiff(item.event, seenEditDiffs)) {
      filtered.push(item);
    }
  }

  return filtered;
}

function transcriptChildEvent(child: TranscriptChild): ActivityEvent | undefined {
  if (child.kind === 'tool') return child.events[0];
  return child.event;
}

function rememberVisibleEditDiff(event: ActivityEvent, seenEditDiffs: Set<string>): boolean {
  const key = visibleEditDiffKey(event);
  if (!key) return false;
  if (seenEditDiffs.has(key)) return false;
  seenEditDiffs.add(key);
  return true;
}

function visibleEditDiffKey(event: ActivityEvent): string {
  return getVisibleEditDiffCode(event).trim();
}

function getVisibleEditDiffCode(event: ActivityEvent): string {
  return getEditToolCallDiff(event) || (isDiffActivity(event) ? getActivityCode(event) : '');
}

function isPatchEnvelopeText(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith('*** Begin Patch') || trimmed.startsWith('diff --git ');
}

function NormalTranscriptItemView({
  item,
  onOpenArtifact,
}: {
  item: TranscriptItem;
  onOpenArtifact: (artifact: WorkbenchArtifactRef) => void;
}) {
  if (item.kind === 'user_turn') {
    const timestamp = item.events.at(-1)?.createdAt;
    return (
      <ThreadMessage messageRole="user" timestamp={formatFinishedTime(timestamp)}>
        <ChatMarkdown content={item.text || fallbackEventText(item.events.at(-1))} />
      </ThreadMessage>
    );
  }

  if (item.kind === 'assistant_turn') {
    const timestamp = item.events.at(-1)?.createdAt;
    const artifactMessage = findArtifactTaskMessage(item.events);
    const visibleText = formatVisibleAssistantText(item.text);
    return (
      <ThreadMessage messageRole="assistant" timestamp={formatFinishedTime(timestamp)}>
        <div className="space-y-3">
          {artifactMessage ? (
            <MessagePayload message={artifactMessage} onOpenArtifact={onOpenArtifact} />
          ) : visibleText.trim() ? (
            <ChatMarkdown content={visibleText} />
          ) : null}
          {item.children.map((child, index) => {
            const event = transcriptChildEvent(child);
            return event ? (
              <NormalEditDiffBlock key={`${item.id}-diff-${index}-${event.id}`} event={event} />
            ) : null;
          })}
        </div>
      </ThreadMessage>
    );
  }

  if (item.kind === 'activity') {
    return <NormalEditDiffBlock event={item.event} />;
  }

  return null;
}

function NormalEditDiffBlock({ event }: { event: ActivityEvent }) {
  const summary = buildVisibleEditDiffSummary(event);
  const code = getVisibleEditDiffCode(event);
  if (summary.length === 0) return null;
  return (
    <details className="overflow-hidden rounded-[var(--radius-md)] border border-transparent bg-[#1f2030] font-mono text-sm text-slate-200">
      <summary className="cursor-pointer list-none px-4 py-3">
        <NormalEditSummaryList summary={summary} />
      </summary>
      {code.trim() ? (
        <div className="border-slate-700/60 border-t">
          <DiffCodeBlock code={code} label={activityCodeFilename(event)} />
        </div>
      ) : null}
    </details>
  );
}

function NormalEditSummaryList({
  summary,
}: {
  summary: Array<{ path: string; added: number; deleted: number }>;
}) {
  return (
    <div className="space-y-4">
      {summary.map((section) => (
        <div className="flex items-baseline justify-between gap-4" key={section.path}>
          <span className="min-w-0 truncate text-slate-300">{section.path}</span>
          <span className="shrink-0 whitespace-nowrap text-right">
            <span className="text-emerald-300">+{section.added}</span>
            <span className="px-1 text-slate-500"> </span>
            <span className="text-rose-300">-{section.deleted}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

export function buildVisibleEditDiffSummary(
  event: ActivityEvent
): Array<{ path: string; added: number; deleted: number }> {
  const toolCall = getEditToolCall(event);

  if (toolCall?.name === 'apply_patch') {
    return mergeEditSections(parseApplyPatchSections(stringValue(toolCall.arguments.patchContent)));
  }

  if (toolCall?.name === 'replace_content') {
    const filePath = stringValue(toolCall.arguments.filePath) || 'unknown';
    const estimate = estimateReplacementStats({
      needle: stringValue(toolCall.arguments.needle),
      replacement: stringValue(toolCall.arguments.replacement),
    });
    return [
      {
        path: filePath,
        added: estimate?.added || 0,
        deleted: estimate?.deleted || 0,
      },
    ];
  }

  if (isDiffActivity(event)) {
    return mergeEditSections(parseUnifiedDiffSections(getActivityCode(event)));
  }

  return [];
}

function mergeEditSections(
  sections: Array<{ path: string; added: number; deleted: number }>
): Array<{ path: string; added: number; deleted: number }> {
  const byPath = new Map<string, { path: string; added: number; deleted: number }>();
  for (const section of sections) {
    const current = byPath.get(section.path);
    if (current) {
      current.added += section.added;
      current.deleted += section.deleted;
    } else {
      byPath.set(section.path, { ...section });
    }
  }
  return [...byPath.values()].filter((section) => section.added > 0 || section.deleted > 0);
}

function TranscriptItemView({
  item,
  onOpenArtifact,
}: {
  item: TranscriptItem;
  onOpenArtifact: (artifact: WorkbenchArtifactRef) => void;
}) {
  if (item.kind === 'user_turn') {
    const timestamp = item.events.at(-1)?.createdAt;
    return (
      <ThreadMessage messageRole="user" timestamp={formatFinishedTime(timestamp)}>
        <ChatMarkdown content={item.text || fallbackEventText(item.events.at(-1))} />
      </ThreadMessage>
    );
  }

  if (item.kind === 'assistant_turn') {
    const timestamp = item.events.at(-1)?.createdAt;
    const artifactMessage = findArtifactTaskMessage(item.events);
    const visibleText = formatVisibleAssistantText(item.text);
    return (
      <ThreadMessage messageRole="assistant" timestamp={formatFinishedTime(timestamp)}>
        <div className="space-y-3">
          {artifactMessage ? (
            <MessagePayload message={artifactMessage} onOpenArtifact={onOpenArtifact} />
          ) : visibleText.trim() ? (
            <ChatMarkdown content={visibleText} />
          ) : null}
          {item.children.map((child, index) => (
            <TranscriptChildView
              key={`${item.id}-child-${index}-${childEventId(child)}`}
              child={child}
            />
          ))}
        </div>
      </ThreadMessage>
    );
  }

  if (item.kind === 'unknown') {
    return (
      <TranscriptActivityBlock
        event={item.event}
        title={UNKNOWN_ACTIVITY_TITLE_KEY}
        tone="warning"
        artifactText={item.artifact?.contentText}
        showJson={true}
      />
    );
  }

  return <TranscriptActivityBlock event={item.event} title={item.event.kind} showJson={true} />;
}

export function findArtifactTaskMessage(events: ActivityEvent[]): TaskMessage | null {
  for (const event of events) {
    const payload = event.payloadJson as any;
    const message = payload?.message;
    const metadata = payload?.metadata ?? message?.metadataJson;
    if (
      event.kind === 'assistant.message' &&
      message &&
      metadata?.appBlueprint &&
      message.messageType === 'markdown_document'
    ) {
      return {
        ...message,
        metadataJson: message.metadataJson ?? metadata,
      } as TaskMessage;
    }
  }
  return null;
}

function TranscriptChildView({ child }: { child: TranscriptChild }) {
  if (child.kind === 'tool') {
    return (
      <TranscriptActivityBlock
        event={child.events[0]}
        title={child.events[0]?.kind || 'tool'}
        showJson={true}
      />
    );
  }
  if (child.kind === 'diff') {
    return (
      <TranscriptActivityBlock
        event={child.event}
        title={child.event.kind}
        artifactText={child.artifact?.contentText}
        showJson={true}
      />
    );
  }
  if (child.kind === 'json') {
    return <TranscriptActivityBlock event={child.event} title={child.event.kind} showJson={true} />;
  }
  if (child.kind === 'log') {
    return (
      <TranscriptActivityBlock
        event={child.event}
        title={child.event.kind}
        artifactText={child.artifact?.contentText}
        showJson={true}
      />
    );
  }
  if (child.kind === 'unknown') {
    return (
      <TranscriptActivityBlock
        event={child.event}
        title={UNKNOWN_ACTIVITY_TITLE_KEY}
        tone="warning"
        artifactText={child.artifact?.contentText}
        showJson={true}
      />
    );
  }
  return (
    <TranscriptActivityBlock
      event={child.event}
      title={child.event.kind}
      compact={true}
      showJson={true}
    />
  );
}

function TranscriptActivityBlock({
  event,
  title,
  tone = 'default',
  compact = false,
  artifactText,
  codeOverride,
  showSummary = true,
  showJson,
}: {
  event?: ActivityEvent;
  title: string;
  tone?: 'default' | 'warning';
  compact?: boolean;
  artifactText?: string | null;
  codeOverride?: string;
  showSummary?: boolean;
  showJson?: boolean;
}) {
  const { t } = useTranslation();
  if (!event) return null;
  const borderClass =
    tone === 'warning'
      ? 'border-amber-700/60 bg-amber-950/20 text-amber-50'
      : 'border-slate-700/80 bg-slate-900/30 text-slate-100';
  const payload = event.payloadJson || {};
  const titleText = title.startsWith('timeline.') ? t(title) : title;
  const displayTitle = activityDisplayTitle(event, titleText);
  const summary = activityDisplaySummary(event);
  const showLlmDetails = showJson && isLlmOutputActivity(event);
  const code = codeOverride || artifactText || getActivityCode(event);
  const codeFilename = activityCodeFilename(event);
  const codeLanguage = activityCodeLanguage(event);
  const defaultOpen = !compact && !isHighVolumeActivity(event);

  return (
    <details className={`rounded border ${borderClass}`} open={defaultOpen}>
      <summary className="cursor-pointer list-none px-3 py-2 text-xs">
        <span className="mr-2 rounded border border-current/30 px-1.5 py-0.5">{displayTitle}</span>
        <span className="text-current/80">{event.source}</span>
        {event.status ? <span className="ml-2 text-current/70">{event.status}</span> : null}
        <span className="ml-2 text-current/50">#{event.seq}</span>
      </summary>
      <div className="space-y-2 border-current/10 border-t px-3 py-2 text-xs">
        {showSummary && summary ? (
          <div className="whitespace-pre-wrap break-words">{summary}</div>
        ) : null}
        {code && codeLanguage === 'diff' ? (
          <DiffCodeBlock code={code} label={codeFilename} />
        ) : code ? (
          <NightWorkersCodeBlock code={code} filename={codeFilename} language={codeLanguage} />
        ) : null}
        {showLlmDetails && !code ? (
          <pre className="max-h-[280px] overflow-auto whitespace-pre-wrap break-all rounded bg-slate-950/40 p-2 font-mono text-[10px] text-slate-300">
            {formatLlmOutputJson(event, payload)}
          </pre>
        ) : null}
      </div>
    </details>
  );
}

function DiffCodeBlock({ code, label }: { code: string; label: string }) {
  const metadata = parseDiffMetadata(code);
  return (
    <div className="nightworkers-diff-view">
      <div className="nightworkers-diff-header">
        <span className="nightworkers-diff-file">{metadata.filePath || 'diff'}</span>
        <span className="nightworkers-diff-label">{label}</span>
      </div>
      <pre className="nightworkers-diff-body">
        {metadata.lines.map((line, index) => (
          <span
            className={`nightworkers-diff-line ${diffLineClassName(line.text)}`}
            key={`${index}-${line.text}`}
          >
            <span className="nightworkers-diff-line-number">{line.lineNumber ?? ''}</span>
            <code className="nightworkers-diff-line-code">{line.text || ' '}</code>
          </span>
        ))}
      </pre>
    </div>
  );
}

type DiffDisplayLine = {
  text: string;
  lineNumber?: number;
};

export function parseDiffMetadata(code: string): { filePath: string; lines: DiffDisplayLine[] } {
  const lines = code.split('\n');
  const filePathLine =
    lines.find((line) => line.startsWith('+++ ') && line.slice(4).trim() !== '/dev/null') ||
    lines.find((line) => line.startsWith('--- ') && line.slice(4).trim() !== '/dev/null') ||
    lines.find((line) => line.startsWith('+++ ') || line.startsWith('--- '));
  return {
    filePath: filePathLine ? filePathLine.slice(4).trim() : '',
    lines: buildDiffDisplayLines(lines),
  };
}

function buildDiffDisplayLines(lines: string[]): DiffDisplayLine[] {
  const displayLines: DiffDisplayLine[] = [];
  let nextNewLine = 1;

  for (const line of lines) {
    if (isDiffFileMetadataLine(line)) continue;

    const hunkMatch = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunkMatch) {
      nextNewLine = Number(hunkMatch[1]);
      displayLines.push({ text: line });
      continue;
    }

    if (line.startsWith('@@')) {
      displayLines.push({ text: line });
      continue;
    }

    if (line.startsWith('-') || line.startsWith('\\')) {
      displayLines.push({ text: line });
      continue;
    }

    displayLines.push({ text: line, lineNumber: nextNewLine });
    nextNewLine += 1;
  }

  return displayLines;
}

function isDiffFileMetadataLine(line: string): boolean {
  return (
    line.startsWith('diff --git ') ||
    line.startsWith('index ') ||
    line.startsWith('new file mode ') ||
    line.startsWith('deleted file mode ') ||
    line.startsWith('old mode ') ||
    line.startsWith('new mode ') ||
    line.startsWith('similarity index ') ||
    line.startsWith('rename from ') ||
    line.startsWith('rename to ') ||
    line.startsWith('--- ') ||
    line.startsWith('+++ ')
  );
}

function diffLineClassName(line: string): string {
  if (line.startsWith('@@')) return 'nightworkers-diff-line-hunk';
  if (line.startsWith('+')) return 'nightworkers-diff-line-add';
  if (line.startsWith('-')) return 'nightworkers-diff-line-remove';
  return '';
}

function childEventId(child: TranscriptChild) {
  if (child.kind === 'tool') return child.events.map((event) => event.id).join('-');
  return child.event.id;
}

function fallbackEventText(event?: ActivityEvent) {
  if (!event) return '';
  return formatVisibleAssistantText(event.text || JSON.stringify(event.payloadJson || {}, null, 2));
}

export function getActivityCode(event: ActivityEvent) {
  const payload = event.payloadJson as any;
  const agentEventType = schemaFirstAgentEventType(event);
  const editToolDiff = getEditToolCallDiff(event);
  if (editToolDiff) return editToolDiff;
  if (isDiffActivity(event) && typeof payload?.code === 'string') return payload.code;
  if (agentEventType === 'skill.loaded') {
    return stringValue(payload?.payload?.skill || payload?.skill || payload?.runEvent?.data?.skill);
  }
  if (typeof payload?.rawContent === 'string') return payload.rawContent;
  if (typeof payload?.systemPrompt === 'string') return payload.systemPrompt;
  if (typeof payload?.userPrompt === 'string') return payload.userPrompt;
  if (typeof payload?.payload?.rawContent === 'string') return payload.payload.rawContent;
  if (typeof payload?.payload?.systemPrompt === 'string') return payload.payload.systemPrompt;
  if (typeof payload?.payload?.userPrompt === 'string') return payload.payload.userPrompt;
  if (
    payload?.payload &&
    (event.kind === 'llm.schema_result' || event.kind.startsWith('runtime.'))
  ) {
    return JSON.stringify(payload.payload, null, 2);
  }
  if (typeof payload?.code === 'string') return payload.code;
  if (typeof payload?.text === 'string' && agentEventType === 'model.response_delta') {
    return payload.text;
  }
  if (typeof payload?.runEvent?.data?.text === 'string' && event.kind.includes('delta')) {
    return payload.runEvent.data.text;
  }
  if (typeof payload?.runEvent?.data?.rawContent === 'string') {
    return payload.runEvent.data.rawContent;
  }
  if (typeof payload?.runEvent?.data?.result?.payload?.stdout === 'string') {
    return payload.runEvent.data.result.payload.stdout;
  }
  if (typeof payload?.runEvent?.data?.result?.payload?.stderr === 'string') {
    return payload.runEvent.data.result.payload.stderr;
  }
  return '';
}

function isLlmOutputActivity(event: ActivityEvent) {
  return [
    'assistant.raw_output',
    'llm.schema_result',
    'llm.decision_json',
    'llm.response_delta',
    'llm.response_final',
  ].includes(event.kind);
}

function isDiffActivity(event: ActivityEvent) {
  return event.kind === 'file.patch' || event.kind === 'file.diff';
}

function formatLlmOutputJson(event: ActivityEvent, payload: unknown): string {
  const activityCode = getActivityCode(event).trim();
  if (activityCode) {
    const parsed = tryParseJsonObject(activityCode);
    return parsed ? JSON.stringify(parsed, null, 2) : activityCode;
  }
  if (event.text?.trim()) {
    const parsed = tryParseJsonObject(event.text);
    return parsed ? JSON.stringify(parsed, null, 2) : event.text;
  }
  const record = payload as any;
  const llmPayload = record?.payload || record?.runEvent?.data || record || {};
  return JSON.stringify(llmPayload, null, 2);
}

function activityCodeFilename(event: ActivityEvent) {
  const editToolName = getEditToolCall(event)?.name;
  const agentEventType = schemaFirstAgentEventType(event);
  const payload = event.payloadJson as any;
  if (editToolName === 'apply_patch') return 'apply_patch.patch';
  if (editToolName === 'replace_content') return 'replace_content.diff';
  if (agentEventType === 'skill.loaded') {
    return stringValue(payload?.payload?.skillPath || payload?.skillPath) || 'skill.md';
  }
  if (event.kind.includes('patch')) return 'activity.patch';
  if (event.kind.includes('diff')) return 'activity.diff';
  if (event.kind.includes('json') || event.kind.startsWith('llm.')) return 'activity.json';
  if (agentEventType === 'model.response_finished') return 'raw-output.json';
  if (agentEventType?.endsWith('prompt_built')) return 'prompt.txt';
  return event.kind;
}

function activityCodeLanguage(event: ActivityEvent) {
  if (schemaFirstAgentEventType(event) === 'skill.loaded') return 'markdown';
  if (getEditToolCall(event)) return 'diff';
  if (event.kind.includes('patch') || event.kind.includes('diff')) return 'diff';
  if (event.kind.includes('json') || event.kind.startsWith('llm.')) return 'json';
  return 'text';
}

type EditToolCall = {
  name: 'apply_patch' | 'replace_content';
  arguments: Record<string, unknown>;
};

function getEditToolCall(event: ActivityEvent): EditToolCall | null {
  const payload = event.payloadJson as any;
  const candidates = [
    payload?.payload?.toolCall,
    payload?.runEvent?.data?.payload?.toolCall,
    payload?.runEvent?.data?.toolCall,
  ];

  if (event.text?.trim()) {
    candidates.push(tryParseJsonObject(event.text)?.toolCall);
  }

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const name = candidate.name;
    if (name !== 'apply_patch' && name !== 'replace_content') continue;
    const args =
      candidate.arguments &&
      typeof candidate.arguments === 'object' &&
      !Array.isArray(candidate.arguments)
        ? candidate.arguments
        : {};
    return { name, arguments: args };
  }

  return null;
}

function getEditToolCallDiff(event: ActivityEvent): string {
  const toolCall = getEditToolCall(event);
  if (!toolCall) return '';

  if (toolCall.name === 'apply_patch') {
    return formatApplyPatchDiff(stringValue(toolCall.arguments.patchContent));
  }

  const filePath = stringValue(toolCall.arguments.filePath) || 'unknown';
  const needle = stringValue(toolCall.arguments.needle);
  const replacement = stringValue(toolCall.arguments.replacement);
  const content = [
    `--- ${filePath}`,
    `+++ ${filePath}`,
    '# replace_content',
    needle ? `- ${needle}` : '',
    replacement ? `+ ${replacement}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return content.trim();
}

function formatApplyPatchDiff(patchContent: string): string {
  return patchContent
    .split('\n')
    .map((line) => {
      if (line === '*** Begin Patch' || line === '*** End Patch') return '';
      if (line.startsWith('*** Add File: ')) return `+++ ${line.slice('*** Add File: '.length)}`;
      if (line.startsWith('*** Delete File: '))
        return `--- ${line.slice('*** Delete File: '.length)}`;
      if (line.startsWith('*** Update File: '))
        return `--- ${line.slice('*** Update File: '.length)}`;
      return line;
    })
    .filter((line) => line.trim())
    .join('\n')
    .trimEnd();
}

function schemaFirstAgentEventType(event: ActivityEvent): string {
  const payload = event.payloadJson as any;
  return typeof payload?.agentEventType === 'string' ? payload.agentEventType : '';
}

function activityDisplayTitle(event: ActivityEvent, fallback: string): string {
  const agentEventType = schemaFirstAgentEventType(event);
  switch (agentEventType) {
    case 'run.started':
      return 'Run started';
    case 'round1.prompt_built':
      return 'Round 1 prompt';
    case 'round1.parsed':
      return 'Round 1 jobType';
    case 'skill.loaded':
      return 'Skill loaded';
    case 'round2.prompt_built':
      return 'Round 2 prompt';
    case 'round2.parsed':
      return 'Round 2 toolCall';
    case 'round2.invalid':
      return 'Round 2 invalid';
    case 'model.request_started':
      return 'LLM request';
    case 'model.response_finished':
      return 'LLM raw output';
    case 'tool.started':
      return 'Tool started';
    case 'tool.finished':
      return 'Tool result';
    case 'tool.failed':
      return 'Tool failed';
    case 'tool.validation_failed':
      return 'Tool validation failed';
    case 'job.switched':
      return 'Job switched';
    case 'finalize.received':
      return 'Final answer';
    case 'run.completed':
      return 'Run completed';
    case 'run.needs_human':
      return 'Needs human';
    case 'run.failed':
      return 'Run failed';
    default:
      return fallback;
  }
}

function activityDisplaySummary(event: ActivityEvent): string {
  const payload = event.payloadJson as any;
  const data = payload?.payload || payload?.runEvent?.data || payload || {};
  const agentEventType = schemaFirstAgentEventType(event);
  if (agentEventType === 'round1.parsed' && typeof data.jobType === 'string') {
    return data.jobType;
  }
  if (agentEventType === 'round2.parsed' && data.toolCall) {
    return toolCallSummary(data.toolCall);
  }
  if (agentEventType === 'tool.started' && data.toolCall) {
    return toolCallSummary(data.toolCall);
  }
  if (agentEventType === 'tool.finished') {
    return typeof data.toolName === 'string' ? data.toolName : event.text || 'tool finished';
  }
  if (agentEventType === 'finalize.received') {
    return formatVisibleAssistantText(
      typeof data.message === 'string' ? data.message : event.text || ''
    );
  }
  if (agentEventType === 'model.response_finished') {
    return formatVisibleAssistantText(
      typeof data.rawContent === 'string' ? data.rawContent : event.text || ''
    );
  }
  if (agentEventType === 'skill.loaded') {
    return typeof data.skillPath === 'string' ? data.skillPath : event.text || 'skill loaded';
  }
  if (agentEventType.endsWith('prompt_built')) {
    return event.text || 'prompt built';
  }
  return event.text || event.ingestError || event.status || event.kind;
}

function toolCallSummary(toolCall: any): string {
  if (!toolCall || typeof toolCall !== 'object') return '';
  const name = typeof toolCall.name === 'string' ? toolCall.name : 'toolCall';
  const args =
    toolCall.arguments && typeof toolCall.arguments === 'object' ? toolCall.arguments : {};
  const filePath = typeof args.filePath === 'string' ? args.filePath : '';
  const command = typeof args.command === 'string' ? args.command : '';
  const query = typeof args.query === 'string' ? args.query : '';
  const detail = filePath || command || query;
  return detail ? `${name}: ${detail}` : name;
}

function isHighVolumeActivity(event: ActivityEvent): boolean {
  const agentEventType = schemaFirstAgentEventType(event);
  return (
    agentEventType === 'model.response_finished' ||
    agentEventType.endsWith('prompt_built') ||
    event.kind === 'assistant.raw_output'
  );
}

function RuntimePromptSnapshotCard({ latestRun }: { latestRun?: TaskRun }) {
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
  return (
    <details className="rounded border border-slate-700/80 bg-slate-900/25" open>
      <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-slate-100">
        Runtime Prompt Snapshot
      </summary>
      <div className="grid gap-3 border-t border-slate-800 p-3">
        {typeof stateCardText === 'string' && stateCardText.trim() ? (
          <NightWorkersCodeBlock
            code={stateCardText}
            filename="StateCard Text"
            language="text"
            maxHeight={280}
            syntaxHighlighting={false}
          />
        ) : null}
        <NightWorkersCodeBlock
          code={JSON.stringify(snapshot, null, 2)}
          filename="Snapshot JSON"
          language="json"
          maxHeight={360}
        />
      </div>
    </details>
  );
}

function FinalReportCard({ latestRun }: { latestRun?: TaskRun }) {
  if (!latestRun?.finalReport?.trim()) return null;
  return (
    <ThreadMessage messageRole="assistant" timestamp={formatFinishedTime(latestRun.finishedAt)}>
      <ChatMarkdown content={formatVisibleAssistantText(latestRun.finalReport)} />
    </ThreadMessage>
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

function PersistedStreamingResponse({ preview }: { preview: StreamingPreview }) {
  return <ChatMarkdown content={preview.visibleText || preview.statusText} />;
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
    .filter(isStreamingResponseDeltaEvent)
    .map(streamingResponseDeltaText)
    .filter(Boolean);

  if (chunks.length === 0) return null;

  return buildStreamingPreviewFromRaw(chunks.join(''));
}

function isStreamingResponseDeltaEvent(event: TaskEvent): boolean {
  const payload = event.payloadJson as any;
  return (
    payload?.runEvent?.type === 'model.response_delta' ||
    payload?.agentEventType === 'model.response_delta'
  );
}

function streamingResponseDeltaText(event: TaskEvent): string {
  const payload = event.payloadJson as any;
  if (typeof payload?.runEvent?.data?.text === 'string') return payload.runEvent.data.text;
  if (typeof payload?.text === 'string') return payload.text;
  if (typeof payload?.payload?.text === 'string') return payload.payload.text;
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
  const parsed = tryParseJsonObject(raw);
  const directMessage = stringValue(parsed?.message);
  const finalizeToolMessage = stringValue(parsed?.toolCall?.arguments?.message);
  return firstNonEmpty(finalizeToolMessage, directMessage) || raw;
}

function firstNonEmpty(...values: string[]): string {
  return values.find((value) => value.trim()) || '';
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
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
  const { t } = useTranslation();

  return (
    <div
      className="inline-flex h-[1em] items-center gap-[0.3em]"
      aria-label={t('timeline.thinking')}
      role="status"
    >
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

function AgentEditSummaryCard({ event }: { event: TaskEvent }) {
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
    payload?.result?.toolName ||
    payload?.payload?.toolName ||
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
    payload?.runEvent?.data?.toolArgs ||
    null
  );
}

function getToolResult(payload: any): any {
  if (payload?.result) return payload.result;
  if (payload?.runEvent?.data?.result) return payload.runEvent.data.result;
  if (payload?.runEvent?.data?.toolResult) return payload.runEvent.data.toolResult;
  if (typeof payload?.ok === 'boolean' && payload?.payload) return payload;
  return null;
}

function getChangedFilesFromResult(result: any): string[] {
  const changedFiles = result?.payload?.changedFiles;
  return Array.isArray(changedFiles) ? changedFiles.filter((file) => typeof file === 'string') : [];
}

function buildApplyPatchCodeBlockData(patchContent: string): CodeBlockData[] {
  return [
    {
      code: patchContent.trimEnd() || 'No patch',
      filename: 'apply_patch.patch',
      language: 'diff',
    },
  ];
}

function buildReplaceContentCodeBlockData(input: {
  filePath: string;
  needle: string;
  replacement: string;
  occurrences?: number;
}): CodeBlockData[] | undefined {
  if (!input.needle && !input.replacement) return undefined;
  const occurrenceLabel =
    typeof input.occurrences === 'number'
      ? `# occurrences: ${input.occurrences}`
      : '# replacement requested';
  return [
    {
      code: [
        `--- ${input.filePath}`,
        `+++ ${input.filePath}`,
        occurrenceLabel,
        input.needle ? `- ${input.needle}` : '',
        input.replacement ? `+ ${input.replacement}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      filename: `${input.filePath}.replace.diff`,
      language: 'diff',
    },
  ];
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

function parseUnifiedDiffSections(
  diffContent: string
): Array<{ path: string; added: number; deleted: number }> {
  const sections: Array<{ path: string; added: number; deleted: number }> = [];
  let current: { path: string; added: number; deleted: number } | null = null;

  for (const line of diffContent.split('\n')) {
    if (line.startsWith('+++ ') && line.slice(4).trim() !== '/dev/null') {
      if (current) sections.push(current);
      current = { path: normalizeDiffPath(line.slice(4).trim()), added: 0, deleted: 0 };
      continue;
    }

    if (!current) continue;
    if (line.startsWith('+') && !line.startsWith('+++')) current.added += 1;
    if (line.startsWith('-') && !line.startsWith('---')) current.deleted += 1;
  }

  if (current) sections.push(current);
  return sections;
}

function normalizeDiffPath(path: string): string {
  if (path.startsWith('a/') || path.startsWith('b/')) return path.slice(2);
  return path;
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
  const { t } = useTranslation();
  const metadata = message.metadataJson as any;
  if (metadata?.intent === 'tool_diff') {
    const codeBlock = metadata.codeBlock || {};
    const code = typeof codeBlock.code === 'string' ? codeBlock.code : message.content;
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span className="rounded-[var(--radius-sm)] border border-border bg-muted px-1.5 py-0.5 text-card-foreground">
            {t('timeline.codeChange')}
          </span>
          {metadata.toolName ? <span>{String(metadata.toolName)}</span> : null}
        </div>
        <NightWorkersCodeBlock
          code={code}
          filename={
            typeof codeBlock.filename === 'string' ? codeBlock.filename : 'tool-output.diff'
          }
          language={typeof codeBlock.language === 'string' ? codeBlock.language : 'diff'}
        />
      </div>
    );
  }
  if (message.messageType === 'markdown_document' && metadata?.appBlueprint) {
    const validation = metadata.validation;
    const issueCount = Array.isArray(validation?.issues) ? validation.issues.length : 0;
    return (
      <div className="nightworkers-artifact-message space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="nightworkers-artifact-kicker text-xs font-semibold uppercase text-cyan-200">
              {t('timeline.blueprintArtifact')}
            </div>
            <div className="nightworkers-artifact-title mt-1 truncate text-sm font-semibold text-slate-100">
              {metadata.appBlueprint.name || metadata.title || t('timeline.appBlueprintFallback')}
            </div>
            <div className="nightworkers-artifact-meta mt-1 text-xs text-slate-400">
              {t('timeline.screensCount', { count: metadata.appBlueprint.screens?.length || 0 })} /{' '}
              {t('timeline.sectionsCount', {
                count: countBlueprintSections(metadata.appBlueprint),
              })}{' '}
              / {t('timeline.issuesCount', { count: issueCount })}
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
                title: `Blueprint: ${
                  metadata.appBlueprint.name || metadata.title || t('timeline.draftFallback')
                }`,
                summary: message.content.slice(0, 160),
                source: { type: 'task_message', messageId: message.id },
                createdAt: String(message.createdAt),
                metadata,
              })
            }
            title={t('timeline.openBlueprintArtifact')}
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
              {t('timeline.componentDesignArtifact')}
            </div>
            <div className="nightworkers-artifact-title mt-1 truncate text-sm font-semibold text-slate-100">
              {componentDesign.componentName ||
                metadata.title ||
                t('timeline.componentDesignFallback')}
            </div>
            <div className="nightworkers-artifact-meta mt-1 text-xs text-slate-400">
              {t('timeline.variantsCount', { count: componentDesign.variants?.length || 0 })} /{' '}
              {t('timeline.tokenChangesCount', {
                count: componentDesign.tokenChanges?.length || 0,
              })}
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
                title: `Component: ${
                  componentDesign.componentName ||
                  metadata.title ||
                  t('timeline.componentDesignTitleFallback')
                }`,
                summary: message.content.slice(0, 160),
                source: { type: 'task_message', messageId: message.id },
                createdAt: String(message.createdAt),
                metadata,
              })
            }
            title={t('timeline.openComponentDesignArtifact')}
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
        <div className="text-xs font-semibold text-zinc-300">{t('timeline.chart')}</div>
        <pre className="whitespace-pre-wrap break-all rounded-md bg-black/30 p-2 text-xs">
          {JSON.stringify(metadata.chartData, null, 2)}
        </pre>
      </div>
    );
  }
  if (message.messageType === 'browser' && metadata?.browserFrameData?.url) {
    return (
      <div className="space-y-2">
        <div className="text-xs font-semibold text-zinc-300">{t('timeline.browser')}</div>
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
        <div className="text-xs font-semibold text-zinc-300">{t('timeline.flow')}</div>
        <pre className="whitespace-pre-wrap break-all rounded-md bg-black/30 p-2 text-xs">
          {JSON.stringify(metadata.flowData, null, 2)}
        </pre>
      </div>
    );
  }
  if (message.messageType === 'playwright' && metadata?.playwrightResult) {
    return (
      <div className="space-y-2">
        <div className="text-xs font-semibold text-zinc-300">{t('timeline.playwright')}</div>
        <pre className="whitespace-pre-wrap break-all rounded-md bg-black/30 p-2 text-xs">
          {JSON.stringify(metadata.playwrightResult, null, 2)}
        </pre>
      </div>
    );
  }
  if (message.messageType === 'markdown_document' && metadata?.markdownDocumentData?.content) {
    return <ChatMarkdown content={metadata.markdownDocumentData.content} />;
  }
  if (message.role === 'assistant') {
    return <ChatMarkdown content={message.content} />;
  }
  return <>{message.content}</>;
}

function ChatMarkdown({ content }: { content: string }) {
  return (
    <div className="nightworkers-message-content max-w-full whitespace-normal break-words text-sm leading-6 text-slate-100">
      <ReactMarkdown components={chatMarkdownComponents} remarkPlugins={chatMarkdownRemarkPlugins}>
        {content}
      </ReactMarkdown>
    </div>
  );
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
