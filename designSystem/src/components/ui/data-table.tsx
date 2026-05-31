import * as React from 'react';

import { cn } from '../../lib/utils';

const DataTable = React.forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('w-full rounded-lg border border-border bg-background', className)}
      {...props}
    />
  )
);
DataTable.displayName = 'DataTable';

const DataTableHeader = React.forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex items-center justify-between gap-[var(--stack-gap-lg)] border-b border-border p-[var(--panel-p-md)]',
        className
      )}
      {...props}
    />
  )
);
DataTableHeader.displayName = 'DataTableHeader';

const DataTableContent = React.forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('p-[var(--panel-p-md)]', className)} {...props} />
  )
);
DataTableContent.displayName = 'DataTableContent';

const DataTableFooter = React.forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('border-t border-border p-[var(--panel-p-md)]', className)}
      {...props}
    />
  )
);
DataTableFooter.displayName = 'DataTableFooter';

export { DataTable, DataTableContent, DataTableFooter, DataTableHeader };
