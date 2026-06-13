import { asNumber, asRecord, asString, getToolName, getToolResult } from './ThreadTimeline';
import { NightWorkersCodeBlock } from './ThreadTimelineMarkdown';

type ImportProjectCardEvent = {
  kind?: string;
  eventType?: string | null;
  payloadJson?: unknown;
  seq?: number;
  source?: string;
  status?: string | null;
  runId?: string | null;
};

type CommandOutput = {
  command: string;
  cwd: string;
  exitCode?: number;
  stdout: string;
  stderr: string;
};

export type ImportProjectToolCardModel = {
  title: string;
  toolName: string;
  mode: string;
  targetPath: string;
  sourceSummary: string;
  packageName: string;
  packageManager: string;
  manifestStatus: string;
  manifestPath: string;
  manifestRawContent: string;
  installStatus: string;
  installCommand: string;
  installCwd: string;
  installExitCode?: number;
  installStdout: string;
  installStderr: string;
  installErrorMessage: string;
  verificationCommands: string[];
  llmContextStatus: string;
  llmContextPath: string;
  llmContextRawContent: string;
  gitOperations: CommandOutput[];
  errorMessage: string;
  rawPayload: string;
};

type ExtractedPayload = {
  payload: Record<string, unknown>;
  error: Record<string, unknown>;
};

export function hasImportProjectToolCard(event: ImportProjectCardEvent): boolean {
  return getImportProjectToolCardModel(event) !== null;
}

export function getImportProjectToolCardModel(
  event: ImportProjectCardEvent
): ImportProjectToolCardModel | null {
  const payload = asRecord(event.payloadJson);
  const toolName = getToolName(payload);
  if (!isImportProjectToolName(toolName)) return null;
  if (!isFinishedToolEvent(event)) return null;

  const extracted = extractImportProjectPayload(getToolResult(payload));
  if (!extracted) return null;

  const importPayload = extracted.payload;
  const postImport = asRecord(importPayload.postImport);
  const manifest = asRecord(postImport.manifest);
  const manifestPackage = asRecord(manifest.packageJson);
  const initialization = asRecord(postImport.initialization);
  const llmContext = asRecord(postImport.llmContext);
  const mode = asString(importPayload.mode);
  const source = mode === 'git' ? asRecord(importPayload.git) : asRecord(importPayload.template);
  const targetPath =
    asString(postImport.targetPath) || asString(source.targetPath) || asString(manifest.path);
  const installCommand =
    commandText(initialization.command) || commandText(manifest.installCommand);
  const installExitCode = asNumber(initialization.exitCode);
  const manifestStatus = asString(manifest.status);
  const packageManager =
    asString(manifest.detectedPackageManager) || asString(manifestPackage.packageManager);
  const verificationCommands = Array.isArray(manifest.recommendedVerificationCommands)
    ? manifest.recommendedVerificationCommands.filter((command) => typeof command === 'string')
    : [];
  const gitOperations = extractGitOperations(source);

  return {
    title: 'import_project result',
    toolName: toolName || 'import_project',
    mode,
    targetPath,
    sourceSummary: buildSourceSummary(mode, source),
    packageName: asString(manifestPackage.name),
    packageManager,
    manifestStatus,
    manifestPath: asString(manifest.path),
    manifestRawContent: asString(manifest.rawContent),
    installStatus: asString(initialization.status),
    installCommand,
    installCwd: asString(initialization.cwd),
    installExitCode,
    installStdout: asString(initialization.stdout),
    installStderr: asString(initialization.stderr),
    installErrorMessage: asString(initialization.errorMessage),
    verificationCommands,
    llmContextStatus: asString(llmContext.status),
    llmContextPath: asString(llmContext.path),
    llmContextRawContent: asString(llmContext.rawContent),
    gitOperations,
    errorMessage: asString(asRecord(extracted.error).message),
    rawPayload: stringifyJson(importPayload),
  };
}

export function ImportProjectToolCard({ event }: { event: ImportProjectCardEvent }) {
  const card = getImportProjectToolCardModel(event);
  if (!card) return null;

  return (
    <details className="rounded border border-sky-700/50 bg-sky-950/15" open>
      <summary className="cursor-pointer list-none px-3 py-2 text-xs text-sky-50">
        <span className="mr-2 rounded border border-sky-700/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
          import_project
        </span>
        {card.targetPath || card.sourceSummary || card.title}
        {event.source ? <span className="ml-2 text-sky-200/80">{event.source}</span> : null}
        {typeof event.seq === 'number' ? (
          <span className="ml-2 text-sky-200/60">#{event.seq}</span>
        ) : null}
      </summary>
      <ImportProjectCardBody card={card} maxHeight={320} />
    </details>
  );
}

