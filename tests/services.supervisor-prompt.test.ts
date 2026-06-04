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

function extractToolCatalog(prompt: string): string {
  return prompt.slice(prompt.indexOf('[Tool catalog]'));
}

function countToolCatalogEntries(value: string, toolName: string): number {
  const pattern = new RegExp(`^- ${toolName}:`, 'gm');
  return value.match(pattern)?.length ?? 0;
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
      expect(countToolCatalogEntries(toolCatalog, toolName)).toBe(1);
    }
  });

  it('lists external MCP tools through the internal bridge contract', () => {
    const prompt = buildRound2SystemPrompt('research', {
      externalTools: [
        {
          namespacedName: 'mcp__docs__lookup',
          serverId: 'server-1',
          toolName: 'lookup',
          description: 'Look up documentation.',
        },
      ],
    });

    expect(prompt).toContain('[External MCP tools]');
    expect(prompt).toContain('mcp__docs__lookup');
    expect(prompt).toContain('toolCall.name="mcp_call_tool"');
    expect(prompt).toContain('arguments.serverId="server-1"');
    expect(prompt).toContain('arguments.toolName="lookup"');
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
    expect(prompt).toContain('既存ファイルの単純な変更では replace_content を第一選択にする');
    expect(prompt).toContain(
      '新規ファイル作成、複数ファイル変更、構造的な編集では apply_patch を使う'
    );
    expect(prompt).toContain('replace_content または apply_patch の toolCall を返して編集を試みる');
  });

  it('describes replace_content as the primary tool for existing-file edits', () => {
    const prompt = buildRound2SystemPrompt('code_change');
    const replaceContentIndex = prompt.indexOf('- replace_content:');
    const applyPatchIndex = prompt.indexOf('- apply_patch:');

    expect(replaceContentIndex).toBeGreaterThanOrEqual(0);
    expect(applyPatchIndex).toBeGreaterThan(replaceContentIndex);
    expect(prompt).toContain('既存ファイルの編集で優先する');
    expect(prompt).toContain('既存ファイルの単純置換では replace_content を優先する');
  });

  it('keeps project root visible in round 2 execution prompts', () => {
    const prompt = buildRound2SystemPrompt('code_change', { projectRoot: '/repo/project' });

    expect(prompt).toContain('プロジェクトルート: /repo/project');
    expect(prompt).toContain(
      'worker tool の実行結果が observations に無い場合、cp / mv / touch / apply_patch / replace_content / run_command を実行済み、失敗済み、拒否済みだと書いてはいけません。'
    );
    expect(prompt).toContain(
      '編集ツールを実行していないまま read-only / 書き込み不可 / 権限不足を理由に phase="stop" を返してはいけません。'
    );
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

  it('teaches round 1 to classify prototype and image requests as blueprint tasks', () => {
    const prompt = buildRound1SystemPrompt('/repo');

    expect(prompt).toContain('[Blueprint routing]');
    expect(prompt).toContain('試作して');
    expect(prompt).toContain('どんなイメージか教えて');
    expect(prompt).toContain('Blueprint を見たい');
    expect(prompt).toContain('ECサイトトップページ');
    expect(prompt).toContain("workKinds: ['blueprint', 'ui_ux']");
    expect(prompt).toContain("subtype: 'app_blueprint'");
    expect(prompt).toContain("nextSkillFiles: ['references/work_kinds/blueprint.md']");
  });

  it('loads the blueprint skill body when routing requests an app blueprint', () => {
    const prompt = buildRound2SystemPrompt({
      primaryMode: 'planning',
      secondaryModes: ['review'],
      phase: 'plan',
      workKinds: ['blueprint', 'ui_ux'],
      overlays: ['user_facing_change'],
      subtype: 'app_blueprint',
      requiredEvidence: ['latest user request'],
      nextSkillFiles: ['references/work_kinds/blueprint.md'],
      confidence: 0.85,
    });

    expect(prompt).toContain('[Skill Document: references/work_kinds/blueprint.md]');
    expect(prompt).toContain('試作して');
    expect(prompt).toContain('Blueprint artifact');
    expect(prompt).toContain('shared/schemas/app-blueprint.schema.ts');
    expect(prompt).toContain('### JSON Contract');
    expect(prompt).toContain('dataBindingId');
    expect(prompt).toContain('blueprint-catalog.schema.ts');
    expect(prompt).toContain('[Re-evaluation Gate]');
  });
});
