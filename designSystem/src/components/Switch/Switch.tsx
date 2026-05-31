'use client';

import { Switch as BaseSwitch } from '@base-ui/react';
import * as React from 'react';

import { cn } from '@/utils/cn';

const Switch = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof BaseSwitch.Root>
>(({ className, ...props }, ref) => (
  <BaseSwitch.Root
    className={cn(
      'peer inline-flex h-[var(--ui-switch-height)] w-[var(--ui-switch-width)] shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[checked]:bg-primary bg-input',
      className
    )}
    {...props}
    ref={ref}
  >
    <BaseSwitch.Thumb
      className={cn(
        'pointer-events-none block h-[var(--ui-switch-thumb-size)] w-[var(--ui-switch-thumb-size)] rounded-full bg-background shadow-lg ring-0 transition-transform data-[checked]:translate-x-[var(--ui-switch-thumb-translate)] translate-x-0'
      )}
    />
  </BaseSwitch.Root>
));
Switch.displayName = 'Switch';

export { Switch };
