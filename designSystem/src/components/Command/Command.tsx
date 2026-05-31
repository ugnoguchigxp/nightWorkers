'use client';

import { Command as CommandPrimitive } from 'cmdk';
import { Search } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/utils/cn';

const CommandContext = React.createContext<{
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  isDropdown: boolean;
}>({
  isOpen: false,
  setIsOpen: () => {},
  isDropdown: false,
});

interface CommandProps extends React.ComponentPropsWithoutRef<typeof CommandPrimitive> {
  isDropdown?: boolean;
}

const Command = React.forwardRef<React.ElementRef<typeof CommandPrimitive>, CommandProps>(
  ({ className, isDropdown = false, ...props }, ref) => {
    const [isOpen, setIsOpen] = React.useState(false);

    return (
      <CommandContext.Provider value={{ isOpen, setIsOpen, isDropdown }}>
        <CommandPrimitive
          ref={ref}
          onFocus={() => isDropdown && setIsOpen(true)}
          onBlur={(e) => {
            // Check if focus is moving to an item within the command list
            if (isDropdown && !e.currentTarget.contains(e.relatedTarget)) {
              setIsOpen(false);
            }
          }}
          className={cn(
            'flex w-full flex-col overflow-hidden rounded-[var(--radius,0.5rem)] bg-popover text-popover-foreground',
            !isDropdown && 'h-full',
            isDropdown && 'relative overflow-visible',
            className
          )}
          {...props}
        />
      </CommandContext.Provider>
    );
  }
);
Command.displayName = CommandPrimitive.displayName;

const CommandInput = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Input>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input>
>(({ className, ...props }, ref) => {
  const { isDropdown, setIsOpen } = React.useContext(CommandContext);

  return (
    <div
      className={cn('flex items-center border-b px-3 h-ui', isDropdown && 'border-none')}
      cmr-input-wrapper=""
    >
      <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
      <CommandPrimitive.Input
        ref={ref}
        onFocus={() => isDropdown && setIsOpen(true)}
        className={cn(
          'flex w-full rounded-md bg-transparent py-3 text-ui outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        {...props}
      />
    </div>
  );
});
CommandInput.displayName = CommandPrimitive.Input.displayName;

const CommandList = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ className, ...props }, ref) => {
  const { isOpen, isDropdown } = React.useContext(CommandContext);

  if (isDropdown && !isOpen) return null;

  return (
    <CommandPrimitive.List
      ref={ref}
      className={cn(
        'max-h-[300px] overflow-y-auto overflow-x-hidden',
        isDropdown &&
          'absolute top-full left-0 z-portal w-full mt-1 rounded-md border bg-popover shadow-md animate-in fade-in-0 zoom-in-95',
        className
      )}
      {...props}
    />
  );
});
CommandList.displayName = CommandPrimitive.List.displayName;

const CommandEmpty = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Empty>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>((props, ref) => (
  <CommandPrimitive.Empty ref={ref} className="py-6 text-center text-sm" {...props} />
));
CommandEmpty.displayName = CommandPrimitive.Empty.displayName;

const CommandGroup = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Group>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Group>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Group
    ref={ref}
    className={cn(
      'overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground',
      className
    )}
    {...props}
  />
));
CommandGroup.displayName = CommandPrimitive.Group.displayName;

const CommandSeparator = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Separator
    ref={ref}
    className={cn('-mx-1 h-px bg-border', className)}
    {...props}
  />
));
CommandSeparator.displayName = CommandPrimitive.Separator.displayName;

const CommandItem = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(({ className, onSelect, ...props }, ref) => {
  const { setIsOpen, isDropdown } = React.useContext(CommandContext);

  return (
    <CommandPrimitive.Item
      ref={ref}
      onSelect={(value) => {
        onSelect?.(value);
        if (isDropdown) setIsOpen(false);
      }}
      className={cn(
        'relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-ui outline-none data-[disabled=true]:pointer-events-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground data-[disabled=true]:opacity-50 h-ui gap-2',
        className
      )}
      {...props}
    />
  );
});
CommandItem.displayName = CommandPrimitive.Item.displayName;

const CommandShortcut = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => {
  return (
    <span
      className={cn('ml-auto text-xs tracking-widest text-muted-foreground', className)}
      {...props}
    />
  );
};
CommandShortcut.displayName = 'CommandShortcut';

export {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
};
