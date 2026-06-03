import { describe, expect, it } from 'vitest';
import {
  buildRound1SystemPrompt,
  buildRound2SystemPrompt,
} from '../api/services/supervisor/prompt';

const workerToolNames = [
  'list_dir',
  'find_file',
  'read_file',
  'inspect_structure',
  'search_files',
  'search_web',
  'fetch_content',
  'git_status',
  'apply_patch',
  'replace_content',
  'run_command',
  'git_diff',
];

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

function extractToolCatalog(prompt: string): string {
  return prompt.slice(prompt.indexOf('[Tool catalog]'));
}

describe('Supervisor prompt structure', () => {
  it('keeps worker tool names out of the workflow selection prompt', () => {
    const prompt = buildRound1SystemPrompt('/repo');

    for (const toolName of workerToolNames) {
      expect(prompt).not.toContain(toolName);
    }
  });

  it('lists each worker tool name only once in the execution prompt', () => {
    const prompt = buildRound2SystemPrompt('evidence_review');
    const toolCatalog = extractToolCatalog(prompt);

    for (const toolName of workerToolNames) {
      expect(countOccurrences(toolCatalog, toolName)).toBe(1);
    }
  });

  it('forces evidence review to use tools before returning a UI review result', () => {
    const prompt = buildRound2SystemPrompt('evidence_review');

    expect(prompt).toContain('observations が空の場合');
    expect(prompt).toContain('toolCall を必ず返す');
    expect(prompt).toContain('phase="stop" の finalResponse は UI に表示されるレビュー結果本文');
    expect(prompt).toContain('latestUserMessage は元の依頼');
  });

  it('forces code change workflow to attempt edit tools instead of claiming read-only', () => {
    const prompt = buildRound2SystemPrompt('code_change');

    expect(prompt).toContain('observations が空の場合');
    expect(prompt).toContain('read_file または search_files');
    expect(prompt).toContain('read-only や書き込み不可だと推測して stop してはいけない');
    expect(prompt).toContain('replace_content または apply_patch の toolCall を返して編集を試みる');
  });

  it('loads routing references without putting their full body in round 1', () => {
    const round1 = buildRound1SystemPrompt('/repo');
    const round2 = buildRound2SystemPrompt({
      primaryMode: 'code_edit',
      secondaryModes: ['test_and_verification'],
      phase: 'execute',
      workKinds: ['code'],
      overlays: ['evidence'],
      requiredEvidence: ['repo inspection'],
      nextSkillFiles: [],
      confidence: 0.8,
    });

    expect(round1).toContain('routing hypothesis');
    expect(round1).not.toContain('[Skill Document: references/modes/code_edit.md]');
    expect(round2).toContain('[Skill Document: references/modes/code_edit.md]');
    expect(round2).toContain('[Re-evaluation Gate]');
  });
});
