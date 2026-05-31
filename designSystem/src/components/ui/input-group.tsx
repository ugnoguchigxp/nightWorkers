import * as React from 'react';

import { cn } from '../../lib/utils';
import { Label } from './label';

const InputGroup = React.forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('grid w-full gap-1.5', className)} {...props} />
  )
);
InputGroup.displayName = 'InputGroup';

const InputGroupLabel = React.forwardRef<HTMLLabelElement, React.ComponentProps<typeof Label>>(
  ({ className, ...props }, ref) => (
    <Label ref={ref} className={cn('text-sm font-medium', className)} {...props} />
  )
);
InputGroupLabel.displayName = 'InputGroupLabel';

export { InputGroup, InputGroupLabel };
