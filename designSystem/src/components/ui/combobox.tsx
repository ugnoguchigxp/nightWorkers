import { Combobox as BaseCombobox } from '@base-ui/react/combobox';
import { Check, ChevronsUpDown } from 'lucide-react';
import * as React from 'react';

import { cn } from '../../lib/utils';

const Combobox = BaseCombobox.Root;
const ComboboxGroup = BaseCombobox.Group;

const ComboboxInput = React.forwardRef<
  HTMLInputElement,
  React.ComponentProps<typeof BaseCombobox.Input>
>(({ className, ...props }, ref) => (
  <BaseCombobox.Input
    ref={ref}
    className={cn(
      'flex h-[var(--control-height-lg)] w-full rounded-[var(--radius-md)] border border-input bg-background px-[var(--control-px-md)] py-[var(--control-py-md)] text-[var(--font-size-sm)] leading-5 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
      className
    )}
    {...props}
  />
));
ComboboxInput.displayName = 'ComboboxInput';

const ComboboxTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<typeof BaseCombobox.Trigger>
>(({ className, ...props }, ref) => (
  <BaseCombobox.Trigger
    ref={ref}
    className={cn(
      'absolute right-0 top-0 inline-flex h-[var(--control-height-lg)] w-[var(--control-height-lg)] items-center justify-center text-muted-foreground',
      className
    )}
    {...props}
  >
    <ChevronsUpDown className="h-4 w-4 opacity-60" />
  </BaseCombobox.Trigger>
));
ComboboxTrigger.displayName = 'ComboboxTrigger';

const ComboboxContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<typeof BaseCombobox.Popup>
>(({ className, children, ...props }, ref) => (
  <BaseCombobox.Portal>
    <BaseCombobox.Positioner sideOffset={6}>
      <BaseCombobox.Popup
        ref={ref}
        className={cn(
          'z-50 min-w-[8rem] overflow-hidden rounded-[var(--radius-md)] border border-border bg-popover p-[var(--control-py-sm)] text-popover-foreground shadow-md',
          className
        )}
        {...props}
      >
        <BaseCombobox.List>{children}</BaseCombobox.List>
      </BaseCombobox.Popup>
    </BaseCombobox.Positioner>
  </BaseCombobox.Portal>
));
ComboboxContent.displayName = 'ComboboxContent';

const ComboboxItem = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<typeof BaseCombobox.Item>
>(({ className, children, ...props }, ref) => (
  <BaseCombobox.Item
    ref={ref}
    className={cn(
      'relative flex w-full cursor-default select-none items-center rounded-[var(--radius-sm)] py-[var(--control-py-md)] pl-8 pr-[var(--control-px-sm)] text-[var(--font-size-sm)] outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      className
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <BaseCombobox.ItemIndicator>
        <Check className="h-4 w-4" />
      </BaseCombobox.ItemIndicator>
    </span>
    {children}
  </BaseCombobox.Item>
));
ComboboxItem.displayName = 'ComboboxItem';

const ComboboxEmpty = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<typeof BaseCombobox.Empty>
>(({ className, ...props }, ref) => (
  <BaseCombobox.Empty
    ref={ref}
    className={cn(
      'py-[var(--panel-p-sm)] text-center text-[var(--font-size-sm)] text-muted-foreground',
      className
    )}
    {...props}
  />
));
ComboboxEmpty.displayName = 'ComboboxEmpty';

const ComboboxLabel = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<typeof BaseCombobox.Label>
>(({ className, ...props }, ref) => (
  <BaseCombobox.Label
    ref={ref}
    className={cn(
      'px-[var(--control-px-sm)] py-[var(--control-py-sm)] text-xs font-semibold',
      className
    )}
    {...props}
  />
));
ComboboxLabel.displayName = 'ComboboxLabel';

export {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxTrigger,
};
