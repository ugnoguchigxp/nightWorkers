import { Radio } from '@base-ui/react/radio';
import { RadioGroup as BaseRadioGroup } from '@base-ui/react/radio-group';
import * as React from 'react';

import { cn } from '../../lib/utils';

const RadioGroup = React.forwardRef<HTMLDivElement, React.ComponentProps<typeof BaseRadioGroup>>(
  ({ className, ...props }, ref) => (
    <BaseRadioGroup ref={ref} className={cn('grid gap-2', className)} {...props} />
  )
);
RadioGroup.displayName = 'RadioGroup';

const RadioGroupItem = React.forwardRef<HTMLElement, React.ComponentProps<typeof Radio.Root>>(
  ({ className, ...props }, ref) => (
    <Radio.Root
      ref={ref}
      className={cn(
        'relative aspect-square h-4 w-4 rounded-full border border-input text-primary shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring data-[checked]:border-primary data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
        className
      )}
      {...props}
    >
      <Radio.Indicator className="absolute inset-0 flex items-center justify-center">
        <span className="h-2 w-2 rounded-full bg-current" />
      </Radio.Indicator>
    </Radio.Root>
  )
);
RadioGroupItem.displayName = 'RadioGroupItem';

export { RadioGroup, RadioGroupItem };
