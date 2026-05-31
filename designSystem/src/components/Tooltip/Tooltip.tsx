import { Tooltip } from '@base-ui/react';
import * as React from 'react';
import { cn } from '@/utils/cn';

export const TooltipProvider = Tooltip.Provider;

export const TooltipTrigger = Tooltip.Trigger;
export const TooltipRoot = Tooltip.Root;

// Rename internal export for clarity
export { TooltipRoot as Tooltip };

export const TooltipContent = React.memo(
  React.forwardRef<
    HTMLDivElement,
    React.ComponentPropsWithoutRef<typeof Tooltip.Popup> & {
      align?: 'start' | 'center' | 'end';
      side?: 'top' | 'bottom' | 'left' | 'right';
      sideOffset?: number;
    }
  >(({ className, sideOffset = 4, side = 'bottom', align = 'center', ...props }, ref) => (
    <Tooltip.Portal>
      <Tooltip.Positioner sideOffset={sideOffset} side={side} align={align}>
        <Tooltip.Popup
          ref={ref}
          data-gxp-top-layer="true"
          className={cn(
            'z-tooltip overflow-hidden rounded-[var(--radius-sm,2px)] border border-white bg-black text-white px-3 py-1.5 text-xs shadow-md animate-in fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
            className
          )}
          {...props}
        />
      </Tooltip.Positioner>
    </Tooltip.Portal>
  ))
);
TooltipContent.displayName = 'TooltipContent';