export function NormalImportProjectToolCard({ event }: { event: ImportProjectCardEvent }) {
  const card = getImportProjectToolCardModel(event);
  if (!card) return null;

  return (
    <details className="overflow-hidden rounded-[var(--radius-md)] border border-transparent bg-[#1f2030] text-sm text-slate-200">
      <summary className="cursor-pointer list-none px-4 py-3">
        <div className="flex items-baseline justify-between gap-4">
          <span className="min-w-0 truncate text-slate-200">
            {card.targetPath || card.sourceSummary || card.title}
          </span>
          <span className="shrink-0 whitespace-nowrap text-right text-slate-400">
            {card.installStatus || card.manifestStatus || card.mode || 'result'}
          </span>
        </div>
        <div className="mt-1 truncate text-xs text-slate-400">
          {[card.packageManager, card.installCommand, card.sourceSummary]
            .filter(Boolean)
            .join(' | ')}
        </div>
      </summary>
      <ImportProjectCardBody card={card} maxHeight={240} />
    </details>
  );
}

function ImportProjectCardBody({
  card,
  maxHeight,
}: {
  card: ImportProjectToolCardModel;
  maxHeight: number;
}) {
  const installOutput = buildInstallOutput(card);
  return (
    <div className="space-y-3 border-t border-slate-700/60 p-3 text-xs text-slate-100">
      <dl className="grid gap-2 sm:grid-cols-2">
        <SummaryItem label="mode" value={card.mode} />
        <SummaryItem label="source" value={card.sourceSummary} />
        <SummaryItem label="target" value={card.targetPath} />
        <SummaryItem label="package" value={card.packageName} />
        <SummaryItem label="manager" value={card.packageManager} />
        <SummaryItem label="manifest" value={card.manifestStatus} />
        <SummaryItem label="install" value={installSummary(card)} />
        <SummaryItem
          label="LLM_CONTEXT"
          value={card.llmContextStatus ? card.llmContextStatus : ''}
        />
      </dl>
      {card.errorMessage ? (
        <div className="rounded border border-rose-800/50 bg-rose-950/30 px-3 py-2 text-rose-100">
          {card.errorMessage}
        </div>
      ) : null}
      {card.gitOperations.length > 0 ? (
        <details className="rounded border border-slate-700/60" open>
          <summary className="cursor-pointer list-none px-3 py-2 text-slate-300">
            git operations
          </summary>
          <div className="space-y-2 border-t border-slate-700/60 p-2">
            {card.gitOperations.map((operation, index) => (
              <NightWorkersCodeBlock
                key={`${operation.command}-${index}`}
                code={formatCommandOutput(operation)}
                filename={`git-${index + 1}.sh`}
                language="shell"
                maxHeight={maxHeight}
                syntaxHighlighting={false}
              />
            ))}
          </div>
        </details>
      ) : null}
      {installOutput ? (
        <NightWorkersCodeBlock
          code={installOutput}
          filename="install.sh"
          language="shell"
          maxHeight={maxHeight}
          syntaxHighlighting={false}
        />
      ) : null}
      {card.verificationCommands.length > 0 ? (
        <NightWorkersCodeBlock
          code={card.verificationCommands.join('\n')}
          filename="recommended-verification.sh"
          language="shell"
          maxHeight={160}
          syntaxHighlighting={false}
        />
      ) : null}
      {card.manifestRawContent ? (
        <NightWorkersCodeBlock
          code={card.manifestRawContent}
          filename={card.manifestPath || 'package.json'}
          language="json"
          maxHeight={maxHeight}
          syntaxHighlighting={false}
        />
      ) : null}
      {card.llmContextRawContent ? (
        <NightWorkersCodeBlock
          code={card.llmContextRawContent}
          filename={card.llmContextPath || 'LLM_CONTEXT.md'}
          language="markdown"
          maxHeight={maxHeight}
          syntaxHighlighting={false}
        />
      ) : null}
      {!card.manifestRawContent && !card.llmContextRawContent && !installOutput ? (
        <NightWorkersCodeBlock
          code={card.rawPayload}
          filename="import_project.json"
          language="json"
          maxHeight={maxHeight}
          syntaxHighlighting={false}
        />
      ) : null}
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase text-slate-500">{label}</dt>
      <dd className="truncate text-slate-200">{value}</dd>
    </div>
  );
}

