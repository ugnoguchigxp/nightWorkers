import { Button as BaseButton } from '@base-ui/react/button';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-[var(--spacing-sm)] whitespace-nowrap rounded-[var(--radius-md)] text-[var(--font-size-sm)] font-semibold tracking-tight leading-5 transition-all duration-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-5 [&_svg]:shrink-0 active:scale-95',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90',
        secondary: 'bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80',
        destructive: 'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90',
        success: 'bg-success text-success-foreground shadow-sm hover:bg-success/90',
        warning: 'bg-warning text-warning-foreground shadow-sm hover:bg-warning/90',
        info: 'bg-info text-info-foreground shadow-sm hover:bg-info/90',
        outline:
          'border border-border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground',
        ghost:
          'text-foreground hover:bg-secondary hover:text-secondary-foreground active:bg-border',
        link: 'text-primary underline-offset-4 hover:underline active:opacity-70',
      },
      size: {
        default: 'h-[var(--control-height-md)] px-[var(--control-px-md)] py-[var(--control-py-md)]',
        sm: 'h-[var(--control-height-sm)] px-[var(--control-px-sm)] text-xs [&_svg]:size-4',
        lg: 'h-[var(--control-height-lg)] px-[var(--control-px-lg)] [&_svg]:size-6',
        icon: 'h-[var(--control-size-icon)] w-[var(--control-size-icon)] p-[var(--control-py-sm)]',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ComponentPropsWithoutRef<typeof BaseButton>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <BaseButton
        ref={ref}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
