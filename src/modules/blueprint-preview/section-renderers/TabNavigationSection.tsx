import { PreviewCard } from '../BlueprintPreviewPrimitives';
import { navigationTabs } from './navigationHelpers';
import type { SectionRendererInput } from './types';

export function renderTabNavigationSection({ props }: SectionRendererInput) {
  const tabs = navigationTabs(props);
  return (
    <div className="grid gap-3">
      <div className="flex overflow-hidden rounded-md border border-border bg-card p-1">
        {tabs.slice(0, 5).map((tab, index) => (
          <span
            className={`flex-1 rounded px-3 py-2 text-center text-xs font-medium ${
              index === 0 ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
            }`}
            key={`${tab}-${index}`}
          >
            {tab}
          </span>
        ))}
      </div>
      <PreviewCard className="bg-muted p-3">
        <div className="text-xs font-semibold text-foreground">{tabs[0] || 'Overview'}</div>
        <div className="mt-1 text-[11px] leading-5 text-muted-foreground">
          Tab content area for the selected section view.
        </div>
      </PreviewCard>
    </div>
  );
}
