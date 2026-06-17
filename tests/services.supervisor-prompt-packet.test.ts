import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildRound1JobTypePrompt,
  buildRound1PromptPacket,
  buildRound2PromptPacket,
  buildRound2ToolCallPrompt,
  getAllowedToolsForJobType,
} from '../api/services/supervisor/prompt';

const originalCodexHome = process.env.NIGHTWORKERS_CODEX_HOME;

describe('supervisor prompt packet', () => {
  let codexHome: string;

  beforeEach(() => {
    codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'nightworkers-codex-home-'));
    process.env.NIGHTWORKERS_CODEX_HOME = codexHome;
  });

  afterEach(() => {
    if (originalCodexHome === undefined) delete process.env.NIGHTWORKERS_CODEX_HOME;
    else process.env.NIGHTWORKERS_CODEX_HOME = originalCodexHome;
    fs.rmSync(codexHome, { recursive: true, force: true });
  });

  it('keeps public prompt rendering while exposing inspectable packet sections', () => {
    const packet = buildRound2PromptPacket({
      projectRoot: '/repo',
      jobType: 'minor_code_edit',
      tools: getAllowedToolsForJobType('minor_code_edit'),
    });
    const rendered = buildRound2ToolCallPrompt({
      projectRoot: '/repo',
      jobType: 'minor_code_edit',
      tools: getAllowedToolsForJobType('minor_code_edit'),
    });

    expect(packet.diagnostics).toMatchObject({
      round: 2,
      projectRoot: '/repo',
      jobType: 'minor_code_edit',
    });
    expect(packet.executionEvidence.join('\n')).toContain('[Minimum Execution Contract]');
    expect(packet.executionEvidence.join('\n')).toContain(
      'apply_patch/replace_content for implementation'
    );
    expect(packet.executionEvidence.join('\n')).toContain('Progress Context の nextConcreteAction');
    expect(packet.outputContract.join('\n')).toContain('[Allowed Tools]');
    expect(rendered).toContain('[Minimum Execution Contract]');
    expect(rendered).not.toContain('"diagnostics"');
  });

  it('renders round1 from packet without exposing diagnostics', () => {
    const packet = buildRound1PromptPacket('/repo');
    const rendered = buildRound1JobTypePrompt('/repo');

    expect(packet.diagnostics).toEqual({ round: 1, projectRoot: '/repo' });
    expect(packet.runtimeContext.join('\n')).toContain('[Job Types]');
    expect(rendered).toContain('[Output Schema]');
    expect(rendered).not.toContain('"diagnostics"');
  });

  it('renders safe AGENTS.md guidance without raw native tool directives', () => {
    fs.writeFileSync(
      path.join(codexHome, 'AGENTS.md'),
      [
        '最初に initial_instructions MCP tool を実行してください。',
        'Supervisor の実行方針は prompt 側で定義してください。',
      ].join('\n')
    );

    const rendered = buildRound1JobTypePrompt('/repo');

    expect(rendered).toContain('[Codex Runtime Guidance]');
    expect(rendered).toContain('runtime が安全に分離した guidance');
    expect(rendered).toContain('Global Codex AGENTS.md: 1/2 guidance lines applied');
    expect(rendered).toContain('Supervisor の実行方針は prompt 側で定義してください。');
    expect(rendered).toContain('1 lifecycle/native directive lines withheld');
    expect(rendered).not.toContain('initial_instructions MCP tool');
  });
});
