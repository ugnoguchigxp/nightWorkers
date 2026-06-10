import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { blueprintCatalog } from '../api/services/blueprint-catalog';
import {
  buildPlanModeBlueprintRequestContract,
  parseAndValidateBlueprintOutput,
} from '../api/services/blueprints/llm-draft';
import { validateAppBlueprint } from '../api/services/blueprints/validation';
import { representativeAppBlueprint } from './fixtures/app-blueprint';
import { canonicalBadAppBlueprint } from './fixtures/bad-app-blueprint';

describe('Blueprint validation service', () => {
  it('keeps regular Blueprint generation request contract separate from DB Design', () => {
    const contract = buildPlanModeBlueprintRequestContract({
      taskId: 'task-blueprint-contract',
      title: 'Kanban preview',
      prompt: 'カード管理の完成イメージを見たい',
    });

    expect(contract).toMatchObject({
      schemaName: 'app_blueprint',
      requiredArtifact: 'AppBlueprint JSON',
      regularBlueprintDataContract: {
        databaseSchema: { tables: [], relations: [] },
        dataBindings: [],
        sectionDataBindingId: 'forbidden',
        dbDesignWorkflowOnly: true,
      },
      userRequest: {
        taskId: 'task-blueprint-contract',
        title: 'Kanban preview',
        userRequest: 'カード管理の完成イメージを見たい',
        requiredArtifact: 'AppBlueprint JSON',
      },
    });
    expect(contract.referenceDocuments.map((document) => document.relativePath)).toContain(
      'references/work_kinds/blueprint.md'
    );
  });

  it('documents the regular Blueprint and DB Design boundary in the work-kind reference', () => {
    const reference = readFileSync(
      join(
        process.cwd(),
        'api/services/supervisor/skills/builtin/references/work_kinds/blueprint.md'
      ),
      'utf8'
    );

    expect(reference).toContain('通常 Blueprint では `databaseSchema.tables`');
    expect(reference).toContain('DB Design workflow');
    expect(reference).toContain('`dataBindings`');
  });

  it('parses fenced Blueprint JSON through shared repair and keeps regular Blueprint data empty', () => {
    const regularBlueprint = {
      ...representativeAppBlueprint,
      databaseSchema: { tables: [], relations: [] },
      dataBindings: [],
      screens: [
        {
          ...representativeAppBlueprint.screens[0],
          sections: [
            {
              id: 'priority-signals',
              name: 'Priority Signals',
              componentName: 'StatsTrendCardsSection',
              source: 'static',
              props: {
                title: 'Priority Signals',
                description: 'Shows sample operational cues before data design exists.',
                items: [{ label: 'Ready to review', value: '12' }],
              },
              actions: [],
            },
          ],
        },
      ],
    };

    const parsed = parseAndValidateBlueprintOutput(
      `Here is the JSON:\n\n\`\`\`json\n${JSON.stringify(regularBlueprint)}\n\`\`\``
    );

    expect(parsed.jsonRepair).toEqual({
      repaired: true,
      repairKind: 'extracted_candidate',
    });
    expect(parsed.blueprint.databaseSchema).toEqual({ tables: [], relations: [] });
    expect(parsed.blueprint.dataBindings).toEqual([]);
    expect(parsed.validation.valid).toBe(true);
  });

  it('repairs misplaced root actions from LLM Blueprint JSON output', () => {
    const regularBlueprint = {
      ...representativeAppBlueprint,
      databaseSchema: { tables: [], relations: [] },
      dataBindings: [],
    };
    const malformedBlueprint = JSON.stringify(regularBlueprint).replace(
      ',"databaseSchema"',
      ',"actions":[{"id":"create-card-global","label":"カード追加","type":"open","target":"board-card-form"}]}],"databaseSchema"'
    );

    const parsed = parseAndValidateBlueprintOutput(malformedBlueprint);

    expect(parsed.blueprint.databaseSchema).toEqual({ tables: [], relations: [] });
    expect(parsed.blueprint.dataBindings).toEqual([]);
    expect(parsed.validation.valid).toBe(true);
  });

  it('unwraps Codex-delimited Blueprint arrays before schema validation', () => {
    const regularBlueprint = {
      ...representativeAppBlueprint,
      databaseSchema: { tables: [], relations: [] },
      dataBindings: [],
    };
    const { databaseSchema, dataBindings, implementationTasks, learningHooks, ...head } =
      regularBlueprint;
    const delimitedOutput = JSON.stringify([
      head,
      'databaseSchema',
      ':',
      databaseSchema,
      'dataBindings',
      ':',
      dataBindings,
      'implementationTasks',
      ':',
      implementationTasks,
      'learningHooks',
      ':',
      learningHooks,
    ]);

    const parsed = parseAndValidateBlueprintOutput(delimitedOutput);

    expect(parsed.blueprint.databaseSchema).toEqual({ tables: [], relations: [] });
    expect(parsed.blueprint.dataBindings).toEqual([]);
    expect(parsed.blueprint.implementationTasks).toEqual(implementationTasks);
    expect(parsed.validation.valid).toBe(true);
  });

  it('adds stable ids to LLM section actions before Blueprint schema validation', () => {
    const regularBlueprint = {
      ...representativeAppBlueprint,
      databaseSchema: { tables: [], relations: [] },
      dataBindings: [],
      screens: [
        {
          ...representativeAppBlueprint.screens[0],
          sections: [
            {
              id: 'quick-actions',
              name: 'Quick Actions',
              componentName: 'QuickActionsSection',
              source: 'static',
              props: {
                title: 'Quick Actions',
                actions: [{ label: 'Create Card', type: 'open', target: 'create-card' }],
              },
              actions: [{ label: 'Create Card', type: 'open', target: 'create-card' }],
            },
          ],
        },
      ],
    };

    const parsed = parseAndValidateBlueprintOutput(JSON.stringify(regularBlueprint));

    expect(parsed.blueprint.screens[0]?.sections[0]?.actions[0]?.id).toBe('quick-actions-action-1');
    expect(parsed.validation.valid).toBe(true);
  });

  it('normalizes invalid regular Blueprint section sources before validation', () => {
    const regularBlueprint = {
      ...representativeAppBlueprint,
      databaseSchema: { tables: [], relations: [] },
      dataBindings: [],
      screens: [
        {
          ...representativeAppBlueprint.screens[0],
          sections: [
            {
              id: 'card-form',
              name: 'Card Form',
              componentName: 'FormSection',
              source: 'static',
              props: {
                title: 'Card Form',
                fields: [{ name: 'title', label: 'Title', type: 'text' }],
              },
              actions: [],
            },
          ],
        },
      ],
    };

    const parsed = parseAndValidateBlueprintOutput(JSON.stringify(regularBlueprint));

    expect(parsed.blueprint.screens[0]?.sections[0]?.source).toBe('app');
    expect(parsed.validation.valid).toBe(true);
  });

  it('normalizes section components accidentally used as regular Blueprint screens', () => {
    const regularBlueprint = {
      ...representativeAppBlueprint,
      databaseSchema: { tables: [], relations: [] },
      dataBindings: [],
      screens: [
        {
          id: 'board-empty',
          name: 'Empty Board State',
          path: '/boards/empty',
          componentName: 'EmptyState',
          sections: [
            {
              id: 'empty-board',
              name: 'Empty Board',
              componentName: 'EmptyState',
              source: 'none',
              props: {
                title: 'Empty Board',
                description: 'No cards have been created yet.',
              },
              actions: [],
            },
          ],
          actions: [],
        },
      ],
    };

    const parsed = parseAndValidateBlueprintOutput(JSON.stringify(regularBlueprint));

    expect(parsed.blueprint.screens[0]?.componentName).toBe('SidebarPage');
    expect(parsed.blueprint.screens[0]?.sections[0]?.componentName).toBe('EmptyState');
    expect(parsed.validation.valid).toBe(true);
  });

  it('still fails validation after repair when Blueprint contracts are violated', () => {
    const invalidBlueprint = {
      ...representativeAppBlueprint,
      screens: [],
    };

    expect(() =>
      parseAndValidateBlueprintOutput(`\`\`\`json\n${JSON.stringify(invalidBlueprint)}\n\`\`\``)
    ).toThrow(/valid JSON|failed validation/);
  });

  it('accepts a representative valid blueprint', () => {
    const result = validateAppBlueprint(representativeAppBlueprint);

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('reports missing section bindings with stable paths', () => {
    const result = validateAppBlueprint({
      ...representativeAppBlueprint,
      screens: [
        {
          ...representativeAppBlueprint.screens[0],
          sections: [
            {
              ...representativeAppBlueprint.screens[0]?.sections[0],
              dataBindingId: 'missing-binding',
            },
          ],
        },
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'screens.0.sections.0.dataBindingId',
          code: 'missing_binding',
        }),
      ])
    );
  });

  it('reports binding fields that are not present on the target table', () => {
    const result = validateAppBlueprint({
      ...representativeAppBlueprint,
      dataBindings: [
        {
          ...representativeAppBlueprint.dataBindings[0],
          fields: ['id', 'missing-field'],
        },
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'dataBindings.0.fields.1',
          code: 'missing_field',
        }),
      ])
    );
  });

  it('reports component source mismatches', () => {
    const result = validateAppBlueprint({
      ...representativeAppBlueprint,
      screens: [
        {
          ...representativeAppBlueprint.screens[0],
          sections: [
            {
              ...representativeAppBlueprint.screens[0]?.sections[0],
              componentName: 'EmptyState',
              source: 'table',
            },
          ],
        },
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'screens.0.sections.0.source',
          code: 'invalid_component_source',
        }),
      ])
    );
  });

  it('reports unknown component ids as stable schema evidence', () => {
    const result = validateAppBlueprint({
      ...representativeAppBlueprint,
      screens: [
        {
          ...representativeAppBlueprint.screens[0],
          componentName: 'MissingPageComponent',
        },
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'screens.0.componentName',
          code: 'schema_invalid',
        }),
      ])
    );
  });

  it('produces canonical bad blueprint evidence for recovery demos', () => {
    const result = validateAppBlueprint(canonicalBadAppBlueprint);

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'screens',
          code: 'duplicate_id',
        }),
        expect.objectContaining({
          path: 'screens.0.componentName',
          code: 'invalid_component_placement',
        }),
        expect.objectContaining({
          path: 'screens.0.sections',
          code: 'duplicate_id',
        }),
        expect.objectContaining({
          path: 'screens.0.sections.0.dataBindingId',
          code: 'missing_binding',
        }),
        expect.objectContaining({
          path: 'screens.0.sections.1.componentName',
          code: 'invalid_component_placement',
        }),
        expect.objectContaining({
          path: 'dataBindings.0.table',
          code: 'missing_table',
        }),
        expect.objectContaining({
          path: 'dataBindings.1.fields.1',
          code: 'missing_field',
        }),
        expect.objectContaining({
          path: 'databaseSchema.relations.0.fromColumn',
          code: 'invalid_relation',
        }),
        expect.objectContaining({
          path: 'databaseSchema.relations.0.toTable',
          code: 'invalid_relation',
        }),
      ])
    );
    expect(result.issues.map((issue) => issue.path)).toEqual(
      [...result.issues.map((issue) => issue.path)].sort((a, b) => a.localeCompare(b))
    );
  });

  it('accepts static design props for presentational blueprint sections', () => {
    const result = validateAppBlueprint({
      ...representativeAppBlueprint,
      screens: [
        {
          ...representativeAppBlueprint.screens[0],
          sections: [
            {
              id: 'trust-section',
              name: 'Trust Signals',
              componentName: 'StatsTrendCardsSection',
              source: 'static',
              props: {
                title: 'Trust Signals',
                items: [
                  { label: 'Free shipping', value: '5,000円以上' },
                  { label: 'Fast dispatch', value: '14時まで' },
                ],
              },
              actions: [],
            },
            {
              id: 'help-panel',
              name: 'Purchase Support',
              componentName: 'InsightPanel',
              source: 'static',
              props: {
                title: 'Purchase Support',
                description: 'Clarifies delivery, returns, and payment reassurance.',
              },
              actions: [],
            },
          ],
        },
      ],
    });

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('accepts preset and custom section composition without legacy component validation', () => {
    const result = validateAppBlueprint({
      ...representativeAppBlueprint,
      databaseSchema: { tables: [], relations: [] },
      dataBindings: [],
      screens: [
        {
          ...representativeAppBlueprint.screens[0],
          sections: [
            {
              kind: 'preset_section',
              id: 'customers-search',
              preset: 'search_header',
              props: {
                title: 'Customers',
                placeholder: 'Search customers...',
              },
              overrides: [
                {
                  target: 'searchInput',
                  set: { layout: { width: '1/2' } },
                },
                {
                  target: 'actions',
                  insert: {
                    kind: 'component',
                    id: 'add-customer',
                    component: 'Button',
                    props: { label: 'Add customer' },
                  },
                },
              ],
            },
            {
              kind: 'custom_section',
              id: 'operations-overview',
              root: {
                kind: 'layout',
                layout: 'grid',
                props: { columns: 2 },
                children: [
                  {
                    kind: 'component',
                    id: 'open-incidents',
                    component: 'Card',
                    props: { title: 'Open incidents' },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('includes Composia-derived component variants in the Blueprint catalog', () => {
    const catalogNames = new Set(blueprintCatalog.map((definition) => definition.name));

    expect([...catalogNames]).toEqual(
      expect.arrayContaining([
        'ChartSection',
        'ChartInsightSection',
        'ProgressListSection',
        'KanbanSection',
        'CalendarSection',
        'ScheduleSection',
        'HoldingsListSection',
        'ControlPanelSection',
        'StatsTrendCardsSection',
        'ActivityFeedSection',
        'NotificationCenterSection',
        'QuickActionsSection',
        'CheckoutSummarySection',
        'ChatPanelSection',
        'EditorPreviewSection',
        'MainSearchNavigationSection',
      ])
    );
    expect(
      blueprintCatalog.find((definition) => definition.name === 'ChartSection')?.variants
    ).toEqual(['bar', 'line', 'area', 'pie', 'radar']);
    expect(
      blueprintCatalog.find((definition) => definition.name === 'KanbanSection')?.variants
    ).toEqual(['kanban-board']);
  });
});
