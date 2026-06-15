import { toObjectArray } from '../previewModel';
import { navigationLinks } from './navigationHelpers';
import type { SectionRendererInput } from './types';

export function renderSidebarMenuSection({ props }: SectionRendererInput) {
  const navLinks = navigationLinks(props);
  const groups = toObjectArray(props.groups);
  const menuGroups =
    groups.length > 0
      ? groups
      : [
          { title: 'Workspace', links: navLinks.slice(0, 3) },
          { title: 'Build', links: navLinks.slice(1, 4) },
        ];
  return (
    <div className="grid min-h-64 grid-cols-[13rem_minmax(0,1fr)] overflow-hidden rounded-md border border-border bg-card">
      <aside className="border-border border-r bg-muted p-3">
        <div className="mb-3 text-xs font-semibold text-foreground">
          {String(props.brand || 'Workspace')}
        </div>
        <div className="grid gap-4">
          {menuGroups.slice(0, 3).map((group, groupIndex) => (
            <div className="grid gap-1.5" key={String(group.title || groupIndex)}>
              <div className="px-2 text-[10px] font-semibold uppercase tracking-normal text-muted-foreground">
                {String(group.title || group.label || `Group ${groupIndex + 1}`)}
              </div>
              {toObjectArray(group.links || group.items)
                .slice(0, 4)
                .map((link, index) => (
                  <div
                    className={`flex items-center justify-between gap-2 rounded px-2 py-1.5 text-xs ${
                      groupIndex === 0 && index === 0
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground'
                    }`}
                    key={String(link.label || link.title || index)}
                  >
                    <span>{String(link.label || link.title || `Item ${index + 1}`)}</span>
                    {link.badge ? <span className="text-[10px]">{String(link.badge)}</span> : null}
                  </div>
                ))}
            </div>
          ))}
        </div>
      </aside>
      <div className="grid content-start gap-2 p-3">
        <div className="h-8 rounded border border-border bg-muted" />
        <div className="h-20 rounded border border-border bg-muted/70" />
        <div className="h-16 rounded border border-border bg-muted/50" />
      </div>
    </div>
  );
}
