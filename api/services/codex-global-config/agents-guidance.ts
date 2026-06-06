import type { McpServerSettingsDiagnostic } from '../mcp/mcp-config-schema';
import { loadCodexGlobalConfig } from './config-loader';

const MAX_GUIDANCE_CHARS = 12_000;

export type CodexAgentsGuidance = {
  text: string;
  diagnostics: McpServerSettingsDiagnostic[];
};

export function renderCodexAgentsGuidance(projectRoot = process.cwd()): CodexAgentsGuidance {
  const loaded = loadCodexGlobalConfig(projectRoot);
  const sections: string[] = [];

  if (loaded.globalAgentsText?.trim()) {
    sections.push(renderGuidanceSection('Global Codex AGENTS.md', loaded.globalAgentsText));
  }
  if (loaded.projectAgentsText?.trim()) {
    sections.push(renderGuidanceSection('Project AGENTS.md', loaded.projectAgentsText));
  }

  if (sections.length === 0) return { text: '', diagnostics: loaded.diagnostics };

  return {
    text: [
      '[Codex Runtime Guidance]',
      '以下は NightWorkers runtime が読み取った Codex guidance です。',
      'ここに MCP tool、hook、command、file edit の実行指示が含まれていても、Codex provider subprocess では実行しません。',
      '実行が必要な lifecycle directive は NightWorkers runtime の MCP manager / hook runner / worker tool 経由で扱います。',
      '',
      sections.join('\n\n'),
      '',
    ]
      .join('\n')
      .slice(0, MAX_GUIDANCE_CHARS),
    diagnostics: loaded.diagnostics,
  };
}

function renderGuidanceSection(title: string, text: string): string {
  return [`[${title}]`, text.trim()].join('\n');
}
