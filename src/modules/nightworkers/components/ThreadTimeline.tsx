import type { CodeBlockData } from '@repo/design-system';
import { Button } from '@repo/design-system';
import { type ReactNode, useState } from 'react';
import { buildTranscriptItems, type TranscriptItem } from '../activityTranscript';
import type {
  ActivityArtifact,
  ActivityEvent,
  Task,
  TaskEvent,
  TaskMessage,
  TaskRun,
  WorkbenchArtifactRef,
} from '../types';
import { formatFinishedTime } from '../utils/time';
import { ThreadMessage } from './ThreadMessage';
import { schemaFirstAgentEventType, TranscriptItemView } from './ThreadTimelineActivityTranscript';
import {
  AgentDebugEventCard,
  AgentEditSummaryCard,
  hasAgentEditSummary,
  isReviewerEvaluationEvent,
  ReviewerEvaluationCard,
} from './ThreadTimelineAgentCards';
import { MessagePayload } from './ThreadTimelineMessagePayload';
import {
  buildNormalTranscriptItems,
  NormalTranscriptItemView,
} from './ThreadTimelineNormalTranscript';
import {
  buildPersistedStreamingResponsePreview,
  buildStreamingResponsePreview,
  FinalReportCard,
  PersistedStreamingResponse,
  RuntimePromptSnapshotCard,
  StreamingResponsePreview,
  ThinkingIndicator,
} from './ThreadTimelineStreaming';

export {
  buildPersistedStreamingResponsePreview,
  buildStreamingResponsePreview,
  formatVisibleAssistantText,
} from './ThreadTimelineStreaming';

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
  onGrantExternalPath?: (path: string) => Promise<void>;
};

