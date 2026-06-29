import { toObjectArray } from '../previewModel';
import type { SectionRendererInput } from './types';

export function renderExplorerSidebarSection({ props }: SectionRendererInput) {
  const tree = toObjectArray(props.tree);
  const nodes =
    tree.length > 0
      ? tree
      : [
          { label: 'app', children: [{ label: 'routes' }, { label: 'components' }] },
          { label: 'api', children: [{ label: 'services' }, { label: 'schemas' }] },
        ];
  return (
    <div className="grid min-h-64 grid-cols-[14rem_minmax(0,1fr)] overflow-hidden rounded-md border border-border bg-card">
      <aside className="border-border border-r bg-muted p-3">
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="font-semibold text-foreground">Explorer</span>
          <span className="text-muted-foreground">+</span>
        </div>
        <div className="grid gap-1 text-xs">
          {nodes.slice(0, 4).map((node, index) => (
            <div className="grid gap-1" key={String(node.label || node.title || index)}>
              <div className="rounded px-2 py-1 font-medium text-foreground">
                v {String(node.label || node.title || `Folder ${index + 1}`)}
              </div>
              {toObjectArray(node.children || node.items)
                .slice(0, 5)
                .map((child, childIndex) => (
                  <div
                    className="ml-3 rounded px-2 py-1 text-muted-foreground"
                    key={String(child.label || child.title || childIndex)}
                  >
                    {child.type === 'file' ? '- ' : '+ '}
                    {String(child.label || child.title || `Item ${childIndex + 1}`)}
                  </div>
                ))}
            </div>
          ))}
        </div>
      </aside>
      <div className="grid content-start gap-2 p-3 font-mono text-[11px] text-muted-foreground">
        <div className="rounded border border-border bg-muted px-3 py-2 text-foreground">
          blueprint-showcase.tsx
        </div>
        <div className="rounded border border-border bg-background px-3 py-2">
          {'<BlueprintPreviewSection />'}
        </div>
        <div className="rounded border border-border bg-background px-3 py-2">
          export const Route = createFileRoute(...)
        </div>
      </div>
    </div>
  );
}
