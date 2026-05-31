import { Popover } from '@base-ui/react';
import * as React from 'react';

import { cn } from '@/utils/cn';

const PopoverRoot = Popover.Root;

const PopoverTrigger = Popover.Trigger;

const PopoverContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof Popover.Popup> & {
    align?: 'start' | 'center' | 'end';
    sideOffset?: number;
    side?: 'top' | 'bottom' | 'left' | 'right';
  }
>(({ className, align = 'center', sideOffset = 4, side = 'bottom', ...props }, ref) => (
  <Popover.Portal>
    <Popover.Positioner sideOffset={sideOffset} align={align} side={side}>
      <Popover.Popup
        ref={ref}
        data-gxp-portal="true"
        data-gxp-top-layer="true"
        className={cn(
          'z-portal rounded-[var(--radius,0.5rem)] border bg-popover p-4 text-popover-foreground shadow-md outline-none data-[open]:animate-in data-[closed]:animate-out data-[closed]:fade-out-0 data-[open]:fade-in-0 data-[closed]:zoom-out-95 data-[open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
          className
        )}
        {...props}
      />
    </Popover.Positioner>
  </Popover.Portal>
));
PopoverContent.displayName = 'PopoverContent';

export { PopoverContent, PopoverRoot as Popover, PopoverTrigger };
