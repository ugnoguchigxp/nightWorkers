import { describe, expect, it } from 'vitest';
import {
  buildRound1JobTypePrompt,
  buildRound1PromptPacket,
  buildRound2PromptPacket,
  buildRound2ToolCallPrompt,
  getAllowedToolsForJobType,
} from '../api/services/supervisor/prompt';

describe('supervisor prompt packet', () => {
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
});
