import { describe, expect, it } from 'vitest';
import { appBlueprintSchema } from '../shared/schemas/app-blueprint.schema';
import {
  blueprintNodeSchema,
  blueprintSectionOverrideSchema,
  blueprintSectionPatchSchema,
} from '../shared/schemas/app-blueprint-ui.schema';
import { blueprintComponentNameSchema } from '../shared/schemas/blueprint-catalog.schema';
import { representativeAppBlueprint } from './fixtures/app-blueprint';

describe('App Blueprint schemas', () => {
  it('accepts a representative valid blueprint', () => {
    const parsed = appBlueprintSchema.parse(representativeAppBlueprint);

    expect(parsed.name).toBe('Operations Console');
    expect(parsed.screens[0]?.sections).toHaveLength(2);
  });

  it('rejects unsafe screen paths', () => {
    expect(() =>
      appBlueprintSchema.parse({
        ...representativeAppBlueprint,
        screens: [{ ...representativeAppBlueprint.screens[0], path: 'https://example.com' }],
      })
    ).toThrow();
  });

  it('rejects low-level component names', () => {
    expect(() => blueprintComponentNameSchema.parse('Button')).toThrow();
  });

  it('requires explicit component section kind for catalog sections', () => {
    expect(() =>
      appBlueprintSchema.parse({
        ...representativeAppBlueprint,
        screens: [
          {
            ...representativeAppBlueprint.screens[0],
            sections: [
              {
                id: 'missing-kind',
                name: 'Missing Kind',
                componentName: 'DataTableSection',
                source: 'table',
                props: {},
                actions: [],
              },
            ],
          },
        ],
      })
    ).toThrow();
  });

  it('accepts preset and custom section composition contracts', () => {
    const parsed = appBlueprintSchema.parse({
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
                    props: { label: 'Add customer', variant: 'default' },
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
                    props: { title: 'Open incidents', description: 'Needs attention' },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(parsed.screens[0]?.sections[0]?.kind).toBe('preset_section');
    expect(parsed.screens[0]?.sections[1]?.kind).toBe('custom_section');
  });

  it('accepts screen layout and section regions for page-level composition', () => {
    const parsed = appBlueprintSchema.parse({
      ...representativeAppBlueprint,
      screens: [
        {
          ...representativeAppBlueprint.screens[0],
          layout: {
            template: 'three_column',
            mainMaxWidth: 'wide',
          },
          sections: [
            {
              ...representativeAppBlueprint.screens[0].sections[0],
              region: 'header',
              id: 'top-menu',
              componentName: 'TopMenuSection',
              source: 'navigation',
            },
            {
              ...representativeAppBlueprint.screens[0].sections[1],
              region: 'main',
            },
            {
              kind: 'component_section',
              id: 'related-links',
              name: 'Related Links',
              componentName: 'RightSidebarLinksSection',
              region: 'aside',
              source: 'navigation',
              props: { links: [{ label: 'Docs', href: '/docs' }] },
              actions: [],
            },
          ],
        },
      ],
    });

    expect(parsed.screens[0]?.layout?.template).toBe('three_column');
    expect(parsed.screens[0]?.sections[0]?.region).toBe('header');
  });

  it('allows low-level components only inside Blueprint nodes', () => {
    expect(
      blueprintNodeSchema.parse({
        kind: 'component',
        id: 'primary-action',
        component: 'Button',
        props: { label: 'Create' },
      }).component
    ).toBe('Button');
  });

  it('accepts the section patch refinement contract', () => {
    const patch = blueprintSectionPatchSchema.parse({
      op: 'insert',
      target: 'actions',
      node: {
        kind: 'component',
        id: 'add-customer',
        component: 'Button',
        props: { label: 'Add customer' },
      },
    });

    expect(patch.position).toBe('end');
  });

  it('rejects no-op section overrides', () => {
    expect(() =>
      blueprintSectionOverrideSchema.parse({
        target: 'searchInput',
      })
    ).toThrow(/Override must define/);
  });

  it('accepts the Composia-derived catalog component vocabulary', () => {
    const composiaDerivedComponents = [
      'EntityListPage',
      'EntityDetailPage',
      'EditableFormPage',
      'ArticleFeedPage',
      'SidebarPage',
      'ChartSection',
      'ImageSection',
      'VideoSection',
      'BlogPostSection',
      'MediaTextSection',
      'SplitHeroSection',
      'FullBleedHeroSection',
      'CarouselSection',
      'KanbanSection',
      'CalendarSection',
      'ScheduleSection',
      'MapSection',
      'AccordionSection',
      'ControlPanelSection',
      'NotificationCenterSection',
      'CheckoutSummarySection',
      'PaymentFormSection',
      'EmailInboxSection',
      'AnalyticsDashboardSection',
      'ChatPanelSection',
      'CodeEditorSection',
      'TopMenuSection',
      'TabNavigationSection',
      'SidebarMenuSection',
      'LeftSidebarSection',
      'ExplorerSidebarSection',
      'RightSidebarLinksSection',
      'FooterNavigationSection',
    ];

    for (const component of composiaDerivedComponents) {
      expect(blueprintComponentNameSchema.parse(component)).toBe(component);
    }
  });
});
