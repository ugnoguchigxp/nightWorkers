import { describe, expect, it } from 'vitest';
import {
  blueprintDbDesignRequestSchema,
  parseBlueprintDbDesignRequestPrompt,
} from '../api/services/blueprints/data-design';
import { buildBlueprintDbDesignPrompt } from '../src/modules/nightworkers/components/blueprint-preview/dbDesignModel';
import { representativeAppBlueprint } from './fixtures/app-blueprint';

describe('Blueprint data-design service helpers', () => {
  it('parses the structured DB Design request embedded in a workbench prompt', () => {
    const prompt = buildBlueprintDbDesignPrompt({
      blueprintId: representativeAppBlueprint.id,
      currentBlueprint: representativeAppBlueprint as unknown as Record<string, unknown>,
      prompt: 'ステータス履歴を設計してください',
      target: { kind: 'table', tableName: 'decision-items' },
      validationIssues: [],
    });

    const parsed = parseBlueprintDbDesignRequestPrompt(prompt);

    expect(parsed.target).toEqual({ kind: 'table', tableName: 'decision-items' });
    expect(parsed.currentBlueprint.id).toBe(representativeAppBlueprint.id);
    expect(parsed.prompt).toBe('ステータス履歴を設計してください');
  });

  it('rejects requests that do not carry an AppBlueprint-shaped current state', () => {
    expect(() =>
      blueprintDbDesignRequestSchema.parse({
        blueprintId: representativeAppBlueprint.id,
        currentBlueprint: {
          ...representativeAppBlueprint,
          screens: [],
        },
        prompt: 'currentBlueprint は完全な AppBlueprint が必要',
        target: { kind: 'schema' },
        validationIssues: [],
      })
    ).toThrow();
  });
});
