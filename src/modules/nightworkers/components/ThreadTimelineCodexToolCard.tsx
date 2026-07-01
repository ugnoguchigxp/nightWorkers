import type { ActivityEvent, TaskEvent } from '../types';
import {
  asRecord,
  asString,
  getActivityChangedFiles,
  getToolActivityModel,
  type ToolActivityLifecycle,
} from './ThreadTimeline';
import { NightWorkersCodeBlock } from './ThreadTimelineMarkdown';
import { sanitizeTerminalPreviewValue, sanitizeTerminalText } from './terminalText';

type CodexToolLifecycle = 'started' | 'progress' | 'result' | 'failed';
type CodexToolStatus = 'started' | 'running' | 'ok' | 'failed';

export type CodexToolCardModel = {
  lifecycle: CodexToolLifecycle;
  status: CodexToolStatus;
  providerItemId?: string;
  toolName: string;
  codexKind: 'mcp' | 'command' | 'file_change';
  title: string;
  summary: string;
  metadata: Array<{ label: string; value: string }>;
  argumentsPreview?: string;
  resultPreview?: string;
  outputPreview?: string;
  errorMessage?: string;
};

type CodexToolCardEvent = {
  kind?: string;
  eventType?: string | null;
  payloadJson?: unknown;
  seq?: number;
  runId?: string | null;
  source?: string;
  status?: string | null;
};

export function hasCodexToolCard(event: CodexToolCardEvent): boolean {
  return getCodexToolCardModel(event) !== null;
}

export function getCodexToolCardModel(event: CodexToolCardEvent): CodexToolCardModel | null {
  const payload = asRecord(event.payloadJson ?? event);
  const data = getCodexActivityData(payload);
  if (asString(data.provider) !== 'codex') return null;

  const activity = getToolActivityModel(event);
  const toolName = activity?.toolName || asString(data.toolName);
  const lifecycle = normalizeLifecycle({
    lifecycle: activity?.lifecycle,
    eventKind: event.kind,
    eventType: event.eventType,
    providerEventType: asString(data.providerEventType),
  });
  if (!toolName || !lifecycle) return null;

  if (isIgnoredByDedicatedCard(toolName)) return null;

  const providerItemId = asString(data.providerItemId);
  const status = normalizeStatus(lifecycle, asString(data.status) || event.status);
  const errorMessage = getErrorMessage(data, activity?.error);

  if (isCodexMcpTool(data, toolName)) {
    return buildMcpCard({
      data,
      activityArguments: activity?.arguments ?? {},
      activityRawResult: activity?.rawResult ?? {},
      lifecycle,
      status,
      providerItemId,
      toolName,
      errorMessage,
    });
  }

  if (toolName === 'command_execution') {
    return buildCommandCard({ data, lifecycle, status, providerItemId, errorMessage });
  }

  const changedFiles = getActivityChangedFiles(event as ActivityEvent);
  if (changedFiles.length > 0) {
    return buildFileChangeCard({ data, lifecycle, status, providerItemId, changedFiles });
  }

  return null;
}

export function CodexToolCard({ event }: { event: TaskEvent | ActivityEvent }) {
  const card = getCodexToolCardModel(event);
  if (!card) return null;

  return (
    <details className="rounded border border-cyan-700/60 bg-cyan-950/20 text-slate-100" open>
      <summary className="cursor-pointer list-none px-3 py-2 text-xs">
        <span className="mr-2 rounded border border-current/30 px-1.5 py-0.5">{card.title}</span>
        <span className="text-current/80">{card.summary}</span>
        {typeof event.seq === 'number' ? (
          <span className="ml-2 text-current/50">#{event.seq}</span>
        ) : null}
      </summary>
      <CodexToolCardBody card={card} debug />
    </details>
  );
}

export function NormalCodexToolCard({ event }: { event: TaskEvent | ActivityEvent }) {
  const card = getCodexToolCardModel(event);
  if (!card) return null;

  return (
    <details className="overflow-hidden rounded-[var(--radius-md)] border border-transparent bg-[#1f2030] text-sm text-slate-200">
      <summary className="cursor-pointer list-none px-4 py-3">
        <div className="flex items-baseline justify-between gap-4">
          <span className="min-w-0 truncate text-slate-200">{card.summary}</span>
          <span className="shrink-0 whitespace-nowrap text-right text-slate-400">{card.title}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
          <span>{statusLabel(card)}</span>
          {card.metadata.slice(0, 3).map((item) => (
            <span key={`${item.label}:${item.value}`}>
              {item.label}: {item.value}
            </span>
          ))}
        </div>
      </summary>
      <CodexToolCardBody card={card} />
    </details>
  );
}

