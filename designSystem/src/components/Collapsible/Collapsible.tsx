import { Collapsible as BaseCollapsible } from '@base-ui/react';
import * as React from 'react';
import { cn } from '@/utils/cn';

const Collapsible = BaseCollapsible.Root;
const CollapsibleTrigger = BaseCollapsible.Trigger;

const CollapsibleContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof BaseCollapsible.Panel>
>(({ className, children, ...props }, ref) => (
  <BaseCollapsible.Panel
    ref={ref}
    keepMounted
    className={cn(
      'overflow-hidden data-[closed]:animate-accordion-up data-[open]:animate-accordion-down [&[hidden]]:block',
      className
    )}
    {...props}
  >
    {children}
  </BaseCollapsible.Panel>
));

CollapsibleContent.displayName = 'CollapsibleContent';

export { Collapsible, CollapsibleContent, CollapsibleTrigger };
