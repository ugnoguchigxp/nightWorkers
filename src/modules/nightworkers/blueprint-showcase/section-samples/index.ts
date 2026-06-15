import type { BlueprintComponentName } from '../../../../../shared/schemas/blueprint-catalog.schema';
import { accordionSectionSample } from './accordionSection';
import { analyticsDashboardSectionSample } from './analyticsDashboardSection';
import { calendarSectionSample } from './calendarSection';
import { cardGridSectionSample } from './cardGridSection';
import { carouselSectionSample } from './carouselSection';
import { chartSectionSample } from './chartSection';
import { chatPanelSectionSample } from './chatPanelSection';
import { checkoutSummarySectionSample } from './checkoutSummarySection';
import { codeEditorSectionSample } from './codeEditorSection';
import { comparisonSectionSample } from './comparisonSection';
import { controlPanelSectionSample } from './controlPanelSection';
import { dataTableSectionSample } from './dataTableSection';
import { emailInboxSectionSample } from './emailInboxSection';
import { explorerSidebarSectionSample } from './explorerSidebarSection';
import { footerNavigationSectionSample } from './footerNavigationSection';
import { formSectionSample } from './formSection';
import { fullBleedHeroSectionSample } from './fullBleedHeroSection';
import { imageSectionSample } from './imageSection';
import { kanbanSectionSample } from './kanbanSection';
import { leftSidebarSectionSample } from './leftSidebarSection';
import { mapSectionSample } from './mapSection';
import { notificationCenterSectionSample } from './notificationCenterSection';
import { paymentFormSectionSample } from './paymentFormSection';
import { rightSidebarLinksSectionSample } from './rightSidebarLinksSection';
import { scheduleSectionSample } from './scheduleSection';
import { sidebarMenuSectionSample } from './sidebarMenuSection';
import { splitHeroSectionSample } from './splitHeroSection';
import { tabNavigationSectionSample } from './tabNavigationSection';
import { timelineSectionSample } from './timelineSection';
import { topMenuSectionSample } from './topMenuSection';
import type { SectionSampleContext, SectionSampleDefinition } from './types';
import { videoSectionSample } from './videoSection';

const sectionSamples: SectionSampleDefinition[] = [
  chartSectionSample,
  dataTableSectionSample,
  imageSectionSample,
  videoSectionSample,
  splitHeroSectionSample,
  fullBleedHeroSectionSample,
  carouselSectionSample,
  formSectionSample,
  cardGridSectionSample,
  timelineSectionSample,
  kanbanSectionSample,
  calendarSectionSample,
  scheduleSectionSample,
  mapSectionSample,
  accordionSectionSample,
  controlPanelSectionSample,
  notificationCenterSectionSample,
  checkoutSummarySectionSample,
  paymentFormSectionSample,
  emailInboxSectionSample,
  analyticsDashboardSectionSample,
  chatPanelSectionSample,
  codeEditorSectionSample,
  comparisonSectionSample,
  topMenuSectionSample,
  tabNavigationSectionSample,
  sidebarMenuSectionSample,
  leftSidebarSectionSample,
  explorerSidebarSectionSample,
  rightSidebarLinksSectionSample,
  footerNavigationSectionSample,
];

const sectionSampleByName = new Map(sectionSamples.map((sample) => [sample.name, sample]));

export function sampleSectionProps(
  componentName: BlueprintComponentName,
  context: SectionSampleContext
) {
  return sectionSampleByName.get(componentName)?.props(context) || fallbackSectionProps(context);
}

function fallbackSectionProps({ base, sampleCards }: SectionSampleContext) {
  return {
    ...base,
    items: sampleCards(),
    controls: sampleCards(),
    insights: sampleCards(),
  };
}
