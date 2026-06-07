import type { McpServerSettingsDiagnostic } from '../mcp/mcp-config-schema';
import { loadCodexGlobalConfig } from './config-loader';

const MAX_SAFE_GUIDANCE_LINES_PER_SOURCE = 24;
const MAX_SAFE_GUIDANCE_LINE_CHARS = 500;

export type CodexAgentsGuidance = {
  text: string;
  diagnostics: McpServerSettingsDiagnostic[];
};

type PreparedGuidanceSource = {
  title: string;
  safeLines: string[];
  lifecycleDirectiveCount: number;
  omittedLineCount: number;
  totalLineCount: number;
};

export function renderCodexAgentsGuidance(projectRoot = process.cwd()): CodexAgentsGuidance {
  const loaded = loadCodexGlobalConfig(projectRoot);
  const sources = [
    prepareGuidanceSource('Global Codex AGENTS.md', loaded.globalAgentsText),
    prepareGuidanceSource('Project AGENTS.md', loaded.projectAgentsText),
  ].filter((source): source is PreparedGuidanceSource => source !== null);

  if (sources.length === 0) return { text: '', diagnostics: loaded.diagnostics };

  const safeGuidanceSections = sources
    .filter((source) => source.safeLines.length > 0)
    .map(renderSafeGuidanceSection);
  const lifecycleSummaries = sources
    .filter((source) => source.lifecycleDirectiveCount > 0 || source.omittedLineCount > 0)
    .map(renderLifecycleSummary);

  return {
    text: [
      '[Codex Runtime Guidance]',
      '以下は NightWorkers runtime が読み取った Codex guidance です。',
      'AGENTS.md の raw 本文は provider prompt に渡さず、runtime が安全に分離した guidance だけを渡します。',
      'MCP tool、hook、command、file edit、startup action などの lifecycle directive は provider prompt ではなく runtime 側で扱います。',
      'provider は次の JSON decision だけを返してください。',
      '',
      ...(safeGuidanceSections.length > 0
        ? ['[Safe Guidance]', safeGuidanceSections.join('\n')]
        : ['[Safe Guidance]', 'none']),
      '',
      ...(lifecycleSummaries.length > 0
        ? ['[Runtime Lifecycle Directives]', lifecycleSummaries.join('\n')]
        : ['[Runtime Lifecycle Directives]', 'none']),
      '',
    ].join('\n'),
    diagnostics: loaded.diagnostics,
  };
}

function prepareGuidanceSource(title: string, text: string | null): PreparedGuidanceSource | null {
  const trimmed = text?.trim();
  if (!trimmed) return null;
  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const safeLines: string[] = [];
  let lifecycleDirectiveCount = 0;
  let omittedLineCount = 0;

  for (const line of lines) {
    if (isNativeLifecycleDirective(line)) {
      lifecycleDirectiveCount += 1;
      omittedLineCount += 1;
      continue;
    }
    if (safeLines.length >= MAX_SAFE_GUIDANCE_LINES_PER_SOURCE) {
      omittedLineCount += 1;
      continue;
    }
    safeLines.push(line.slice(0, MAX_SAFE_GUIDANCE_LINE_CHARS));
  }

  return {
    title,
    safeLines,
    lifecycleDirectiveCount,
    omittedLineCount,
    totalLineCount: lines.length,
  };
}

function renderSafeGuidanceSection(source: PreparedGuidanceSource): string {
  return [
    `- ${source.title}: ${source.safeLines.length}/${source.totalLineCount} guidance lines applied`,
    ...source.safeLines.map((line) => `  - ${line}`),
  ].join('\n');
}

function renderLifecycleSummary(source: PreparedGuidanceSource): string {
  return `- ${source.title}: ${source.lifecycleDirectiveCount} lifecycle/native directive lines withheld for runtime handling; ${source.omittedLineCount} total lines omitted.`;
}

function isNativeLifecycleDirective(line: string): boolean {
  const normalized = line.toLowerCase();
  if (normalized.includes('initial_instructions')) return true;
  if (normalized.includes('mcp_tool_call')) return true;
  if (mentionsMcpTool(line) && mentionsExecution(line)) return true;
  if (mentionsHook(line) && mentionsExecution(line)) return true;
  if (mentionsStartupAction(line) && mentionsExecution(line)) return true;
  return false;
}

function mentionsMcpTool(line: string): boolean {
  const normalized = line.toLowerCase();
  return normalized.includes('mcp tool') || line.includes('MCP ツール');
}

function mentionsHook(line: string): boolean {
  const normalized = line.toLowerCase();
  return normalized.includes('hook') || line.includes('フック');
}

function mentionsStartupAction(line: string): boolean {
  return line.includes('最初に') || line.toLowerCase().includes('startup');
}

function mentionsExecution(line: string): boolean {
  const normalized = line.toLowerCase();
  return (
    normalized.includes('execute') ||
    normalized.includes('call') ||
    line.includes('実行') ||
    line.includes('呼び出')
  );
}
