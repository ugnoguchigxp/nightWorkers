import { describe, expect, it } from 'vitest';
import { getTemplateImportVerificationGap } from '../api/services/supervisor/supervisor-loop-helpers';

describe('supervisor template import guard', () => {
  it('requires manifest inspection and verification after import_project', () => {
    const imported = [
      {
        step: 1,
        toolName: 'import_project',
        ok: true,
        arguments: { templateId: 'python-standard' },
        summary: 'ok',
      },
    ];

    expect(getTemplateImportVerificationGap(imported)).toContain(
      'before reading package.json or pyproject.toml'
    );
    expect(
      getTemplateImportVerificationGap([
        ...imported,
        {
          step: 2,
          toolName: 'read_file',
          ok: true,
          arguments: { filePath: 'backend/pyproject.toml' },
          summary: 'ok',
        },
      ])
    ).toContain('before running manifest-based verification');
    expect(
      getTemplateImportVerificationGap([
        ...imported,
        {
          step: 2,
          toolName: 'read_file',
          ok: true,
          arguments: { filePath: 'backend/pyproject.toml' },
          summary: 'ok',
        },
        {
          step: 3,
          toolName: 'run_verification',
          ok: true,
          arguments: { command: 'uv run pytest' },
          summary: 'ok',
        },
      ])
    ).toBeNull();
  });
});
