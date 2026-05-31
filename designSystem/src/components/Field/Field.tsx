'use client';

import { Field as BaseField } from '@base-ui/react';
import * as React from 'react';
import { cn } from '@/utils/cn';

const Field = React.forwardRef<
  React.ElementRef<typeof BaseField.Root>,
  React.ComponentPropsWithoutRef<typeof BaseField.Root> & {
    orientation?: 'horizontal' | 'vertical';
    variant?: 'default' | 'inline';
    align?: 'start' | 'center' | 'endpoint' | 'baseline';
  }
>(({ className, orientation = 'vertical', variant = 'default', align, ...props }, ref) => {
  // Default alignment depends on variant if not specified
  const defaultAlign = variant === 'inline' ? 'baseline' : undefined;
  const finalAlign = align || defaultAlign;

  return (
    <BaseField.Root
      ref={ref}
      className={cn(
        'flex w-full gap-[var(--ui-gap-base,0.5rem)]',
        orientation === 'vertical' && variant === 'default' && 'flex-col',
        orientation === 'horizontal' && 'flex-row items-center justify-between',
        variant === 'inline' && 'flex-row gap-[var(--ui-gap-base,0.5rem)]',
        // Apply alignment classes
        finalAlign === 'start' && 'items-start',
        finalAlign === 'center' && 'items-center',
        finalAlign === 'baseline' && 'items-baseline',
        finalAlign === 'endpoint' && 'items-end',
        className
      )}
      {...props}
    />
  );
});
Field.displayName = 'Field';

const FieldLabel = React.forwardRef<
  React.ElementRef<typeof BaseField.Label>,
  React.ComponentPropsWithoutRef<typeof BaseField.Label> & {
    nowrap?: boolean;
  }
>(({ className, nowrap, ...props }, ref) => (
  <BaseField.Label
    ref={ref}
    className={cn(
      'text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
      nowrap && 'whitespace-nowrap',
      className
    )}
    {...props}
  />
));
FieldLabel.displayName = 'FieldLabel';

const FieldDescription = React.forwardRef<
  React.ElementRef<typeof BaseField.Description>,
  React.ComponentPropsWithoutRef<typeof BaseField.Description>
>(({ className, ...props }, ref) => (
  <BaseField.Description
    ref={ref}
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
));
FieldDescription.displayName = 'FieldDescription';

const FieldError = React.forwardRef<
  React.ElementRef<typeof BaseField.Error>,
  React.ComponentPropsWithoutRef<typeof BaseField.Error>
>(({ className, ...props }, ref) => (
  <BaseField.Error
    ref={ref}
    className={cn('text-sm font-medium text-destructive', className)}
    {...props}
  />
));
FieldError.displayName = 'FieldError';

// Helper components for layout
const FieldGroup = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex flex-col gap-[var(--ui-gap-base,0.5rem)]', className)}
      {...props}
    />
  )
);
FieldGroup.displayName = 'FieldGroup';

const FieldContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('space-y-[var(--ui-gap-base,0.5rem)]', className)} {...props} />
  )
);
FieldContent.displayName = 'FieldContent';

export { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel };
