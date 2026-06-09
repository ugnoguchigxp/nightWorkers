import { describe, expect, it } from 'vitest';
import {
  blueprintPreviewComponentCatalog,
  blueprintSectionPresetCatalog,
  createPresetBlueprintNodeTree,
} from '../shared/blueprint-composition-catalog';
import {
  applyBlueprintSectionOverridesToNode,
  applyBlueprintSectionPatch,
  applyBlueprintSectionPatchesToBlueprint,
  blueprintSectionPatchToOverride,
  legacyBlueprintSectionToPreset,
  normalizeBlueprintSectionForPreview,
} from '../shared/blueprint-section-composition';
import type {
  CustomBlueprintSection,
  LegacyBlueprintSection,
  PresetBlueprintSection,
} from '../shared/schemas/app-blueprint-ui.schema';
import { representativeAppBlueprint } from './fixtures/app-blueprint';

describe('Blueprint section composition helpers', () => {
  it('keeps component and preset catalogs aligned with expected composition targets', () => {
    expect(blueprintPreviewComponentCatalog.map((component) => component.name)).toEqual(
      expect.arrayContaining(['Button', 'Input', 'Card', 'DataTable', 'List', 'Alert'])
    );
    expect(blueprintSectionPresetCatalog.map((preset) => preset.name)).toEqual([
      'search_header',
      'table_workspace',
      'metrics_overview',
      'chart_insight',
      'kanban_board',
    ]);
  });

  it('creates stable preset node targets used by overrides', () => {
    const root = createPresetBlueprintNodeTree({
      preset: 'search_header',
      sectionId: 'customers-search',
      props: { title: 'Customers' },
      labels: {
        searchPlaceholder: 'Search...',
        primarySignal: 'Primary',
        secondarySignal: 'Secondary',
        nextAction: 'Next',
      },
    });

    expect(root.children?.[0]?.id).toBe('controls');
    expect(root.children?.[0]?.children?.[0]?.id).toBe('searchInput');
    expect(root.children?.[0]?.children?.[1]?.id).toBe('actions');
  });

  it('adapts legacy search, table, and metric sections to preset sections', () => {
    const cases: Array<
      [LegacyBlueprintSection['componentName'], PresetBlueprintSection['preset']]
    > = [
      ['MainSearchNavigationSection', 'search_header'],
      ['DataTableSection', 'table_workspace'],
      ['StatsTrendCardsSection', 'metrics_overview'],
    ];

    for (const [componentName, preset] of cases) {
      const adapted = legacyBlueprintSectionToPreset({
        id: `${preset}-section`,
        name: preset,
        componentName,
        source: 'static',
        props: { title: preset },
        actions: [],
      });

      expect(adapted?.kind).toBe('preset_section');
      expect(adapted?.preset).toBe(preset);
    }
  });

  it('keeps unsupported legacy sections as legacy for the existing renderer', () => {
    const section: LegacyBlueprintSection = {
      id: 'hero',
      name: 'Hero',
      componentName: 'SplitHeroSection',
      source: 'static',
      props: { title: 'Hero' },
      actions: [],
    };

    expect(normalizeBlueprintSectionForPreview(section)).toBe(section);
  });

  it('converts set patches to preset overrides', () => {
    expect(
      blueprintSectionPatchToOverride({
        op: 'set',
        target: 'searchInput',
        path: 'layout.width',
        value: '1/2',
      })
    ).toEqual({
      target: 'searchInput',
      set: { layout: { width: '1/2' } },
    });
  });

  it('appends patch overrides to preset sections', () => {
    const section: PresetBlueprintSection = {
      kind: 'preset_section',
      id: 'customers-search',
      preset: 'search_header',
      props: { title: 'Customers' },
      overrides: [],
      actions: [],
    };

    const patched = applyBlueprintSectionPatch(section, {
      op: 'insert',
      target: 'actions',
      node: {
        kind: 'component',
        id: 'add-customer',
        component: 'Button',
        props: { label: 'Add customer' },
      },
      position: 'end',
    }) as PresetBlueprintSection;

    expect(patched.overrides).toHaveLength(1);
    expect(patched.overrides[0]?.insert?.id).toBe('add-customer');
  });

  it('preserves insert patch position on preset overrides', () => {
    expect(
      blueprintSectionPatchToOverride({
        op: 'insert',
        target: 'actions',
        position: 'start',
        node: {
          kind: 'component',
          id: 'import-customer',
          component: 'Button',
          props: { label: 'Import' },
        },
      })
    ).toEqual(
      expect.objectContaining({
        target: 'actions',
        position: 'start',
      })
    );
  });

  it('applies preset overrides with before and after positions through the shared node helper', () => {
    const root = createPresetBlueprintNodeTree({
      preset: 'search_header',
      sectionId: 'customers-search',
      props: { title: 'Customers' },
      labels: {
        searchPlaceholder: 'Search...',
        primarySignal: 'Primary',
        secondarySignal: 'Secondary',
        nextAction: 'Next',
      },
    });

    const patched = applyBlueprintSectionOverridesToNode(root, [
      {
        target: 'searchInput',
        position: 'after',
        insert: {
          kind: 'component',
          id: 'quick-filter',
          component: 'Button',
          props: { label: 'Filter' },
        },
      },
    ]);

    expect(patched?.children?.[0]?.children?.map((child) => child.id)).toEqual([
      'searchInput',
      'quick-filter',
      'actions',
    ]);
  });

  it('applies set patches to custom section nodes', () => {
    const section: CustomBlueprintSection = {
      kind: 'custom_section',
      id: 'operations',
      root: {
        kind: 'layout',
        id: 'root',
        layout: 'grid',
        props: {},
        children: [
          {
            kind: 'component',
            id: 'open-incidents',
            component: 'Card',
            props: { title: 'Open incidents' },
            layout: {},
            children: [],
          },
        ],
      },
      actions: [],
    };

    const patched = applyBlueprintSectionPatch(section, {
      op: 'set',
      target: 'open-incidents',
      path: 'props.description',
      value: 'Needs attention',
    }) as CustomBlueprintSection;

    expect(patched.root.children?.[0]?.props?.description).toBe('Needs attention');
  });

  it('applies before and after insert patches to custom section siblings', () => {
    const section: CustomBlueprintSection = {
      kind: 'custom_section',
      id: 'operations',
      root: {
        kind: 'layout',
        id: 'root',
        layout: 'row',
        props: {},
        children: [
          {
            kind: 'component',
            id: 'primary',
            component: 'Card',
            props: { title: 'Primary' },
            layout: {},
            children: [],
          },
        ],
      },
      actions: [],
    };

    const patched = applyBlueprintSectionPatch(section, {
      op: 'insert',
      target: 'primary',
      position: 'before',
      node: {
        kind: 'component',
        id: 'before-primary',
        component: 'Badge',
        props: { label: 'Before' },
      },
    }) as CustomBlueprintSection;

    expect(patched.root.children?.map((child) => child.id)).toEqual(['before-primary', 'primary']);
  });

  it('applies section patches to a blueprint screen', () => {
    const patched = applyBlueprintSectionPatchesToBlueprint(representativeAppBlueprint, {
      screenId: representativeAppBlueprint.screens[0].id,
      sectionId: representativeAppBlueprint.screens[0].sections[1].id,
      patches: [
        {
          op: 'insert',
          target: 'actions',
          node: {
            kind: 'component',
            id: 'new-row',
            component: 'Button',
            props: { label: 'New row' },
          },
        },
      ],
    });

    expect(patched.screens[0].sections[1].kind).toBe('preset_section');
    expect(patched.screens[0].sections[1].overrides).toHaveLength(1);
  });
});
