import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/utils';

export type PreviewTableColumn = {
  key: string;
  label: string;
};

export function PreviewCard({
  as: Component = 'div',
  className,
  children,
  ...props
}: HTMLAttributes<HTMLElement> & {
  as?: 'article' | 'div' | 'section';
}) {
  return (
    <Component className={cn('blueprint-preview-card rounded-md border', className)} {...props}>
      {children}
    </Component>
  );
}

export function PreviewButton({
  children,
  className,
  tone = 'primary',
}: {
  children: ReactNode;
  className?: string;
  tone?: 'primary' | 'secondary' | 'plain';
}) {
  const toneClass =
    tone === 'primary'
      ? 'bg-primary text-primary-foreground'
      : tone === 'secondary'
        ? 'border border-border bg-card text-foreground'
        : 'border border-border text-foreground';

  return (
    <span
      className={cn(
        'blueprint-preview-button inline-flex items-center justify-center px-3 py-2 text-xs font-semibold',
        toneClass,
        className
      )}
    >
      {children}
    </span>
  );
}

export function PreviewActionButton({
  children,
  className,
  tone = 'secondary',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: 'primary' | 'secondary' | 'plain';
}) {
  const toneClass =
    tone === 'primary'
      ? 'border-primary bg-primary text-primary-foreground hover:opacity-90'
      : tone === 'secondary'
        ? 'border-border bg-card text-foreground hover:bg-background'
        : 'border-border bg-background text-foreground hover:bg-secondary';

  return (
    <button
      type="button"
      className={cn(
        'blueprint-preview-button inline-flex h-8 items-center gap-2 border px-3 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50',
        toneClass,
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function PreviewOptionButton({
  children,
  selected,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  selected: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        'blueprint-preview-option rounded border px-2.5 py-1 text-[11px] font-semibold transition',
        selected
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-background text-foreground hover:bg-secondary',
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function PreviewField({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'blueprint-preview-field block w-full border border-input bg-background px-3 py-2 text-xs text-muted-foreground',
        className
      )}
    >
      {children}
    </span>
  );
}

export function PreviewBadge({
  children,
  className,
  tone = 'default',
}: {
  children: ReactNode;
  className?: string;
  tone?: 'default' | 'primary' | 'success' | 'warning';
}) {
  const toneClass =
    tone === 'primary'
      ? 'border-primary bg-primary text-primary-foreground'
      : tone === 'success'
        ? 'border-transparent bg-emerald-500/10 text-emerald-700'
        : tone === 'warning'
          ? 'border-transparent bg-amber-500/10 text-amber-700'
          : 'border-border bg-muted text-muted-foreground';

  return (
    <span
      className={cn(
        'inline-flex items-center rounded border px-2 py-1 text-xs',
        toneClass,
        className
      )}
    >
      {children}
    </span>
  );
}

export function PreviewProgress({
  label,
  value,
  className,
}: {
  label?: ReactNode;
  value: number;
  className?: string;
}) {
  const clampedValue = Math.max(0, Math.min(100, Number(value) || 0));

  return (
    <div className={cn('grid gap-1 text-xs', className)}>
      {label ? (
        <div className="flex justify-between text-muted-foreground">
          <span>{label}</span>
          <span>{clampedValue}%</span>
        </div>
      ) : null}
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${clampedValue}%` }} />
      </div>
    </div>
  );
}

export function PreviewTable({
  columns,
  rows,
  className,
  minWidthClassName = 'min-w-[32rem]',
}: {
  columns: PreviewTableColumn[];
  rows: Array<Record<string, unknown>>;
  className?: string;
  minWidthClassName?: string;
}) {
  return (
    <div className={cn('overflow-hidden rounded-md border border-border bg-card', className)}>
      <table
        className={cn(
          'blueprint-preview-table w-full border-collapse text-left text-xs',
          minWidthClassName
        )}
      >
        <thead className="bg-secondary text-muted-foreground">
          <tr>
            {columns.map((column) => (
              <th className="px-3 py-2 font-semibold uppercase" key={column.key}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr className="border-border border-t odd:bg-muted/50" key={rowIndex}>
              {columns.map((column) => (
                <td className="px-3 py-2 text-foreground" key={column.key}>
                  {String(row[column.key] || '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
