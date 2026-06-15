import { navigationLinks } from './navigationHelpers';
import type { SectionRendererInput } from './types';

export function renderRightSidebarLinksSection({ props }: SectionRendererInput) {
  const navLinks = navigationLinks(props);
  return (
    <div className="grid min-h-64 grid-cols-[minmax(0,1fr)_13rem] overflow-hidden rounded-md border border-border bg-card">
      <div className="grid content-start gap-2 p-3">
        <div className="h-8 rounded border border-border bg-muted" />
        <div className="h-20 rounded border border-border bg-muted/70" />
        <div className="h-20 rounded border border-border bg-muted/50" />
      </div>
      <aside className="border-border border-l bg-muted p-3">
        <div className="mb-3 text-xs font-semibold text-foreground">Related links</div>
        <div className="grid gap-2">
          {navLinks.slice(0, 6).map((link, index) => (
            <a
              className="rounded border border-border bg-card px-3 py-2 text-xs text-foreground"
              href={String(link.href || '#')}
              key={String(link.label || link.title || index)}
            >
              <div>{String(link.label || link.title || `Link ${index + 1}`)}</div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">
                {String(link.href || `/section/${index + 1}`)}
              </div>
            </a>
          ))}
        </div>
      </aside>
    </div>
  );
}
