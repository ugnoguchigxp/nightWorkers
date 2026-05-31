import { Switch as BaseSwitch } from '@base-ui/react/switch';
import * as React from 'react';

import { cn } from '../../lib/utils';

const Switch = React.forwardRef<HTMLElement, React.ComponentProps<typeof BaseSwitch.Root>>(
  ({ className, ...props }, ref) => (
    <BaseSwitch.Root
      ref={ref}
      className={cn(
        'inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-input bg-input p-0.5 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring data-[checked]:bg-primary data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
        className
      )}
      {...props}
    >
      <BaseSwitch.Thumb className="block h-4 w-4 rounded-full bg-background shadow-sm transition-transform data-[checked]:translate-x-4 data-[unchecked]:translate-x-0" />
    </BaseSwitch.Root>
  )
);
Switch.displayName = 'Switch';

export { Switch };
