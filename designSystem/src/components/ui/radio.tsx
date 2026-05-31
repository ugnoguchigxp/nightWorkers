import { Radio as BaseRadio } from '@base-ui/react/radio';
import * as React from 'react';

import { cn } from '../../lib/utils';

const Radio = React.forwardRef<HTMLElement, React.ComponentProps<typeof BaseRadio.Root>>(
  ({ className, ...props }, ref) => (
    <BaseRadio.Root
      ref={ref}
      className={cn(
        'relative aspect-square h-4 w-4 rounded-full border border-input text-primary shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring data-[checked]:border-primary data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
        className
      )}
      {...props}
    >
      <BaseRadio.Indicator className="absolute inset-0 flex items-center justify-center">
        <span className="h-2 w-2 rounded-full bg-current" />
      </BaseRadio.Indicator>
    </BaseRadio.Root>
  )
);
Radio.displayName = 'Radio';

export { Radio };
