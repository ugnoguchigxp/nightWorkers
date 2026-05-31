import { Separator as BaseSeparator } from '@base-ui/react/separator';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '../../lib/utils';

const separatorVariants = cva('shrink-0', {
  variants: {
    variant: {
      default: 'bg-border',
      muted: 'bg-muted-foreground/20',
      strong: 'bg-foreground/30',
      accent: 'bg-primary/40',
    },
    thickness: {
      '1': '',
      '2': '',
      '4': '',
    },
    gradient: {
      true: 'bg-transparent',
      false: '',
    },
    orientation: {
      horizontal: 'w-full',
      vertical: 'h-full',
    },
  },
  compoundVariants: [
    // Horizontal + Thickness
    { orientation: 'horizontal', thickness: '1', className: 'h-[1px]' },
    { orientation: 'horizontal', thickness: '2', className: 'h-[2px]' },
    { orientation: 'horizontal', thickness: '4', className: 'h-[4px]' },
    // Vertical + Thickness
    { orientation: 'vertical', thickness: '1', className: 'w-[1px]' },
    { orientation: 'vertical', thickness: '2', className: 'w-[2px]' },
    { orientation: 'vertical', thickness: '4', className: 'w-[4px]' },
    // Gradient (Decorative) - Horizontal
    {
      orientation: 'horizontal',
      gradient: true,
      variant: 'default',
      className: 'bg-gradient-to-r from-transparent via-border to-transparent',
    },
    {
      orientation: 'horizontal',
      gradient: true,
      variant: 'muted',
      className: 'bg-gradient-to-r from-transparent via-muted-foreground/30 to-transparent',
    },
    {
      orientation: 'horizontal',
      gradient: true,
      variant: 'strong',
      className: 'bg-gradient-to-r from-transparent via-foreground/30 to-transparent',
    },
    {
      orientation: 'horizontal',
      gradient: true,
      variant: 'accent',
      className: 'bg-gradient-to-r from-transparent via-primary/50 to-transparent',
    },
    // Gradient (Decorative) - Vertical
    {
      orientation: 'vertical',
      gradient: true,
      variant: 'default',
      className: 'bg-gradient-to-b from-transparent via-border to-transparent',
    },
    {
      orientation: 'vertical',
      gradient: true,
      variant: 'muted',
      className: 'bg-gradient-to-b from-transparent via-muted-foreground/30 to-transparent',
    },
    {
      orientation: 'vertical',
      gradient: true,
      variant: 'strong',
      className: 'bg-gradient-to-b from-transparent via-foreground/30 to-transparent',
    },
    {
      orientation: 'vertical',
      gradient: true,
      variant: 'accent',
      className: 'bg-gradient-to-b from-transparent via-primary/50 to-transparent',
    },
  ],
  defaultVariants: {
    variant: 'default',
    thickness: '1',
    gradient: false,
    orientation: 'horizontal',
  },
});

export interface SeparatorProps
  extends Omit<React.ComponentPropsWithoutRef<typeof BaseSeparator>, 'orientation'>,
    VariantProps<typeof separatorVariants> {}

const Separator = React.forwardRef<HTMLDivElement, SeparatorProps>(
  ({ className, orientation = 'horizontal', variant, thickness, gradient, ...props }, ref) => (
    <BaseSeparator
      ref={ref}
      orientation={orientation as 'horizontal' | 'vertical'}
      className={cn(
        separatorVariants({
          variant,
          thickness,
          gradient,
          orientation,
          className,
        })
      )}
      {...props}
    />
  )
);
Separator.displayName = 'Separator';

export { Separator };
