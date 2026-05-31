import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';
import * as React from 'react';

import { cn } from '../../lib/utils';

type TooltipContentProps = React.ComponentProps<typeof BaseTooltip.Popup> & {
  side?: React.ComponentProps<typeof BaseTooltip.Positioner>['side'];
  align?: React.ComponentProps<typeof BaseTooltip.Positioner>['align'];
  sideOffset?: number;
  alignOffset?: number;
};

const TooltipProvider = BaseTooltip.Provider;
const Tooltip = BaseTooltip.Root;
const TooltipTrigger = BaseTooltip.Trigger;

const TooltipContent = React.forwardRef<HTMLDivElement, TooltipContentProps>(
  (
    {
      className,
      side = 'top',
      align = 'center',
      sideOffset = 8,
      alignOffset = 0,
      children,
      ...props
    },
    ref
  ) => (
    <BaseTooltip.Portal>
      <BaseTooltip.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
      >
        <BaseTooltip.Popup
          ref={ref}
          className={cn(
            'z-50 overflow-hidden rounded-[var(--radius-md)] border border-border bg-popover px-[var(--control-px-sm)] py-[var(--control-py-sm)] text-xs text-popover-foreground shadow-md',
            className
          )}
          {...props}
        >
          {children}
        </BaseTooltip.Popup>
      </BaseTooltip.Positioner>
    </BaseTooltip.Portal>
  )
);
TooltipContent.displayName = 'TooltipContent';

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
