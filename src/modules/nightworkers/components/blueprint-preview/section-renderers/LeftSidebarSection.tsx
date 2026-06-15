import type { SectionRendererInput } from './types';

export function renderLeftSidebarSection({ props }: SectionRendererInput) {
  const groups = [
    { title: 'Main', links: ['Dashboard', 'Projects', 'Runs'] },
    { title: 'Workspace', links: ['Blueprints', 'Artifacts', 'Reviews'] },
    { title: 'Admin', links: ['Members', 'Settings'] },
  ];
  return (
    <div className="grid min-h-72 grid-cols-[14rem_minmax(0,1fr)] overflow-hidden rounded-md border border-border bg-card">
      <aside className="grid content-start gap-4 border-border border-r bg-muted p-3">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">
            NW
          </span>
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold text-foreground">NightWorkers</div>
            <div className="truncate text-[10px] text-muted-foreground">Workspace</div>
          </div>
        </div>
        <div className="grid gap-3">
          {groups.map((group, groupIndex) => (
            <div className="grid gap-1" key={group.title}>
              <div className="px-2 text-[10px] font-semibold uppercase tracking-normal text-muted-foreground">
                {group.title}
              </div>
              {group.links.map((link, index) => (
                <div
                  className={`flex items-center justify-between rounded px-2 py-1.5 text-xs ${
                    groupIndex === 0 && index === 0
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground'
                  }`}
                  key={link}
                >
                  <span>{link}</span>
                  {link === 'Runs' ? <span className="text-[10px]">12</span> : null}
                </div>
              ))}
            </div>
          ))}
        </div>
      </aside>
      <div className="grid content-start gap-3 p-3">
        <div className="h-9 rounded border border-border bg-muted" />
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="h-24 rounded border border-border bg-muted/70" />
          <div className="h-24 rounded border border-border bg-muted/60" />
        </div>
        <div className="h-20 rounded border border-border bg-muted/50" />
      </div>
    </div>
  );
}
