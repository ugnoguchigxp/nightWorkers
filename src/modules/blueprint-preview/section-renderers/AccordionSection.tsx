import { previewGenericItems } from '../previewModel';
import type { SectionRendererInput } from './types';

export function renderAccordionSection({ componentName, props, t }: SectionRendererInput) {
  const items = previewGenericItems(props, t);
  return (
    <div className="grid gap-2">
      {items.slice(0, 4).map((item, index) => (
        <div
          className="overflow-hidden rounded-md border border-border bg-card"
          key={`${item.title}-${index}`}
        >
          <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs font-medium text-foreground">
            <span>{item.title}</span>
            <span className="text-muted-foreground">{index === 0 ? '-' : '+'}</span>
          </div>
          {index === 0 ? (
            <div className="border-border border-t bg-muted px-3 py-2 text-[11px] leading-5 text-muted-foreground">
              {item.description}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
