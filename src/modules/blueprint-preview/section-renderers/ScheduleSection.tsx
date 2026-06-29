import { toObjectArray } from '../previewModel';
import type { SectionRendererInput } from './types';

export function renderScheduleSection({ componentName, props, t }: SectionRendererInput) {
  const entries = toObjectArray(props.entries || props.events || props.items);
  const rows =
    entries.length > 0
      ? entries
      : [
          { title: 'Blueprint review', date: 'Mon 15', time: '09:00', owner: 'Reviewer' },
          { title: 'Implementation pass', date: 'Tue 16', time: '13:30', owner: 'Agent' },
          { title: 'Validation', date: 'Wed 17', time: '16:00', owner: 'System' },
        ];
  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-xs">
        <div className="font-semibold text-foreground">{String(props.title || 'This week')}</div>
        <div className="text-muted-foreground">{rows.length} items</div>
      </div>
      <div className="grid gap-2">
        {rows.slice(0, 5).map((row, index) => (
          <div
            className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-3 rounded-md border border-border bg-card px-3 py-2 text-xs"
            key={String(row.id || row.title || index)}
          >
            <div className="grid content-center rounded border border-border bg-muted px-2 py-1 text-center">
              <span className="font-semibold text-foreground">{String(row.time || '09:00')}</span>
              <span className="text-[10px] text-muted-foreground">{String(row.date || '')}</span>
            </div>
            <div className="min-w-0">
              <div className="truncate font-medium text-foreground">
                {String(row.title || row.label || `Schedule ${index + 1}`)}
              </div>
              <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
                <span className="rounded border border-border px-1.5 py-0.5">
                  {String(row.owner || row.status || 'Scheduled')}
                </span>
                {row.location ? (
                  <span className="rounded border border-border px-1.5 py-0.5">
                    {String(row.location)}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