function isImportProjectToolName(toolName: string | null): boolean {
  return toolName === 'import_project' || toolName === 'nightworkers.import_project';
}

function isFinishedToolEvent(event: ImportProjectCardEvent): boolean {
  if (event.kind === 'tool.result' || event.kind === 'tool.error') return true;
  if (event.eventType === 'tool_result') return true;
  const runEventType = asString(asRecord(asRecord(event.payloadJson).runEvent).type);
  return runEventType === 'tool.call_finished';
}

function extractImportProjectPayload(result: unknown): ExtractedPayload | null {
  const record = asRecord(result);
  const content = Array.isArray(record.content) ? record.content : [];
  for (const item of content) {
    const text = asString(asRecord(item).text);
    if (!text.trim()) continue;
    const parsed = parseJsonRecord(text);
    if (!parsed) continue;
    const extracted = payloadFromParsedResult(parsed);
    if (extracted) return extracted;
  }

  const extracted = payloadFromParsedResult(record);
  if (extracted) return extracted;
  return null;
}

function payloadFromParsedResult(record: Record<string, unknown>): ExtractedPayload | null {
  if (isImportProjectPayload(record)) return { payload: record, error: {} };
  const payload = asRecord(record.payload);
  if (isImportProjectPayload(payload)) {
    return {
      payload,
      error: asRecord(record.error),
    };
  }
  const structuredPayload = asRecord(asRecord(record.structuredContent).payload);
  if (isImportProjectPayload(structuredPayload)) {
    return {
      payload: structuredPayload,
      error: asRecord(record.error),
    };
  }
  return null;
}

function isImportProjectPayload(value: Record<string, unknown>): boolean {
  return (
    typeof value.mode === 'string' &&
    ('template' in value || 'git' in value || 'postImport' in value)
  );
}

function parseJsonRecord(text: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(text));
  } catch {
    return null;
  }
}

function commandText(value: unknown): string {
  if (Array.isArray(value)) return value.filter((part) => typeof part === 'string').join(' ');
  return asString(value);
}

function buildSourceSummary(mode: string, source: Record<string, unknown>) {
  if (mode === 'git') {
    return [asString(source.repoUrl), asString(source.ref), asString(source.commit)]
      .filter(Boolean)
      .join(' @ ');
  }
  if (mode === 'template') {
    return [
      asString(source.templateId),
      asString(source.variant),
      asString(source.ref),
      asString(source.commit),
    ]
      .filter(Boolean)
      .join(' @ ');
  }
  return '';
}

function extractGitOperations(source: Record<string, unknown>): CommandOutput[] {
  const operations = Array.isArray(source.gitOperations) ? source.gitOperations : [];
  return operations
    .map((operation) => {
      const record = asRecord(operation);
      return {
        command: asString(record.command),
        cwd: asString(record.cwd),
        exitCode: asNumber(record.exitCode),
        stdout: asString(record.stdout),
        stderr: asString(record.stderr),
      };
    })
    .filter((operation) => operation.command);
}

function installSummary(card: ImportProjectToolCardModel) {
  return [card.installStatus, card.installCommand, exitCodeText(card.installExitCode)]
    .filter(Boolean)
    .join(' | ');
}

function exitCodeText(exitCode?: number) {
  return typeof exitCode === 'number' ? `exit ${exitCode}` : '';
}

function buildInstallOutput(card: ImportProjectToolCardModel) {
  const output = formatCommandOutput({
    command: card.installCommand,
    cwd: card.installCwd,
    exitCode: card.installExitCode,
    stdout: card.installStdout,
    stderr: card.installStderr || card.installErrorMessage,
  });
  return output.trim() ? output : '';
}

function formatCommandOutput(output: CommandOutput) {
  return [
    output.cwd ? `# cwd: ${output.cwd}` : '',
    output.command ? `$ ${output.command}` : '',
    exitCodeText(output.exitCode),
    output.stdout ? ['# stdout', output.stdout].join('\n') : '',
    output.stderr ? ['# stderr', output.stderr].join('\n') : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '';
  }
}
