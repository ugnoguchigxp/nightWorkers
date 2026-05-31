import { Avatar as BaseAvatar } from '@base-ui/react/avatar';
import * as React from 'react';

import { cn } from '../../lib/utils';

const Avatar = React.forwardRef<HTMLSpanElement, React.ComponentProps<typeof BaseAvatar.Root>>(
  ({ className, ...props }, ref) => (
    <BaseAvatar.Root
      ref={ref}
      className={cn(
        'relative flex h-[var(--control-height-lg)] w-[var(--control-height-lg)] shrink-0 overflow-hidden rounded-full border border-border bg-muted',
        className
      )}
      {...props}
    />
  )
);
Avatar.displayName = 'Avatar';

const AvatarImage = React.forwardRef<
  HTMLImageElement,
  React.ComponentProps<typeof BaseAvatar.Image>
>(({ className, ...props }, ref) => (
  <BaseAvatar.Image
    ref={ref}
    className={cn('aspect-square h-full w-full object-cover', className)}
    {...props}
  />
));
AvatarImage.displayName = 'AvatarImage';

const AvatarFallback = React.forwardRef<
  HTMLSpanElement,
  React.ComponentProps<typeof BaseAvatar.Fallback>
>(({ className, ...props }, ref) => (
  <BaseAvatar.Fallback
    ref={ref}
    className={cn(
      'flex h-full w-full items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground',
      className
    )}
    {...props}
  />
));
AvatarFallback.displayName = 'AvatarFallback';

export { Avatar, AvatarFallback, AvatarImage };
