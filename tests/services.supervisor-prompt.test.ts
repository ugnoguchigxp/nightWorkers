import { describe, expect, it } from 'vitest';
import {
  buildRound1SystemPrompt,
  buildRound2SystemPrompt,
} from '../api/services/supervisor/prompt';

const workerToolNames = [
  'list_dir',
  'find_file',
  'read_file',
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

describe('Supervisor prompt structure', () => {
  it('keeps worker tool names out of the workflow selection prompt', () => {
    const prompt = buildRound1SystemPrompt('/repo');

    for (const toolName of workerToolNames) {
      expect(prompt).not.toContain(toolName);
    }
  });

  it('lists each worker tool name only once in the execution prompt', () => {
    const prompt = buildRound2SystemPrompt('evidence_review');

    for (const toolName of workerToolNames) {
      expect(countOccurrences(prompt, toolName)).toBe(1);
    }
  });

  it('forces evidence review to use tools before returning a UI review result', () => {
    const prompt = buildRound2SystemPrompt('evidence_review');

    expect(prompt).toContain('observations が空の場合');
    expect(prompt).toContain('toolCall を必ず返す');
    expect(prompt).toContain('phase="stop" の finalResponse は UI に表示されるレビュー結果本文');
    expect(prompt).toContain('latestUserMessage は元の依頼');
  });
});
