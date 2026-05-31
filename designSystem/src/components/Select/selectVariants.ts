import { cva, type VariantProps } from 'class-variance-authority';

export const selectTriggerVariants = cva(
  [
    'inline-flex w-full items-center justify-between gap-2 whitespace-nowrap',
    'rounded-md',
    'border border-input',
    'bg-background text-foreground',
    'transition-[border-color,box-shadow,background-color,color] duration-150 ease-in-out',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
    'disabled:cursor-not-allowed disabled:opacity-50',
  ].join(' '),
  {
    variants: {
      variant: {
        default: '',
        outline: 'bg-transparent',
        ghost: 'bg-transparent border-transparent shadow-none',
      },
      size: {
        sm: 'min-h-8 rounded-md px-3 py-1 text-xs',
        md: 'h-ui px-ui text-ui min-h-ui-touch',
        lg: 'h-12 px-5 py-3 text-lg',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  }
);

export const selectItemVariants = cva(
  [
    'relative flex w-full select-none items-center',
    'outline-none',
    'transition-colors duration-150',
    'focus:bg-accent focus:text-accent-foreground',
    'data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground',
    'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
  ].join(' '),
  {
    variants: {
      indicator: {
        none: '',
        check: '',
      },
      size: {
        sm: 'min-h-8 py-1 text-xs',
        md: 'min-h-[2.25rem] py-1.5 text-ui',
        lg: 'min-h-12 py-3 text-lg',
      },
      padding: {
        plain: 'px-3',
        withIndicator: 'pl-3 pr-8',
      },
    },
    defaultVariants: {
      size: 'md',
      indicator: 'none',
      padding: 'withIndicator',
    },
  }
);

export type SelectTriggerVariants = VariantProps<typeof selectTriggerVariants>;
export type SelectItemVariants = VariantProps<typeof selectItemVariants>;
