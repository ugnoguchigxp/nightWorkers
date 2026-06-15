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
  normalizeBlueprintSectionForPreview,
} from '../shared/blueprint-section-composition';
import type {
  ComponentBlueprintSection,
  CustomBlueprintSection,
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

  it('does not copy section descriptions into preset body components', () => {
    const labels = {
      searchPlaceholder: 'Search...',
      primarySignal: 'Primary',
      secondarySignal: 'Secondary',
      nextAction: 'Next',
    };
    const description = 'Section-level description should not repeat in the body.';

    const tableRoot = createPresetBlueprintNodeTree({
      preset: 'table_workspace',
      sectionId: 'todos',
      sectionName: 'Todo の一覧',
      props: { title: 'Todo の一覧', description },
      labels,
    });

    expect(tableRoot.children?.[0]?.children?.[0]?.props).toEqual({ title: 'Todo の一覧' });
  });

  it('keeps component sections as component sections for the current renderer', () => {
    const section: ComponentBlueprintSection = {
      kind: 'component_section',
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
    const blueprint = {
      ...representativeAppBlueprint,
      screens: [
        {
          ...representativeAppBlueprint.screens[0],
          sections: [
            {
              kind: 'preset_section',
              id: 'decision-workspace',
              preset: 'table_workspace',
              props: { title: 'Decision Queue' },
              overrides: [],
              actions: [],
            } satisfies PresetBlueprintSection,
          ],
        },
      ],
    };
    const patched = applyBlueprintSectionPatchesToBlueprint(blueprint, {
      screenId: blueprint.screens[0].id,
      sectionId: blueprint.screens[0].sections[0].id,
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

    expect(patched.screens[0].sections[0].kind).toBe('preset_section');
    expect(patched.screens[0].sections[0].overrides).toHaveLength(1);
  });
});
