import type { TranscriptChild, TranscriptItem } from '../activityTranscript';
import type { ActivityEvent, WorkbenchArtifactRef } from '../types';
import { formatFinishedTime } from '../utils/time';
import { ThreadMessage } from './ThreadMessage';
import {
  asNumber,
  asString,
  estimateReplacementStats,
  getActivityChangedFiles,
  getCodexCommandOutput,
  getToolArguments,
  getToolName,
  getToolResult,
  parseApplyPatchSections,
  parseUnifiedDiffSections,
} from './ThreadTimeline';
import {
  activityCodeFilename,
  DiffCodeBlock,
  fallbackEventText,
  findArtifactTaskMessage,
  getActivityDiffCode,
  getEditToolCall,
  getEditToolCallDiff,
  isDiffActivity,
} from './ThreadTimelineActivityTranscript';
import { ChatMarkdown, NightWorkersCodeBlock } from './ThreadTimelineMarkdown';
import { MessagePayload } from './ThreadTimelineMessagePayload';
import { formatVisibleAssistantText, stringValue } from './ThreadTimelineStreaming';

export function buildNormalTranscriptItems(items: TranscriptItem[]): TranscriptItem[] {
  const filtered: TranscriptItem[] = [];
  const seenEditDiffs = new Set<string>();
  const seenCliCommands = new Set<string>();

  for (const item of items) {
    if (item.kind === 'user_turn') {
      filtered.push(item);
      continue;
    }

    if (item.kind === 'assistant_turn') {
      const text = isPatchEnvelopeText(item.text) ? '' : item.text;
      const children = item.children.filter((child) => {
        const event = transcriptChildEvent(child);
        return event
          ? rememberVisibleEditDiff(event, seenEditDiffs) ||
              rememberVisibleCliCommand(event, seenCliCommands)
          : false;
      });
      if (text.trim() || children.length > 0) filtered.push({ ...item, text, children });
      continue;
    }

    if (
      item.kind === 'activity' &&
      (rememberVisibleEditDiff(item.event, seenEditDiffs) ||
        rememberVisibleCliCommand(item.event, seenCliCommands))
    ) {
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

function rememberVisibleCliCommand(event: ActivityEvent, seenCliCommands: Set<string>): boolean {
  const summary = getVisibleCliCommandSummary(event);
  if (!summary) return false;
  const key = visibleCliCommandKey(event, summary);
  if (seenCliCommands.has(key)) return false;
  seenCliCommands.add(key);
  return true;
}

function visibleCliCommandKey(event: ActivityEvent, summary: VisibleCliCommandSummary): string {
  const payload = event.payloadJson as any;
  const step =
    asNumber(payload?.runEvent?.data?.iteration) ||
    asNumber(payload?.runEvent?.data?.step) ||
    asNumber(payload?.payload?.step);
  if (typeof step === 'number') {
    return `${event.runId || payload?.runEvent?.runId || 'run'}:${step}:${summary.toolName}:${summary.command}`;
  }
  return `${summary.toolName}:${summary.command}`;
}

function visibleEditDiffKey(event: ActivityEvent): string {
  return getVisibleEditDiffCode(event).trim();
}

function getVisibleEditDiffCode(event: ActivityEvent): string {
  return getEditToolCallDiff(event) || (isDiffActivity(event) ? getActivityDiffCode(event) : '');
}

function isPatchEnvelopeText(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith('*** Begin Patch') || trimmed.startsWith('diff --git ');
}

export function NormalTranscriptItemView({
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
              <NormalVisibleActivityBlock
                key={`${item.id}-activity-${index}-${event.id}`}
                event={event}
              />
            ) : null;
          })}
        </div>
      </ThreadMessage>
    );
  }

  if (item.kind === 'activity') {
    return <NormalVisibleActivityBlock event={item.event} />;
  }

  return null;
}

function NormalVisibleActivityBlock({ event }: { event: ActivityEvent }) {
  return (
    <>
      <NormalEditDiffBlock event={event} />
      <NormalCliCommandBlock event={event} />
    </>
  );
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

function NormalCliCommandBlock({ event }: { event: ActivityEvent }) {
  const summary = getVisibleCliCommandSummary(event);
  if (!summary) return null;

  return (
    <details className="overflow-hidden rounded-[var(--radius-md)] border border-transparent bg-[#1f2030] font-mono text-sm text-slate-200">
      <summary className="cursor-pointer list-none px-4 py-3">
        <div className="flex items-baseline justify-between gap-4">
          <span className="min-w-0 truncate text-slate-300">{summary.command}</span>
          <span className="shrink-0 whitespace-nowrap text-right text-slate-400">
            {summary.toolName}
          </span>
        </div>
      </summary>
      <div className="border-slate-700/60 border-t">
        <NightWorkersCodeBlock
          code={
            summary.output
              ? [`$ ${summary.command}`, '', summary.output].join('\n')
              : summary.command
          }
          filename="command.sh"
          language="shell"
          maxHeight={160}
          syntaxHighlighting={false}
        />
      </div>
    </details>
  );
}

function NormalEditSummaryList({ summary }: { summary: VisibleEditDiffSummary }) {
  return (
    <div className="space-y-4">
      {summary.map((section) => (
        <div className="flex items-baseline justify-between gap-4" key={section.path}>
          <span className="min-w-0 truncate text-slate-300">{section.path}</span>
          {section.changedOnly ? (
            <span className="shrink-0 whitespace-nowrap text-right text-slate-400">changed</span>
          ) : (
            <span className="shrink-0 whitespace-nowrap text-right">
              <span className="text-emerald-300">+{section.added}</span>
              <span className="px-1 text-slate-500"> </span>
              <span className="text-rose-300">-{section.deleted}</span>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

export type VisibleEditDiffSummary = Array<{
  path: string;
  added: number;
  deleted: number;
  changedOnly?: boolean;
}>;

export function buildVisibleEditDiffSummary(event: ActivityEvent): VisibleEditDiffSummary {
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
    const diff = getVisibleEditDiffCode(event);
    const sections = diff ? mergeEditSections(parseUnifiedDiffSections(diff)) : [];
    if (sections.length > 0) return sections;
    return getActivityChangedFiles(event).map((path) => ({
      path,
      added: 0,
      deleted: 0,
      changedOnly: true,
    }));
  }

  return [];
}

export type VisibleCliCommandSummary = {
  toolName: 'run_command' | 'run_verification' | 'command_execution';
  command: string;
  output?: string;
};

export function getVisibleCliCommandSummary(event: ActivityEvent): VisibleCliCommandSummary | null {
  const payload = event.payloadJson as any;
  const toolName = getToolName(payload);
  if (
    toolName !== 'run_command' &&
    toolName !== 'run_verification' &&
    toolName !== 'command_execution'
  ) {
    return null;
  }

  const args = getToolArguments(payload);
  const result = getToolResult(payload);
  const command =
    asString(args?.command) ||
    asString(result?.payload?.command) ||
    asString(payload?.runEvent?.data?.command) ||
    asString(payload?.payload?.command);
  if (!command.trim()) return null;
  const output = getCodexCommandOutput(event);
  return output ? { toolName, command, output } : { toolName, command };
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
