import { Check, Loader2, X } from 'lucide-react';
import * as React from 'react';
import { cn } from '../../lib/utils';

export type ButtonVariant =
  | 'default'
  | 'destructive'
  | 'outline'
  | 'secondary'
  | 'ghost'
  | 'link'
  | 'success'
  | 'warning'
  | 'info'
  | 'outline-success'
  | 'outline-warning'
  | 'outline-destructive'
  | 'option'
  | 'option-active';

export type ButtonSize = 'default' | 'sm' | 'lg' | 'icon' | 'circle';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  success?: boolean;
  error?: boolean;
  icon?: React.ElementType;
  maxLabelLength?: number;
}

const variantClassName: Record<ButtonVariant, string> = {
  default: 'bg-primary text-primary-foreground shadow hover:bg-primary/90',
  destructive: 'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90',
  outline:
    'border border-input bg-transparent text-foreground shadow-sm hover:bg-accent hover:text-accent-foreground',
  secondary: 'bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80',
  ghost: 'hover:bg-accent hover:text-accent-foreground',
  link: 'h-auto p-0 text-primary underline underline-offset-4 hover:text-primary/80',
  success: 'bg-success text-success-foreground shadow-sm hover:bg-success/90',
  warning: 'bg-warning text-warning-foreground shadow-sm hover:bg-warning/90',
  info: 'bg-info text-info-text shadow-sm hover:bg-info/90',
  'outline-success': 'border border-success text-success hover:bg-success/10',
  'outline-warning': 'border border-warning text-warning hover:bg-warning/10',
  'outline-destructive': 'border border-destructive text-destructive hover:bg-destructive/10',
  option: 'border border-input bg-background text-foreground shadow-none hover:bg-accent/30',
  'option-active':
    'border-2 border-primary bg-primary/10 text-foreground shadow-none hover:bg-primary/20',
};

const sizeClassName: Record<ButtonSize, string> = {
  default: 'h-ui min-h-ui-touch px-ui-button py-ui-button text-ui',
  sm: 'h-8 rounded-md px-3 text-xs',
  lg: 'h-10 rounded-md px-8',
  icon: 'h-ui min-h-ui-touch w-[var(--ui-component-height)] min-w-[var(--ui-touch-target-min)]',
  circle: 'h-8 w-8 rounded-full p-0',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'default',
      size = 'default',
      children,
      loading = false,
      success = false,
      error = false,
      icon: Icon,
      disabled,
      maxLabelLength = 14,
      type = 'button',
      ...props
    },
    ref
  ) => {
    const finalVariant = success ? 'success' : error ? 'destructive' : variant;
    const stateDisabled = disabled || loading || success || error;
    const truncatedLabel =
      typeof children === 'string' && children.length > maxLabelLength
        ? `${children.slice(0, Math.max(0, maxLabelLength - 1))}...`
        : children;
    const isTruncated =
      typeof children === 'string' &&
      typeof truncatedLabel === 'string' &&
      truncatedLabel !== children;

    const content = loading ? (
      <Loader2 className="h-4 w-4 animate-spin" />
    ) : success ? (
      <Check className="h-4 w-4" />
    ) : error ? (
      <X className="h-4 w-4" />
    ) : (
      <span className="flex min-w-0 items-center">
        {Icon ? <Icon className={cn('mr-2 h-4 w-4', !children && 'mr-0')} /> : null}
        {typeof children === 'string' ? (
          <span
            className="min-w-0 flex-1 whitespace-nowrap"
            title={isTruncated ? children : undefined}
          >
            {truncatedLabel}
          </span>
        ) : (
          children
        )}
      </span>
    );

    return (
      <button
        ref={ref}
        type={type}
        disabled={stateDisabled}
        className={cn(
          'inline-flex min-w-0 cursor-pointer items-center justify-center overflow-hidden whitespace-nowrap rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
          variantClassName[finalVariant],
          sizeClassName[size],
          className
        )}
        {...props}
      >
        {content}
      </button>
    );
  }
);

Button.displayName = 'Button';
