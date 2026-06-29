import { navigationLinks } from './navigationHelpers';
import type { SectionRendererInput } from './types';

export function renderRightSidebarLinksSection({ props }: SectionRendererInput) {
  const navLinks = navigationLinks(props);
  const title = String(props.title || props.heading || 'アクセスランキング');
  const ads = Array.isArray(props.ads) ? props.ads.map(String) : ['Sponsored', 'Newsletter'];
  return (
    <div className="grid min-h-72 grid-cols-[minmax(0,1fr)_13rem] overflow-hidden rounded-md border border-border bg-card">
      <div className="grid content-start gap-3 p-3">
        <div className="h-8 rounded border border-border bg-muted" />
        <div className="h-28 rounded border border-border bg-muted/70" />
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="h-20 rounded border border-border bg-muted/60" />
          <div className="h-20 rounded border border-border bg-muted/50" />
        </div>
        <div className="h-16 rounded border border-border bg-muted/40" />
      </div>
      <aside className="grid content-start gap-4 border-border border-l bg-muted p-3">
        <section className="grid gap-2">
          <div className="text-xs font-semibold text-foreground">{title}</div>
          <div className="grid gap-2">
            {navLinks.slice(0, 5).map((link, index) => (
              <a
                className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-2 text-xs leading-5 text-foreground"
                href={String(link.href || '#')}
                key={String(link.label || link.title || index)}
              >
                <span className="font-semibold text-primary">{index + 1}</span>
                <span>{String(link.label || link.title || `Link ${index + 1}`)}</span>
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
        {props.note ? (
          <div className="rounded border border-border bg-card p-3 text-[11px] leading-5 text-muted-foreground">
            {String(props.note)}
          </div>
        ) : null}
      </aside>
    </div>
  );
}
