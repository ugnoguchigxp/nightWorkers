import * as React from 'react';

import { Button, type ButtonProps } from './button';

const IconButton = React.forwardRef<HTMLButtonElement, Omit<ButtonProps, 'size'>>(
  ({ variant = 'ghost', ...props }, ref) => (
    <Button ref={ref} variant={variant} size="icon" {...props} />
  )
);
IconButton.displayName = 'IconButton';

export { IconButton };