function CodexToolCardBody({ card, debug = false }: { card: CodexToolCardModel; debug?: boolean }) {
  const detailLines = [
    `toolName: ${card.toolName}`,
    `lifecycle: ${card.lifecycle}`,
    `status: ${card.status}`,
    card.providerItemId ? `providerItemId: ${card.providerItemId}` : '',
    ...card.metadata.map((item) => `${item.label}: ${item.value}`),
    card.errorMessage ? `error: ${card.errorMessage}` : '',
  ].filter(Boolean);
  const blocks = [
    detailLines.join('\n'),
    card.argumentsPreview ? `arguments:\n${card.argumentsPreview}` : '',
    card.resultPreview ? `result:\n${card.resultPreview}` : '',
    card.outputPreview ? `output:\n${card.outputPreview}` : '',
  ].filter(Boolean);
  if (blocks.length === 0) return null;

  return (
    <div className="border-slate-700/60 border-t">
      <NightWorkersCodeBlock
        code={blocks.join('\n\n')}
        filename={`${card.toolName}.txt`}
        language="text"
        maxHeight={debug ? 320 : 220}
        syntaxHighlighting={false}
      />
    </div>
  );
}

function buildMcpCard(input: {
  data: Record<string, unknown>;
  activityArguments: Record<string, unknown>;
  activityRawResult: Record<string, unknown>;
  lifecycle: CodexToolLifecycle;
  status: CodexToolStatus;
  providerItemId?: string;
  toolName: string;
  errorMessage?: string;
}): CodexToolCardModel {
  const server = asString(input.data.mcpServer) || serverFromToolName(input.toolName);
  const tool = asString(input.data.mcpTool) || toolFromToolName(input.toolName);
  const args = pickNonEmptyRecord(asRecord(input.data.arguments), input.activityArguments);
  const result = pickNonEmptyRecord(asRecord(input.data.result), input.activityRawResult);
  const operation = asString(args.operation);
  const seq = typeof args.seq === 'number' ? String(args.seq) : '';
  const summaryParts = [
    input.toolName,
    operation ? `operation=${operation}` : '',
    seq ? `seq=${seq}` : '',
  ].filter(Boolean);

  return {
    lifecycle: input.lifecycle,
    status: input.status,
    providerItemId: input.providerItemId || undefined,
    toolName: input.toolName,
    codexKind: 'mcp',
    title: 'Codex MCP',
    summary: summaryParts.join(' | '),
    metadata: compactMetadata([
      ['server', server],
      ['tool', tool],
      ['provider status', asString(input.data.status)],
    ]),
    argumentsPreview: stringifyPreview(args),
    resultPreview: stringifyPreview(result),
    errorMessage: input.errorMessage,
  };
}

function buildCommandCard(input: {
  data: Record<string, unknown>;
  lifecycle: CodexToolLifecycle;
  status: CodexToolStatus;
  providerItemId?: string;
  errorMessage?: string;
}): CodexToolCardModel | null {
  const command = asString(input.data.command);
  if (!command) return null;
  const commandClass = asString(input.data.commandClass);
  const exitCode =
    typeof input.data.exitCode === 'number' || input.data.exitCode === null
      ? String(input.data.exitCode ?? 'pending')
      : '';

  return {
    lifecycle: input.lifecycle,
    status: input.status,
    providerItemId: input.providerItemId || undefined,
    toolName: 'command_execution',
    codexKind: 'command',
    title: 'Codex command',
    summary: `command_execution | ${command}`,
    metadata: compactMetadata([
      ['class', commandClass],
      ['exit', exitCode],
      ['provider status', asString(input.data.status)],
    ]),
    outputPreview: sanitizeTerminalText(asString(input.data.aggregatedOutput)) || undefined,
    errorMessage: input.errorMessage,
  };
}

