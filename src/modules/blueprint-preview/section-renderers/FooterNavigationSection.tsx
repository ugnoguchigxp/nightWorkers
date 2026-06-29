import { toObjectArray } from '../previewModel';
import type { SectionRendererInput } from './types';

export function renderFooterNavigationSection({ props }: SectionRendererInput) {
  const footerColumns = toObjectArray(props.footerColumns || props.columns);
  const columns =
    footerColumns.length > 0
      ? footerColumns
      : [
          { title: 'Product', links: ['Overview', 'Blueprints', 'Runs'] },
          { title: 'Resources', links: ['Docs', 'Examples', 'Changelog'] },
          { title: 'Support', links: ['Settings', 'Logs', 'Status'] },
        ];
  return (
    <footer className="grid gap-4 rounded-md border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-border border-b pb-3">
        <div className="font-semibold text-foreground">{String(props.brand || 'Workspace')}</div>
        <div className="text-[11px] text-muted-foreground">Footer navigation</div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {columns.slice(0, 4).map((column, index) => {
          const columnLinks = Array.isArray(column.links)
            ? column.links.map((link) =>
                typeof link === 'object' && link
                  ? String(
                      (link as Record<string, unknown>).label ||
                        (link as Record<string, unknown>).title
                    )
                  : String(link)
              )
            : ['Overview', 'Docs', 'Status'];
          return (
            <div className="grid gap-1.5" key={String(column.title || index)}>
              <div className="text-xs font-semibold text-foreground">
                {String(column.title || column.label || `Column ${index + 1}`)}
              </div>
              {columnLinks.slice(0, 5).map((link) => (
                <div className="text-[11px] text-muted-foreground" key={link}>
                  {link}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </footer>
  );
}
