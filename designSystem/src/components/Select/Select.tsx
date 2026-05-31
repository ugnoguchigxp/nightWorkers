import { Select as BaseSelect } from '@base-ui/react';
import { Check, ChevronDown } from 'lucide-react';
import * as React from 'react';
import { cn } from '@/utils/cn';
import {
  type SelectItemVariants,
  type SelectTriggerVariants,
  selectItemVariants,
  selectTriggerVariants,
} from './selectVariants';

const Select = BaseSelect.Root;

const SelectGroup = BaseSelect.Group;

const SelectValue = BaseSelect.Value;

type SelectTriggerProps = React.ComponentPropsWithoutRef<typeof BaseSelect.Trigger> &
  SelectTriggerVariants;

const SelectTrigger = React.memo(
  React.forwardRef<React.ElementRef<typeof BaseSelect.Trigger>, SelectTriggerProps>(
    ({ className, children, disabled, style, variant, size, ...props }, ref) => {
      return (
        <BaseSelect.Trigger
          ref={ref}
          disabled={disabled}
          style={style}
          className={cn(selectTriggerVariants({ variant, size }), className)}
          {...props}
        >
          {children}
          <BaseSelect.Icon>
            <ChevronDown className="h-4 w-4 opacity-50 transition-transform data-[state=open]:rotate-180" />
          </BaseSelect.Icon>
        </BaseSelect.Trigger>
      );
    }
  )
);
SelectTrigger.displayName = 'SelectTrigger';

const SelectContent = React.memo(
  React.forwardRef<
    React.ElementRef<typeof BaseSelect.Popup>,
    React.ComponentPropsWithoutRef<typeof BaseSelect.Popup> & {
      alignItemWithTrigger?: boolean;
      scrollable?: boolean;
      side?: React.ComponentPropsWithoutRef<typeof BaseSelect.Positioner>['side'];
      sideOffset?: React.ComponentPropsWithoutRef<typeof BaseSelect.Positioner>['sideOffset'];
      align?: React.ComponentPropsWithoutRef<typeof BaseSelect.Positioner>['align'];
    }
  >(
    (
      {
        className,
        children,
        alignItemWithTrigger = false,
        scrollable = true,
        sideOffset = 4,
        side = 'bottom',
        align = 'start',
        ...props
      },
      ref
    ) => {
      return (
        <BaseSelect.Portal>
          <BaseSelect.Positioner
            side={side}
            align={align}
            sideOffset={alignItemWithTrigger ? 0 : sideOffset}
            className="z-portal"
          >
            <BaseSelect.Popup
              ref={ref}
              data-gxp-portal="true"
              data-gxp-top-layer="true"
              className={cn(
                'relative box-border overflow-hidden rounded-md border border-input bg-background text-foreground shadow-md outline-none',
                'data-[state=open]:animate-in data-[state=closed]:animate-out',
                'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
                'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
                'data-[state=open]:slide-in-from-top-0',
                'w-[var(--anchor-width)] min-w-[var(--anchor-width)] max-w-[var(--anchor-width)]',
                className
              )}
              {...props}
            >
              <div
                className={cn(
                  'w-full py-1',
                  scrollable &&
                    'max-h-[var(--radix-select-content-available-height,16rem)] overflow-y-auto overflow-x-hidden overscroll-contain [scrollbar-gutter:stable] scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent'
                )}
              >
                {children}
              </div>
            </BaseSelect.Popup>
          </BaseSelect.Positioner>
        </BaseSelect.Portal>
      );
    }
  )
);
SelectContent.displayName = 'SelectContent';

const SelectLabel = React.forwardRef<
  React.ElementRef<typeof BaseSelect.GroupLabel>,
  React.ComponentPropsWithoutRef<typeof BaseSelect.GroupLabel>
>(({ className, ...props }, ref) => (
  <BaseSelect.GroupLabel
    ref={ref}
    className={cn('px-3 py-2 text-xs font-semibold text-muted-foreground/80', className)}
    {...props}
  />
));
SelectLabel.displayName = 'SelectLabel';

const SelectItem = React.memo(
  React.forwardRef<
    React.ElementRef<typeof BaseSelect.Item>,
    React.ComponentPropsWithoutRef<typeof BaseSelect.Item> & SelectItemVariants
  >(({ className, children, size, ...props }, ref) => (
    <BaseSelect.Item
      ref={ref}
      className={cn(
        selectItemVariants({ size }),
        'relative flex w-full cursor-default select-none items-center px-3 py-2 text-sm outline-none transition-colors',
        className
      )}
      {...props}
    >
      <BaseSelect.ItemText className="flex-1 truncate">{children}</BaseSelect.ItemText>
      <span className="flex h-4 w-4 items-center justify-center shrink-0 ml-2">
        <BaseSelect.ItemIndicator>
          <Check className="h-4 w-4 text-primary" strokeWidth={2.5} />
        </BaseSelect.ItemIndicator>
      </span>
    </BaseSelect.Item>
  ))
);
SelectItem.displayName = 'SelectItem';

const SelectSeparator = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('-mx-1 my-1 h-px bg-muted', className)} {...props} />
  )
);
SelectSeparator.displayName = 'SelectSeparator';

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
};
