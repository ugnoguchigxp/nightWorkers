import { describe, expect, it } from 'vitest';
import {
  blueprintDbDesignRequestSchema,
  parseAndValidateBlueprintDataDesignOutput,
  parseBlueprintDbDesignRequestPrompt,
} from '../api/services/blueprints/data-design';
import { buildBlueprintDbDesignPrompt } from '../src/modules/nightworkers/components/blueprint-preview/dbDesignModel';
import { representativeAppBlueprint } from './fixtures/app-blueprint';

describe('Blueprint data-design service helpers', () => {
  it('parses fenced DB Design Blueprint JSON through shared repair', () => {
    const parsed = parseAndValidateBlueprintDataDesignOutput(
      `\`\`\`json\n${JSON.stringify(representativeAppBlueprint)}\n\`\`\``
    );

    expect(parsed.jsonRepair).toEqual({
      repaired: true,
      repairKind: 'extracted_candidate',
    });
    expect(parsed.blueprint.databaseSchema.tables.length).toBeGreaterThan(0);
    expect(parsed.blueprint.dataBindings).toEqual([]);
    expect(parsed.validation.valid).toBe(true);
  });

  it('repairs common DB Design JSON syntax drift before validation', () => {
    const raw = JSON.stringify(representativeAppBlueprint)
      .replace('"id"', 'id')
      .replace('"name"', 'name')
      .replace('"bp-fixture"', "'bp-fixture'")
      .replace(/"learningHooks":\[\]/, '"learningHooks":[] ,');

    const parsed = parseAndValidateBlueprintDataDesignOutput(raw);

    expect(parsed.jsonRepair).toMatchObject({
      repaired: true,
      repairKind: 'jsonrepair',
    });
    expect(parsed.blueprint.id).toBe(representativeAppBlueprint.id);
    expect(parsed.blueprint.dataBindings).toEqual([]);
    expect(parsed.validation.valid).toBe(true);
  });

  it('drops DB Design bindings and section dataBindingId values before validation', () => {
    const blueprintWithBindings = {
      ...representativeAppBlueprint,
      dataBindings: [
        {
          id: 'stale-binding',
          name: 'Stale Binding',
          table: 'missing-table',
          mode: 'list',
          fields: ['missing-field'],
          filters: [],
          sort: [],
        },
      ],
      screens: [
        {
          ...representativeAppBlueprint.screens[0],
          sections: [
            {
              ...representativeAppBlueprint.screens[0].sections[0],
              dataBindingId: 'stale-binding',
            },
          ],
        },
      ],
    };

    const parsed = parseAndValidateBlueprintDataDesignOutput(JSON.stringify(blueprintWithBindings));

    expect(parsed.blueprint.dataBindings).toEqual([]);
    expect(parsed.blueprint.screens[0]?.sections[0]?.dataBindingId).toBeUndefined();
    expect(parsed.validation.valid).toBe(true);
  });

  it('accepts snake_case DB table, column, relation, and index identifiers', () => {
    const dbDesignBlueprint = {
      ...representativeAppBlueprint,
      databaseSchema: {
        tables: [
          {
            name: 'todo_events',
            label: 'Todo Events',
            columns: [
              { name: 'id', type: 'string', nullable: false, primaryKey: true, unique: true },
              {
                name: 'todo_id',
                type: 'string',
                nullable: false,
                primaryKey: false,
                unique: false,
              },
              {
                name: 'occurred_at',
                type: 'datetime',
                nullable: false,
                primaryKey: false,
                unique: false,
              },
            ],
            indexes: [['todo_id', 'occurred_at']],
          },
        ],
        relations: [
          {
            id: 'todo_events_todo',
            fromTable: 'todo_events',
            fromColumn: 'todo_id',
            toTable: 'todo_events',
            toColumn: 'id',
            cardinality: 'many_to_one',
          },
        ],
      },
      dataBindings: [],
    };

    const parsed = parseAndValidateBlueprintDataDesignOutput(JSON.stringify(dbDesignBlueprint));

    expect(parsed.blueprint.databaseSchema.tables[0]?.name).toBe('todo_events');
    expect(parsed.validation.valid).toBe(true);
  });

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
