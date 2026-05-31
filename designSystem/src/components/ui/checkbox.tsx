import { Checkbox } from '@base-ui/react/checkbox';
import { Check } from 'lucide-react';
import * as React from 'react';

import { cn } from '../../lib/utils';

const CheckboxComponent = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<typeof Checkbox.Root>
>(({ className, ...props }, ref) => (
  <Checkbox.Root
    ref={ref}
    className={cn(
      'peer h-4 w-4 shrink-0 rounded border border-input bg-background shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[checked]:border-primary data-[checked]:bg-primary data-[checked]:text-primary-foreground',
      className
    )}
    {...props}
  >
    <Checkbox.Indicator className={cn('flex items-center justify-center text-current')}>
      <Check className="h-3 w-3" />
    </Checkbox.Indicator>
  </Checkbox.Root>
));
CheckboxComponent.displayName = 'Checkbox';

export { CheckboxComponent as Checkbox };
