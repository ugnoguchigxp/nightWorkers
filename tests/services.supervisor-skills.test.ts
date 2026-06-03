import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  clearSupervisorSkillDocumentCache,
  listSupervisorSkillDocuments,
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
