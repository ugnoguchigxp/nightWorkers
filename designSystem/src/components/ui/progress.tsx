import { Progress as BaseProgress } from '@base-ui/react/progress';
import * as React from 'react';

import { cn } from '../../lib/utils';

const Progress = React.forwardRef<HTMLDivElement, React.ComponentProps<typeof BaseProgress.Root>>(
  ({ className, value, ...props }, ref) => {
    const clamped = typeof value === 'number' ? Math.min(100, Math.max(0, value)) : 0;

    return (
      <BaseProgress.Root
        ref={ref}
        value={value}
        className={cn('relative h-2 w-full overflow-hidden rounded-full bg-muted', className)}
        {...props}
      >
        <BaseProgress.Track className="h-full w-full">
          <BaseProgress.Indicator
            className="h-full w-full bg-primary transition-transform"
            style={{ transform: `translateX(-${100 - clamped}%)` }}
          />
        </BaseProgress.Track>
      </BaseProgress.Root>
    );
  }
);
Progress.displayName = 'Progress';

export { Progress };
