import { mkdtempSync, writeFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import os, { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getAllowedToolsForJobType } from '../api/services/supervisor/prompt';
import {
  readSupervisorSkill,
  searchSupervisorSkills,
} from '../api/services/supervisor/skill-tools';
import {
  clearSupervisorSkillDocumentCache,
  listSupervisorSkillDocuments,
  renderSupervisorSkillDocuments,
  resolveSupervisorSkillDocuments,
} from '../api/services/supervisor/skills/registry';

describe('Supervisor skill registry', () => {
  it('loads the complete built-in routing document set', () => {
    const documents = listSupervisorSkillDocuments();

    expect(documents.some((document) => document.relativePath === 'SKILL.md')).toBe(true);
    expect(
      documents.some((document) => document.relativePath === 'references/modes/code_edit.md')
    ).toBe(true);
    expect(
      documents.some((document) => document.relativePath === 'references/overlays/evidence.md')
    ).toBe(true);
    expect(
      documents.some((document) => document.relativePath === 'references/work_kinds/blueprint.md')
    ).toBe(true);
    expect(documents.every((document) => document.digest.startsWith('sha256:'))).toBe(true);
  });

  it('resolves only references needed by the routing hypothesis', () => {
    const documents = resolveSupervisorSkillDocuments({
      primaryMode: 'code_edit',
      secondaryModes: ['test_and_verification'],
      phase: 'execute',
      workKinds: ['code'],
      overlays: ['evidence'],
      requiredEvidence: ['repo inspection'],
      nextSkillFiles: [],
      confidence: 0.8,
    });
    const paths = documents.map((document) => document.relativePath);

    expect(paths).toContain('SKILL.md');
    expect(paths).toContain('references/router.md');
    expect(paths).toContain('references/phases/execute.md');
    expect(paths).toContain('references/modes/code_edit.md');
    expect(paths).toContain('references/modes/test_and_verification.md');
    expect(paths).toContain('references/work_kinds/code.md');
    expect(paths).toContain('references/overlays/evidence.md');
    expect(paths).not.toContain('references/overlays/security.md');
  });

  it('covers minor_code_edit routing with code-edit references and narrow edit tool policy', () => {
    const documents = resolveSupervisorSkillDocuments({
      primaryMode: 'code_edit',
      secondaryModes: [],
      phase: 'execute',
      workKinds: ['code'],
      overlays: ['evidence'],
      requiredEvidence: ['target file inspection'],
      nextSkillFiles: [],
      confidence: 0.9,
    });
    const paths = documents.map((document) => document.relativePath);
    const rendered = renderSupervisorSkillDocuments(documents);
    const toolNames = getAllowedToolsForJobType('minor_code_edit').map((tool) => tool.name);

    expect(paths).toEqual([
      'SKILL.md',
      'references/router.md',
      'references/phases/execute.md',
      'references/modes/code_edit.md',
      'references/work_kinds/code.md',
      'references/overlays/evidence.md',
    ]);
    expect(rendered).toContain('編集前に既存コードを確認する');
    expect(rendered).toContain('変更前に関連ファイルを読む');
    expect(rendered).toContain('code edit 後は verify に進む');
    expect(rendered).toContain('observations が空の場合、最終回答へ進まず');

    expect(toolNames).toEqual([
      'read_skill',
      'search_skill',
      'read_current_specification',
      'read_file',
      'search_files',
      'copy_directory',
      'apply_patch',
      'replace_content',
      'run_command',
      'select_job_type',
      'finalize_answer',
    ]);
    expect(toolNames).not.toContain('list_dir');
    expect(toolNames).not.toContain('git_status');
    expect(toolNames).not.toContain('git_diff');
    expect(toolNames).not.toContain('run_verification');
  });

  it('resolves blueprint references from app blueprint routing', () => {
    const documents = resolveSupervisorSkillDocuments({
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
    const paths = documents.map((document) => document.relativePath);

    expect(paths).toContain('SKILL.md');
    expect(paths).toContain('references/router.md');
    expect(paths).toContain('references/phases/plan.md');
    expect(paths).toContain('references/modes/planning.md');
    expect(paths).toContain('references/modes/review.md');
    expect(paths).toContain('references/work_kinds/blueprint.md');
    expect(paths).toContain('references/work_kinds/ui_ux.md');
    expect(paths).toContain('references/overlays/user_facing_change.md');
  });

  it('ignores unknown nextSkillFiles while allowing known extra references', () => {
    const documents = resolveSupervisorSkillDocuments({
      primaryMode: 'general_answer',
      secondaryModes: [],
      phase: 'answer',
      workKinds: [],
      overlays: [],
      requiredEvidence: [],
      nextSkillFiles: ['../../secret.md', 'references/overlays/security.md'],
      confidence: 0.6,
    });
    const paths = documents.map((document) => document.relativePath);

    expect(paths).toContain('references/overlays/security.md');
    expect(paths).not.toContain('../../secret.md');
  });

  it('rejects configured directories that do not provide the full markdown set', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'supervisor-skills-'));
    writeFileSync(
      path.join(directory, 'SKILL.md'),
      [
        '# Root',
        '',
        '## Use When',
        'Test.',
        '',
        '## Required Behavior',
        'Test.',
        '',
        '## Stop Conditions',
        'Test.',
        '',
        '## Report Contract',
        'Test.',
      ].join('\n')
    );

    clearSupervisorSkillDocumentCache();
    expect(() => listSupervisorSkillDocuments(directory)).toThrow(
      /Supervisor skill markdown missing/
    );
  });
});

describe('Supervisor flat skill tools', () => {
  it('reads a flat skill as a compact summary with a digest', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'nightworkers-skill-tools-'));
    await fs.writeFile(
      path.join(directory, 'minor_code_edit.md'),
      [
        '# minor_code_edit',
        '',
        '## Use When',
        '小さい変更タスク。',
        '',
        '## Procedure',
        '1. read_file で対象を確認する。',
        '2. apply_patch で変更する。',
        '',
        '## Completion',
        'tool result がない作業を実行済みと書かない。',
        '',
        '## Output',
        'Always return only JSON.',
        '',
      ].join('\n')
    );

    try {
      const skill = readSupervisorSkill({
        jobType: 'minor_code_edit',
        loadedAtStep: 3,
        directory,
      });

      expect(skill).toEqual({
        jobType: 'minor_code_edit',
        path: 'skills/minor_code_edit.md',
        digest: expect.stringMatching(/^sha256:/),
        loadedAtStep: 3,
        summary: {
          useWhen: '小さい変更タスク。',
          procedure: ['read_file で対象を確認する。', 'apply_patch で変更する。'],
          requiredRules: [
            'tool result がない作業を実行済みと書かない。',
            'Always return only JSON.',
          ],
        },
      });
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it('searches available flat skills by deterministic text matching', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'nightworkers-skill-search-'));
    await fs.writeFile(
      path.join(directory, 'minor_code_edit.md'),
      ['# minor_code_edit', '', '## Use When', 'small target path known code edit'].join('\n')
    );
    await fs.writeFile(
      path.join(directory, 'review.md'),
      ['# review', '', '## Use When', 'diff review findings'].join('\n')
    );

    try {
      const result = searchSupervisorSkills({
        query: 'small code edit',
        maxResults: 5,
        directory,
      });

      expect(result.matches[0]).toMatchObject({
        jobType: 'minor_code_edit',
        path: 'skills/minor_code_edit.md',
        score: 3,
        summary: 'small target path known code edit',
      });
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