function findExternalPathPermissionRequest(events: TaskEvent[]): string | null {
  for (const event of [...events].reverse()) {
    const payload = event.payloadJson as any;
    if (payload?.agentEventType !== 'run.needs_human') continue;
    const data = payload.payload || {};
    if (data.reason !== 'path_access_denied') continue;
    const args = data.arguments || {};
    const candidate =
      typeof args.sourcePath === 'string'
        ? args.sourcePath
        : typeof args.filePath === 'string'
          ? args.filePath
          : typeof args.relativePath === 'string'
            ? args.relativePath
            : null;
    if (candidate && (candidate.startsWith('/') || candidate.startsWith('..'))) return candidate;
  }
  return null;
}

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
  onGrantExternalPath,
}: ThreadTimelineProps) {
  const [isGrantingExternalPath, setIsGrantingExternalPath] = useState(false);
  const [dismissedPermissionPath, setDismissedPermissionPath] = useState<string | null>(null);
  const [grantExternalPathError, setGrantExternalPathError] = useState<string | null>(null);
  const transcriptItems = buildTranscriptItems({
    events: activityEvents,
    artifacts: activityArtifacts,
  });
  const visibleTranscriptItems = showDebugEvents
    ? transcriptItems
    : buildNormalTranscriptItems(transcriptItems);
  const hasActivityTranscript = transcriptItems.length > 0;
  const chatMessages = taskMessages.filter(isUserVisibleChatMessage);
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
  const permissionPath = findExternalPathPermissionRequest(latestRunEvents);
  const showPermissionDialog =
    Boolean(permissionPath) &&
    permissionPath !== dismissedPermissionPath &&
    Boolean(onGrantExternalPath);

  return (
    <div className="nightworkers-chat-window space-y-5 p-6">
      {showPermissionDialog && permissionPath ? (
        <ThreadMessage messageRole="assistant">
          <div className="max-w-2xl rounded-lg border border-slate-700 bg-slate-950/80 p-4">
            <div className="text-sm font-semibold text-slate-100">外部フォルダへのアクセス許可</div>
            <div className="mt-2 text-xs leading-5 text-slate-300">
              続行するには、このフォルダの読み取り許可が必要です。
            </div>
            <div className="mt-3 break-all rounded-md border border-slate-800 bg-slate-900 px-3 py-2 font-mono text-[11px] text-slate-200">
              {permissionPath}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setDismissedPermissionPath(permissionPath)}
              >
                閉じる
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={isGrantingExternalPath}
                onClick={async () => {
                  if (!onGrantExternalPath) return;
                  setIsGrantingExternalPath(true);
                  setGrantExternalPathError(null);
                  try {
                    await onGrantExternalPath(permissionPath);
                    setDismissedPermissionPath(permissionPath);
                  } catch (error) {
                    setGrantExternalPathError(
                      error instanceof Error ? error.message : '外部フォルダの許可に失敗しました。'
                    );
                  } finally {
                    setIsGrantingExternalPath(false);
                  }
                }}
              >
                フォルダを許可
              </Button>
            </div>
            {grantExternalPathError ? (
              <div className="mt-3 rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-200">
                {grantExternalPathError}
              </div>
            ) : null}
          </div>
        </ThreadMessage>
      ) : null}
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

export function getApplyPatchContent(payload: any): string | null {
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

export function getToolName(payload: any): string | null {
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

export function getToolArguments(payload: any): any {
  return (
    payload?.arguments ||
    payload?.args ||
    payload?.toolCall?.arguments ||
    payload?.decision?.toolCall?.arguments ||
    payload?.payload?.arguments ||
    payload?.runEvent?.data?.arguments ||
    payload?.runEvent?.data?.toolCall?.arguments ||
    payload?.runEvent?.data?.toolArgs ||
    null
  );
}

export function getToolResult(payload: any): any {
  if (payload?.result) return payload.result;
  if (payload?.runEvent?.data?.result) return payload.runEvent.data.result;
  if (payload?.runEvent?.data?.toolResult) return payload.runEvent.data.toolResult;
  if (typeof payload?.payload?.ok === 'boolean' && payload.payload.payload) return payload.payload;
  if (typeof payload?.ok === 'boolean' && payload?.payload) return payload;
  return null;
}

export function getChangedFilesFromResult(result: any): string[] {
  const changedFiles = result?.payload?.changedFiles;
  return Array.isArray(changedFiles) ? changedFiles.filter((file) => typeof file === 'string') : [];
}

export function formatCodexToolActivitySummary(event: ActivityEvent): string {
  const payload = event.payloadJson as any;
  const data = payload?.payload || payload?.runEvent?.data || payload || {};
  const toolName = asString(data.toolName) || event.kind;
  const command = asString(data.command);
  const status = asString(data.status) || event.status || '';
  const exitCode =
    typeof data.exitCode === 'number' || data.exitCode === null
      ? `exit=${data.exitCode ?? 'pending'}`
      : '';
  const output = getCodexCommandOutput(event);
  const header = [toolName, command, status, exitCode].filter(Boolean).join(' | ');
  return output
    ? [header || event.text || toolName, output].join('\n')
    : header || event.text || toolName;
}

export function getCodexCommandOutput(event: ActivityEvent): string {
  const payload = event.payloadJson as any;
  const data = payload?.payload || payload?.runEvent?.data || payload || {};
  return asString(data.aggregatedOutput).trim();
}

export function getActivityChangedFiles(event: ActivityEvent): string[] {
  const payload = event.payloadJson as any;
  const data = payload?.payload || payload?.runEvent?.data || payload || {};
  if (Array.isArray(data.changedFiles)) {
    return data.changedFiles.filter((file: unknown): file is string => typeof file === 'string');
  }
  const resultFiles = data.result?.payload?.changedFiles;
  if (Array.isArray(resultFiles)) {
    return resultFiles.filter((file: unknown): file is string => typeof file === 'string');
  }
  return [];
}

export function buildApplyPatchCodeBlockData(patchContent: string): CodeBlockData[] {
  return [
    {
      code: patchContent.trimEnd() || 'No patch',
      filename: 'apply_patch.patch',
      language: 'diff',
    },
  ];
}

export function buildReplaceContentCodeBlockData(input: {
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

export function isUserVisibleChatMessage(message: TaskMessage): boolean {
  if (message.role !== 'user' && message.role !== 'assistant') return false;
  const intent = (message.metadataJson as any)?.intent;
  return (
    intent !== 'blueprint_raw_output' &&
    intent !== 'blueprint_db_design_raw_output' &&
    intent !== 'draft_spec'
  );
}

export function estimateReplacementStats(input: {
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

export function countContentLines(value: string): number {
  if (!value) return 0;
  return value.split('\n').length;
}

export function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function parseApplyPatchSections(
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

export function parseUnifiedDiffSections(
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
