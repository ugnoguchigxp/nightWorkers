import { PreviewCard, PreviewProgress } from '../BlueprintPreviewPrimitives';
import { toObjectArray } from '../previewModel';
import type { SectionRendererInput } from './types';

export function renderControlPanelSection({ componentName, props, t }: SectionRendererInput) {
  const controls = toObjectArray(props.controls || props.items);
  const rows =
    controls.length > 0
      ? controls
      : [
          { label: 'Density', value: 64, mode: 'Compact' },
          { label: 'Motion', value: 28, mode: 'Reduced' },
          { label: 'Contrast', value: 82, mode: 'High' },
        ];
  const modes = Array.isArray(props.modes)
    ? props.modes.map(String)
    : ['Preview', 'Review', 'Adopt'];
  return (
    <div className="grid gap-3 rounded-md border border-border bg-muted p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs font-semibold text-foreground">
            {String(props.panelTitle || 'Display controls')}
          </div>
          <div className="text-[11px] text-muted-foreground">Mode, toggles, and ranges</div>
        </div>
        <div className="flex flex-wrap gap-1 rounded-md border border-border bg-card p-1">
          {modes.slice(0, 4).map((mode, index) => (
            <span
              className={`rounded px-3 py-1 text-[11px] font-medium ${
                index === 0 ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
              }`}
              key={mode}
            >
              {mode}
            </span>
          ))}
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_12rem]">
        <div className="grid gap-2">
          {rows.slice(0, 4).map((control, index) => (
            <PreviewCard
              className="grid gap-2 bg-card p-3"
              key={String(control.id || control.label || index)}
            >
              <div className="flex items-center justify-between gap-3 text-xs">
                <div className="font-medium text-foreground">
                  {String(control.label || control.title || `Control ${index + 1}`)}
                </div>
                <span className="rounded border border-border bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                  {String(control.mode || control.state || 'Enabled')}
                </span>
              </div>
              <PreviewProgress value={Number(control.value ?? control.progress ?? 50)} />
            </PreviewCard>
          ))}
        </div>
        <div className="grid gap-2">
          {['Auto save', 'High contrast', 'Reduced motion'].map((label, index) => (
            <div
              className="flex items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs"
              key={label}
            >
              <span className="text-foreground">{label}</span>
              <span
                className={`flex h-5 w-9 items-center rounded-full p-0.5 ${
                  index === 1 ? 'bg-primary' : 'bg-muted'
                }`}
              >
                <span
                  className={`h-4 w-4 rounded-full bg-background shadow ${
                    index === 1 ? 'ml-auto' : ''
                  }`}
                />
              </span>
            </div>
          ))}
          <div className="grid grid-cols-4 gap-1 rounded-md border border-border bg-card p-2">
            {['#0ea5e9', '#22c55e', '#f59e0b', '#ef4444'].map((color) => (
              <span
                className="h-6 rounded border border-border"
                key={color}
                style={{ background: color }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
