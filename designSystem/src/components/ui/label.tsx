import * as React from 'react';

import { cn } from '../../lib/utils';

const Label = React.forwardRef<HTMLLabelElement, React.ComponentProps<'label'>>(
  ({ className, ...props }, ref) => (
    // biome-ignore lint/a11y/noLabelWithoutControl: generic design-system label; association is provided by consumers via htmlFor or nesting.
    <label
      ref={ref}
      className={cn('text-sm font-medium leading-none text-foreground', className)}
      {...props}
    />
  )
);
Label.displayName = 'Label';

export { Label };
