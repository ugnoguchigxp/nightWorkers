import { describe, expect, it } from 'vitest';
import { appBlueprintSchema } from '../shared/schemas/app-blueprint.schema';
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

  it('accepts the Composia-derived catalog component vocabulary', () => {
    const composiaDerivedComponents = [
      'EntityListPage',
      'EntityDetailPage',
      'EditableFormPage',
      'ArticleFeedPage',
      'SidebarPage',
      'ChartSection',
      'ChartInsightSection',
      'ProgressListSection',
      'InsightPanel',
      'ImageSection',
      'SplitHeroSection',
      'CarouselSection',
      'KanbanSection',
      'CalendarSection',
      'ScheduleSection',
      'HoldingsListSection',
      'AccordionSection',
      'ControlPanelSection',
      'StatsTrendCardsSection',
      'ActivityFeedSection',
      'NotificationCenterSection',
      'QuickActionsSection',
      'CheckoutSummarySection',
      'ChatPanelSection',
      'EditorPreviewSection',
      'NavigationPanel',
      'MainSearchNavigationSection',
    ];

    for (const component of composiaDerivedComponents) {
      expect(blueprintComponentNameSchema.parse(component)).toBe(component);
    }
  });
});
