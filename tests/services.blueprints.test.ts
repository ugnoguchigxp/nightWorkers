import { describe, expect, it } from 'vitest';
import { blueprintCatalog } from '../api/services/blueprint-catalog';
import { validateAppBlueprint } from '../api/services/blueprints/validation';
import { representativeAppBlueprint } from './fixtures/app-blueprint';
import { canonicalBadAppBlueprint } from './fixtures/bad-app-blueprint';

describe('Blueprint validation service', () => {
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
  });
});
