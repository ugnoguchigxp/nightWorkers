import { describe, expect, it } from 'vitest';
import {
  listBuiltinProcedures,
  parseProcedureMarkdown,
  selectProcedureForTaskType,
  toProcedureSnapshot,
} from '../api/services/procedures';

describe('Procedure registry', () => {
  it('loads built-in procedures as safe data with stable snapshots', async () => {
    const procedures = await listBuiltinProcedures();
    const codeChange = procedures.find((procedure) => procedure.id === 'code-change');

    expect(procedures.length).toBeGreaterThanOrEqual(6);
    expect(codeChange).toBeDefined();
    expect(codeChange?.taskTypes).toContain('code_change');
    expect(codeChange?.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(codeChange?.sections['Completion Gate']).toContain('repository diff');

    const snapshot = toProcedureSnapshot(codeChange!);
    expect(snapshot).toMatchObject({
      source: 'builtin',
      id: 'code-change',
      version: 1,
      digest: codeChange?.digest,
    });
  });

  it('selects procedures by task type and falls back to investigation', async () => {
    await expect(selectProcedureForTaskType('code_change')).resolves.toMatchObject({
      id: 'code-change',
    });
    await expect(selectProcedureForTaskType('test_change')).resolves.toMatchObject({
      id: 'test-change',
    });
    await expect(selectProcedureForTaskType('unknown')).resolves.toMatchObject({
      id: 'investigation',
    });
  });

  it('rejects markdown missing required safe-data sections', () => {
    expect(() =>
      parseProcedureMarkdown(`---
id: broken
taskTypes: [code_change]
priority: 1
---

# Broken

## Use When

Missing the rest.
`)
    ).toThrow(/missing section/i);
  });
});
