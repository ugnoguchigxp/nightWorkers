import { asRecord, asString, getToolArguments, getToolName, getToolResult } from './ThreadTimeline';
import { ChatMarkdown, NightWorkersCodeBlock } from './ThreadTimelineMarkdown';

type ContextStillCardKind =
  | 'initial_instructions_result'
  | 'context_compile_input'
  | 'context_compile_output'
  | 'compile_eval_input';

export type ContextStillToolCardModel = {
  kind: ContextStillCardKind;
  title: string;
  toolName: string;
  body: string;
  format: 'markdown' | 'json';
  summary?: string;
};

type ContextStillCardEvent = {
  kind?: string;
  eventType?: string | null;
  message?: string;
  payloadJson?: unknown;
  seq?: number;
  source?: string;
  status?: string | null;
};

export function hasContextStillToolCard(event: ContextStillCardEvent): boolean {
  return getContextStillToolCardModel(event) !== null;
}

export function getContextStillToolCardModel(
  event: ContextStillCardEvent
): ContextStillToolCardModel | null {
  const payload = asRecord(event.payloadJson);
  const toolName = getToolName(payload);
  if (!toolName?.startsWith('context-still.')) return null;

  const lifecycle = getToolLifecycle(event);
  const args = asRecord(getToolArguments(payload));
  const result = asRecord(getToolResult(payload));

  if (toolName === 'context-still.initial_instructions' && lifecycle === 'result') {
    const body = extractResultBody(result);
    if (!body) return null;
    return {
      kind: 'initial_instructions_result',
      title: 'initial_instructions result',
      toolName,
      body,
      format: 'markdown',
    };
  }

  if (toolName === 'context-still.context_compile') {
    if (lifecycle === 'started') {
      const body = stringifyJson(args);
      if (!body) return null;
      return {
        kind: 'context_compile_input',
        title: 'context_compile input',
        toolName,
        body,
        format: 'json',
        summary: asString(args.goal),
      };
    }
    if (lifecycle === 'result') {
      const body = extractResultBody(result);
      if (!body) return null;
      return {
        kind: 'context_compile_output',
        title: 'context_compile output',
        toolName,
        body,
        format: 'markdown',
      };
    }
    return null;
  }

  if (toolName === 'context-still.compile_eval' && lifecycle === 'started') {
    const body = stringifyJson(args);
    if (!body) return null;
    return {
      kind: 'compile_eval_input',
      title: 'compile_eval input',
      toolName,
      body,
      format: 'json',
      summary: asString(args.title) || asString(args.outcome),
    };
  }

  return null;
}

export function ContextStillToolCard({ event }: { event: ContextStillCardEvent }) {
  const card = getContextStillToolCardModel(event);
  if (!card) return null;

  return (
    <details className="rounded border border-cyan-700/50 bg-cyan-950/15" open>
      <summary className="cursor-pointer list-none px-3 py-2 text-xs text-cyan-50">
        <span className="mr-2 rounded border border-cyan-700/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
          ContextStill
        </span>
        {card.title}
        {event.source ? <span className="ml-2 text-cyan-200/80">{event.source}</span> : null}
        {typeof event.seq === 'number' ? (
          <span className="ml-2 text-cyan-200/60">#{event.seq}</span>
        ) : null}
      </summary>
      <div className="space-y-2 border-t border-cyan-900/50 px-3 py-2 text-xs text-cyan-50">
        {card.summary ? <div className="text-cyan-100">{card.summary}</div> : null}
        {card.format === 'markdown' ? (
          <ChatMarkdown content={card.body} />
        ) : (
          <NightWorkersCodeBlock
            code={card.body}
            filename={`${card.title}.json`}
            language="json"
            maxHeight={320}
            syntaxHighlighting={false}
          />
        )}
      </div>
    </details>
  );
}

export function NormalContextStillToolCard({ event }: { event: ContextStillCardEvent }) {
  const card = getContextStillToolCardModel(event);
  if (!card) return null;

  return (
    <details className="overflow-hidden rounded-[var(--radius-md)] border border-transparent bg-[#1f2030] text-sm text-slate-200">
      <summary className="cursor-pointer list-none px-4 py-3">
        <div className="flex items-baseline justify-between gap-4">
          <span className="min-w-0 truncate text-slate-200">{card.title}</span>
          <span className="shrink-0 whitespace-nowrap text-right text-slate-400">
            {card.toolName}
          </span>
        </div>
        {card.summary ? (
          <div className="mt-1 truncate text-xs text-slate-400">{card.summary}</div>
        ) : null}
      </summary>
      <div className="border-slate-700/60 border-t p-3">
        {card.format === 'markdown' ? (
          <ChatMarkdown content={card.body} />
        ) : (
          <NightWorkersCodeBlock
            code={card.body}
            filename={`${card.title}.json`}
            language="json"
            maxHeight={240}
            syntaxHighlighting={false}
          />
        )}
      </div>
    </details>
  );
}

function getToolLifecycle(event: ContextStillCardEvent): 'started' | 'result' | 'other' {
  if (event.kind === 'tool.result' || event.eventType === 'tool_result') return 'result';
  if (event.kind === 'tool.call') {
    const runEvent = asRecord(asRecord(event.payloadJson).runEvent);
    const runEventType = asString(runEvent.type);
    return runEventType === 'tool.call_progress' ? 'other' : 'started';
  }

  const runEvent = asRecord(asRecord(event.payloadJson).runEvent);
  const runEventType = asString(runEvent.type);
  if (runEventType === 'tool.call_finished') return 'result';
  if (runEventType === 'tool.call_started') return 'started';
  return 'other';
}

function extractResultBody(result: Record<string, unknown>): string {
  const content = Array.isArray(result.content) ? result.content : [];
  const text = content
    .flatMap((item) => {
      const record = asRecord(item);
      return typeof record.text === 'string' ? [record.text.trim()] : [];
    })
    .filter(Boolean)
    .join('\n\n')
    .trim();
  if (text) return text;
  return stringifyJson(result);
}

function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '';
  }
}
