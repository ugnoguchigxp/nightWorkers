import { PreviewBadge } from '../BlueprintPreviewPrimitives';
import { toObjectArray } from '../previewModel';
import type { SectionRendererInput } from './types';

export function renderCalendarSection({ componentName, props, t }: SectionRendererInput) {
  const events = toObjectArray(props.events || props.entries || props.items);
  const eventDays = new Map(
    (events.length > 0
      ? events
      : [
          { title: 'Blueprint review', day: 15 },
          { title: 'Implementation pass', day: 16 },
          { title: 'Validation', day: 17 },
        ]
    ).map((event, index) => [
      Number(
        event.day ||
          String(event.date || '')
            .split('-')
            .at(-1) ||
          15 + index
      ),
      event,
    ])
  );
  const days = Array.from({ length: 35 }, (_, index) => index + 1);
  const weekdayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2">
        <div>
          <div className="text-xs font-semibold text-foreground">
            {String(props.monthLabel || 'June 2026')}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {eventDays.size} scheduled markers
          </div>
        </div>
        <PreviewBadge tone="primary" className="text-[10px]">
          Month
        </PreviewBadge>
      </div>
      <div className="grid grid-cols-7 overflow-hidden rounded-md border border-border bg-card text-center text-[11px]">
        {weekdayLabels.map((label) => (
          <div
            className="border-border border-b bg-secondary px-1 py-2 font-medium text-muted-foreground"
            key={label}
          >
            {label}
          </div>
        ))}
        {days.map((day) => {
          const event = eventDays.get(day);
          return (
            <div
              className={`min-h-14 border-border border-r border-b p-1 text-left ${
                event ? 'bg-primary/10 text-foreground' : 'bg-background text-muted-foreground'
              }`}
              key={day}
            >
              <div className="text-[10px] font-medium">{day}</div>
              {event ? (
                <div className="mt-1 line-clamp-2 rounded bg-primary px-1 py-0.5 text-[9px] leading-3 text-primary-foreground">
                  {String(event.title || event.label || 'Event')}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
