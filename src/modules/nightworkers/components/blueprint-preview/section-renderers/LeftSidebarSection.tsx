import { navigationLinks } from './navigationHelpers';
import type { SectionRendererInput } from './types';

export function renderLeftSidebarSection({ props }: SectionRendererInput) {
  const links = navigationLinks(props);
  const title = String(props.title || props.heading || '注目コンテンツ');
  const ads = Array.isArray(props.ads) ? props.ads.map(String) : ['Sponsored', 'Event', 'Guide'];
  return (
    <div className="grid min-h-72 grid-cols-[13rem_minmax(0,1fr)] overflow-hidden rounded-md border border-border bg-card">
      <aside className="grid content-start gap-4 border-border border-r bg-muted p-3">
        <section className="grid gap-2">
          <div className="text-xs font-semibold text-foreground">{title}</div>
          <div className="grid gap-1.5">
            {links.slice(0, 5).map((link, index) => (
              <a
                className="border-border border-b pb-1.5 text-xs leading-5 text-foreground last:border-b-0"
                href={String(link.href || '#')}
                key={String(link.label || link.title || index)}
              >
                {String(link.label || link.title || `Link ${index + 1}`)}
              </a>
            ))}
          </div>
        </section>
        <section className="grid gap-2">
          <div className="text-[10px] font-semibold uppercase tracking-normal text-muted-foreground">
            Ads
          </div>
          {ads.slice(0, 3).map((ad, index) => (
            <div
              className="rounded border border-border bg-card px-3 py-4 text-center text-[11px] text-muted-foreground"
              key={`${ad}-${index}`}
            >
              {ad}
            </div>
          ))}
        </section>
      </aside>
      <div className="grid content-start gap-3 p-3">
        <div className="h-8 rounded border border-border bg-muted" />
        <div className="h-28 rounded border border-border bg-muted/70" />
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="h-20 rounded border border-border bg-muted/60" />
          <div className="h-20 rounded border border-border bg-muted/50" />
        </div>
        <div className="h-16 rounded border border-border bg-muted/40" />
      </div>
    </div>
  );
}
