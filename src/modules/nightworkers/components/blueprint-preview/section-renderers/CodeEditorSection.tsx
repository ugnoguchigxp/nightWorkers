import type { SectionRendererInput } from './types';

export function renderCodeEditorSection({ componentName, props, t }: SectionRendererInput) {
  const lines = Array.isArray(props.lines)
    ? props.lines.map(String)
    : ['function SectionPreview() {', '  return <BlueprintSection />;', '}'];
  return (
    <div className="overflow-hidden rounded-md border border-border bg-muted">
      <div className="flex items-center justify-between border-border border-b px-3 py-2">
        <div className="text-[11px] font-medium text-muted-foreground">Editor</div>
        <div className="flex gap-1">
          <span className="h-2 w-2 rounded-full bg-red-400" />
          <span className="h-2 w-2 rounded-full bg-amber-400" />
          <span className="h-2 w-2 rounded-full bg-green-400" />
        </div>
      </div>
      <div className="grid min-h-56 content-start gap-0 p-4 font-mono text-[11px] leading-4 text-foreground">
        {lines.slice(0, 18).map((line, index) => (
          <div className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2" key={`${line}-${index}`}>
            <span className="text-muted-foreground">{index + 1}</span>
            <span className="overflow-hidden text-ellipsis whitespace-pre">{line || ' '}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
