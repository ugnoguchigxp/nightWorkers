/* istanbul ignore file */
import { Tabs } from '@base-ui/react';
import { ArrowLeft } from 'lucide-react';
import * as React from 'react';
import { AdaptiveText } from '@/components/AdaptiveText';
import { Button } from '@/components/Button';
import { cn } from '@/utils/cn';

const TabsRoot = Tabs.Root;

interface TabsListProps extends React.ComponentPropsWithoutRef<typeof Tabs.List> {
  onBack?: () => void;
  backButtonLabel?: string;
}

const TabsList = React.forwardRef<HTMLDivElement, TabsListProps>(
  ({ className, children, onBack, backButtonLabel, ...props }, ref) => (
    <Tabs.List
      ref={ref}
      className={cn(
        'inline-flex items-center justify-start rounded-[var(--radius,0.5rem)] bg-muted text-muted-foreground',
        'w-full p-1 h-auto',
        className
      )}
      {...props}
    >
      {onBack && (
        <Button
          variant="ghost"
          size="sm"
          className="mr-1 h-7 px-2 text-muted-foreground hover:text-foreground shrink-0"
          onClick={onBack}
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          {backButtonLabel || '戻る'}
        </Button>
      )}
      {children}
    </Tabs.List>
  )
);
TabsList.displayName = 'TabsList';

interface TabsTriggerProps extends React.ComponentPropsWithoutRef<typeof Tabs.Tab> {
  icon?: React.ElementType;
}

const TabsTrigger = React.forwardRef<HTMLButtonElement, TabsTriggerProps>(
  ({ className, children, icon: Icon, ...props }, ref) => (
    <Tabs.Tab
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded-[calc(var(--radius,0.5rem)-4px)] px-ui py-ui text-ui font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
        'data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm',
        'aria-selected:bg-background aria-selected:text-foreground aria-selected:shadow-sm',
        'flex-1 md:flex-none',
        className
      )}
      {...props}
    >
      {Icon && <Icon className="h-4 w-4 flex-shrink-0" />}
      {typeof children === 'string' ? (
        <AdaptiveText
          text={children.length > 10 ? `${children.slice(0, 10)}...` : children}
          className="flex-1 min-w-0 overflow-hidden"
          as="span"
        />
      ) : (
        children
      )}
    </Tabs.Tab>
  )
);
TabsTrigger.displayName = 'TabsTrigger';

const TabsContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof Tabs.Panel>
>(({ className, ...props }, ref) => (
  <Tabs.Panel
    ref={ref}
    className={cn(
      'mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      className
    )}
    {...props}
  />
));
TabsContent.displayName = 'TabsContent';

export { TabsContent, TabsList, TabsRoot as Tabs, TabsTrigger };
