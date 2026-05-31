import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '../../lib/utils';

const alertVariants = cva(
  'relative w-full rounded-[6px] border p-4 text-sm shadow-[0_1px_4px_rgba(0,0,0,0.08)] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg+div]:translate-y-[-3px] [&:has(svg)]:pl-11',
  {
    variants: {
      variant: {
        default: 'border-border bg-secondary text-foreground [&>svg]:text-foreground',
        destructive:
          'border-destructive bg-[hsl(0_100%_97%)] text-destructive [&>svg]:text-destructive',
        success:
          'border-success bg-[hsl(142_60%_96%)] text-[hsl(142_71%_35%)] [&>svg]:text-[hsl(142_71%_35%)]',
        warning:
          'border-warning bg-[hsl(35_100%_96%)] text-[hsl(35_100%_35%)] [&>svg]:text-[hsl(35_100%_35%)]',
        info: 'border-info bg-[hsl(199_89%_96%)] text-[hsl(199_89%_38%)] [&>svg]:text-[hsl(199_89%_38%)]',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div ref={ref} role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
));
Alert.displayName = 'Alert';

const AlertTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h5
      ref={ref}
      className={cn('mb-1 font-medium leading-none tracking-tight', className)}
      {...props}
    />
  )
);
AlertTitle.displayName = 'AlertTitle';

const AlertDescription = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('text-sm text-muted-foreground [&_p]:leading-relaxed', className)}
      {...props}
    />
  )
);
AlertDescription.displayName = 'AlertDescription';

export { Alert, AlertDescription, AlertTitle };
