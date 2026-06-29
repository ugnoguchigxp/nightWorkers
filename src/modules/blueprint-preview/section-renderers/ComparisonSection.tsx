import { PreviewBadge, PreviewCard } from '../BlueprintPreviewPrimitives';
import { toObjectArray } from '../previewModel';
import type { SectionRendererInput } from './types';

export function renderComparisonSection({ componentName, props, t }: SectionRendererInput) {
  const options = toObjectArray(props.options || props.items || props.cards);
  const columns =
    options.length > 0
      ? options
      : [
          {
            title: 'Current',
            badge: 'stable',
            points: ['Known flow', 'Lower risk', 'Limited automation'],
          },
          {
            title: 'Proposed',
            badge: 'recommended',
            points: ['Clear review path', 'Better traceability', 'More setup'],
          },
        ];
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {columns.slice(0, 3).map((option, index) => {
        const points = Array.isArray(option.points)
          ? option.points.map(String)
          : [
              String(option.description || option.body || 'Primary tradeoff'),
              String(option.value || option.cost || 'Secondary signal'),
            ];
        return (
          <PreviewCard className="grid gap-3 p-3" key={String(option.id || option.title || index)}>
            <div className="flex items-start justify-between gap-2">
              <div className="text-sm font-semibold text-foreground">
                {String(option.title || option.label || `Option ${index + 1}`)}
              </div>
              <PreviewBadge tone={index === 1 ? 'primary' : 'default'} className="text-[10px]">
                {String(option.badge || option.status || (index === 1 ? 'target' : 'base'))}
              </PreviewBadge>
            </div>
            <div className="grid gap-2">
              {points.slice(0, 4).map((point, pointIndex) => (
                <div className="flex gap-2 text-[11px] leading-5" key={`${point}-${pointIndex}`}>
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  <span className="text-muted-foreground">{point}</span>
                </div>
              ))}
            </div>
          </PreviewCard>
        );
      })}
    </div>
  );
}