function buildFileChangeCard(input: {
  data: Record<string, unknown>;
  lifecycle: CodexToolLifecycle;
  status: CodexToolStatus;
  providerItemId?: string;
  changedFiles: string[];
}): CodexToolCardModel {
  return {
    lifecycle: input.lifecycle,
    status: input.status,
    providerItemId: input.providerItemId || undefined,
    toolName: 'file_change',
    codexKind: 'file_change',
    title: 'Codex file change',
    summary: `Changed files (${input.changedFiles.length})`,
    metadata: compactMetadata([['provider status', asString(input.data.status)]]),
    resultPreview: input.changedFiles.map((file) => `- ${file}`).join('\n'),
  };
}

function getCodexActivityData(payload: Record<string, unknown>) {
  const directPayload = asRecord(payload.payload);
  if (Object.keys(directPayload).length > 0) return directPayload;
  const runEvent = asRecord(payload.runEvent);
  const runEventData = asRecord(runEvent.data);
  if (Object.keys(runEventData).length > 0) return runEventData;
  return payload;
}

function normalizeLifecycle(input: {
  lifecycle: ToolActivityLifecycle | undefined;
  eventKind?: string;
  eventType?: string | null;
  providerEventType?: string;
}): CodexToolLifecycle | null {
  const { lifecycle } = input;
  if (lifecycle === 'started' || lifecycle === 'progress' || lifecycle === 'failed') {
    return lifecycle;
  }
  if (lifecycle === 'result') return 'result';
  if (input.eventType === 'tool.call_started') return 'started';
  if (input.eventType === 'tool.call_progress') return 'progress';
  if (input.eventType === 'tool.call_finished') return 'result';
  if (input.providerEventType === 'item.started') return 'started';
  if (input.providerEventType === 'item.updated') return 'progress';
  if (input.providerEventType === 'item.completed') return 'result';
  if (input.eventKind === 'file.diff') return 'result';
  return null;
}

function normalizeStatus(lifecycle: CodexToolLifecycle, providerStatus?: string | null) {
  if (providerStatus === 'failed' || providerStatus === 'error' || providerStatus === 'cancelled') {
    return 'failed';
  }
  if (lifecycle === 'failed') return 'failed';
  if (lifecycle === 'started') return 'started';
  if (lifecycle === 'progress') return 'running';
  return 'ok';
}

function statusLabel(card: CodexToolCardModel) {
  const lifecycle =
    card.lifecycle === 'result'
      ? 'finished'
      : card.lifecycle === 'progress'
        ? 'running'
        : card.lifecycle;
  return card.status === 'failed' ? `${lifecycle} failed` : lifecycle;
}

function isCodexMcpTool(data: Record<string, unknown>, toolName: string) {
  return Boolean(
    asString(data.mcpServer) ||
      asString(data.mcpTool) ||
      toolName.startsWith('nightworkers.') ||
      toolName.startsWith('context-still.')
  );
}

function isIgnoredByDedicatedCard(toolName: string) {
  return toolName === 'nightworkers.import_project' || toolName.startsWith('context-still.');
}

function getErrorMessage(data: Record<string, unknown>, activityError?: Record<string, unknown>) {
  const direct = asString(data.error);
  if (direct) return direct;
  const error = asRecord(activityError);
  return asString(error.message) || asString(error.code) || undefined;
}

function serverFromToolName(toolName: string) {
  return toolName.includes('.') ? toolName.split('.')[0] : '';
}

function toolFromToolName(toolName: string) {
  const index = toolName.indexOf('.');
  return index >= 0 ? toolName.slice(index + 1) : toolName;
}

function compactMetadata(
  entries: Array<[string, string | undefined]>
): CodexToolCardModel['metadata'] {
  return entries
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== '')
    .map(([label, value]) => ({ label, value }));
}

function pickNonEmptyRecord(preferred: Record<string, unknown>, fallback: Record<string, unknown>) {
  return Object.keys(preferred).length > 0 ? preferred : fallback;
}

function stringifyPreview(value: unknown) {
  if (!value || typeof value !== 'object') return undefined;
  if (Object.keys(asRecord(value)).length === 0) return undefined;
  try {
    return JSON.stringify(sanitizeTerminalPreviewValue(value), null, 2);
  } catch {
    return undefined;
  }
}
