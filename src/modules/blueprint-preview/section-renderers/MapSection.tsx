import { toObjectArray } from '../previewModel';
import type { SectionRendererInput } from './types';

export function renderMapSection({ componentName, props, t }: SectionRendererInput) {
  const locations = toObjectArray(props.locations || props.markers || props.items);
  const markers =
    locations.length > 0
      ? locations
      : [
          { title: 'Central station', category: 'Transit', distance: '0.4 km' },
          { title: 'North office', category: 'Workspace', distance: '1.2 km' },
          { title: 'Customer pickup', category: 'Route stop', distance: '2.8 km' },
        ];
  const markerPositions = [
    'left-[58%] top-[34%]',
    'left-[34%] top-[56%]',
    'left-[72%] top-[66%]',
    'left-[22%] top-[30%]',
  ];

  return (
    <div className="grid overflow-hidden rounded-md border border-border bg-card md:grid-cols-[minmax(0,1fr)_13rem]">
      <div className="relative min-h-72 overflow-hidden bg-muted" data-map-state="preview">
        <div className="absolute left-3 right-3 top-3 z-10 flex h-9 items-center rounded-md border border-border bg-card px-3 text-xs text-muted-foreground shadow-sm">
          {String(props.searchPlaceholder || 'Search area or address')}
        </div>
        <div className="absolute inset-0 bg-[linear-gradient(90deg,color-mix(in_srgb,var(--primary)_9%,transparent)_1px,transparent_1px),linear-gradient(0deg,color-mix(in_srgb,var(--primary)_9%,transparent)_1px,transparent_1px)] bg-[size:42px_42px]" />
        <div className="absolute left-[-10%] top-[50%] h-8 w-[120%] rotate-[-16deg] rounded-full border border-border bg-card/80" />
        <div className="absolute left-[18%] top-[-10%] h-[130%] w-8 rotate-[20deg] rounded-full border border-border bg-card/70" />
        <div className="absolute left-[8%] top-[24%] h-7 w-[88%] rotate-[8deg] rounded-full border border-border bg-card/60" />
        <div className="absolute bottom-4 left-4 rounded-md border border-border bg-card px-2 py-1 text-[10px] font-medium text-muted-foreground">
          {String(props.zoomLabel || 'Map preview')}
        </div>
        {markers.slice(0, 4).map((marker, index) => (
          <div
            className={`absolute ${markerPositions[index]} z-10 grid -translate-x-1/2 -translate-y-1/2 place-items-center`}
            key={String(marker.id || marker.title || index)}
          >
            <span
              className="h-5 w-5 rounded-full border-2 border-card bg-primary shadow-md data-[selected=true]:h-6 data-[selected=true]:w-6"
              data-selected={index === 0 ? 'true' : 'false'}
            />
          </div>
        ))}
      </div>
      <div className="grid content-start gap-2 border-border border-t p-3 md:border-t-0 md:border-l">
        <div>
          <div className="text-xs font-semibold text-foreground">
            {String(props.title || 'Nearby locations')}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {String(props.description || `${markers.length} visible markers`)}
          </div>
        </div>
        {markers.slice(0, 4).map((marker, index) => (
          <div
            className="rounded border border-border bg-muted px-2 py-1.5 text-xs"
            data-selected={index === 0 ? 'true' : 'false'}
            key={String(marker.id || marker.title || index)}
          >
            <div className="truncate font-medium text-foreground">
              {String(marker.title || marker.label || marker.name || `Location ${index + 1}`)}
            </div>
            <div className="mt-0.5 flex justify-between gap-2 text-[10px] text-muted-foreground">
              <span className="truncate">{String(marker.category || marker.type || 'Place')}</span>
              <span className="shrink-0">{String(marker.distance || marker.value || '')}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
