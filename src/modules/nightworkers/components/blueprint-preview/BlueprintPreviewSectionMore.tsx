import { renderAccordionSection } from './section-renderers/AccordionSection';
import { renderAnalyticsDashboardSection } from './section-renderers/AnalyticsDashboardSection';
import { renderCalendarSection } from './section-renderers/CalendarSection';
import { renderCardGridSection } from './section-renderers/CardGridSection';
import { renderCarouselSection } from './section-renderers/CarouselSection';
import { renderChartSection } from './section-renderers/ChartSection';
import { renderChatPanelSection } from './section-renderers/ChatPanelSection';
import { renderCheckoutSummarySection } from './section-renderers/CheckoutSummarySection';
import { renderCodeEditorSection } from './section-renderers/CodeEditorSection';
import { renderComparisonSection } from './section-renderers/ComparisonSection';
import { renderControlPanelSection } from './section-renderers/ControlPanelSection';
import { renderDataTableSection } from './section-renderers/DataTableSection';
import { renderEmailInboxSection } from './section-renderers/EmailInboxSection';
import { renderExplorerSidebarSection } from './section-renderers/ExplorerSidebarSection';
import { renderFooterNavigationSection } from './section-renderers/FooterNavigationSection';
import { renderFormSection } from './section-renderers/FormSection';
import { renderFullBleedHeroSection } from './section-renderers/FullBleedHeroSection';
import { renderImageSection } from './section-renderers/ImageSection';
import { renderKanbanSection } from './section-renderers/KanbanSection';
import { renderLeftSidebarSection } from './section-renderers/LeftSidebarSection';
import { renderMapSection } from './section-renderers/MapSection';
import { renderNotificationCenterSection } from './section-renderers/NotificationCenterSection';
import { renderPaymentFormSection } from './section-renderers/PaymentFormSection';
import { renderRightSidebarLinksSection } from './section-renderers/RightSidebarLinksSection';
import { renderScheduleSection } from './section-renderers/ScheduleSection';
import { renderSidebarMenuSection } from './section-renderers/SidebarMenuSection';
import { renderSplitHeroSection } from './section-renderers/SplitHeroSection';
import { renderTabNavigationSection } from './section-renderers/TabNavigationSection';
import { renderTimelineSection } from './section-renderers/TimelineSection';
import { renderTopMenuSection } from './section-renderers/TopMenuSection';
import type { SectionRenderer, SectionRendererInput } from './section-renderers/types';
import { renderVideoSection } from './section-renderers/VideoSection';

const additionalSectionRenderers: Record<string, SectionRenderer> = {
  ChartSection: renderChartSection,
  DataTableSection: renderDataTableSection,
  ImageSection: renderImageSection,
  VideoSection: renderVideoSection,
  SplitHeroSection: renderSplitHeroSection,
  FullBleedHeroSection: renderFullBleedHeroSection,
  CarouselSection: renderCarouselSection,
  FormSection: renderFormSection,
  KanbanSection: renderKanbanSection,
  CardGridSection: renderCardGridSection,
  CalendarSection: renderCalendarSection,
  ScheduleSection: renderScheduleSection,
  MapSection: renderMapSection,
  CheckoutSummarySection: renderCheckoutSummarySection,
  PaymentFormSection: renderPaymentFormSection,
  EmailInboxSection: renderEmailInboxSection,
  AnalyticsDashboardSection: renderAnalyticsDashboardSection,
  TopMenuSection: renderTopMenuSection,
  TabNavigationSection: renderTabNavigationSection,
  SidebarMenuSection: renderSidebarMenuSection,
  LeftSidebarSection: renderLeftSidebarSection,
  ExplorerSidebarSection: renderExplorerSidebarSection,
  RightSidebarLinksSection: renderRightSidebarLinksSection,
  FooterNavigationSection: renderFooterNavigationSection,
  ChatPanelSection: renderChatPanelSection,
  NotificationCenterSection: renderNotificationCenterSection,
  TimelineSection: renderTimelineSection,
  CodeEditorSection: renderCodeEditorSection,
  AccordionSection: renderAccordionSection,
  ComparisonSection: renderComparisonSection,
  ControlPanelSection: renderControlPanelSection,
};

export function renderAdditionalPreviewSectionBody(input: SectionRendererInput) {
  return additionalSectionRenderers[input.componentName]?.(input) || null;
}
