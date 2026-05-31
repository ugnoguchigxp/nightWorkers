import * as React from 'react';

import { cn } from '../../lib/utils';

const Sidebar = React.forwardRef<HTMLDivElement, React.ComponentProps<'aside'>>(
  ({ className, ...props }, ref) => (
    <aside
      ref={ref}
      className={cn(
        'flex h-full w-64 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground',
        className
      )}
      {...props}
    />
  )
);
Sidebar.displayName = 'Sidebar';

const SidebarHeader = React.forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('border-b border-sidebar-border p-[var(--panel-p-sm)]', className)}
      {...props}
    />
  )
);
SidebarHeader.displayName = 'SidebarHeader';

const SidebarContent = React.forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex-1 overflow-auto p-[var(--panel-p-sm)]', className)}
      {...props}
    />
  )
);
SidebarContent.displayName = 'SidebarContent';

const SidebarFooter = React.forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('border-t border-sidebar-border p-[var(--panel-p-sm)]', className)}
      {...props}
    />
  )
);
SidebarFooter.displayName = 'SidebarFooter';

const SidebarSectionTitle = React.forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'px-[var(--control-px-sm)] py-[var(--control-py-sm)] text-xs font-semibold uppercase tracking-wide text-muted-foreground',
        className
      )}
      {...props}
    />
  )
);
SidebarSectionTitle.displayName = 'SidebarSectionTitle';

const SidebarItem = React.forwardRef<HTMLButtonElement, React.ComponentProps<'button'>>(
  ({ className, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        'flex w-full items-center gap-[var(--stack-gap-sm)] rounded-[var(--radius-md)] px-[var(--control-px-sm)] py-[var(--control-py-md)] text-[var(--font-size-sm)] outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-1 focus-visible:ring-sidebar-ring',
        className
      )}
      {...props}
    />
  )
);
SidebarItem.displayName = 'SidebarItem';

export { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarItem, SidebarSectionTitle };
