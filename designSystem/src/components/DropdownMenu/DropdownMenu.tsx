import { Menu } from '@base-ui/react';
import * as React from 'react';
import { ScrollArea } from '../ScrollArea';

export interface IDropdownMenuItem {
  label: string;
  onClick: () => void;
  icon?: React.ReactNode;
}

export interface IDropdownMenuProps {
  trigger: React.ReactNode;
  items: IDropdownMenuItem[];
  /**
   * Preferred horizontal alignment.
   */
  align?: 'start' | 'center' | 'end' | 'left' | 'right';
  /**
   * Preferred vertical side.
   */
  side?: 'bottom' | 'top' | 'left' | 'right';
  /**
   * Distance in pixels between trigger and menu.
   * Default: 8
   */
  offset?: number;
  /**
   * Maximum height of the menu content.
   * If specified, a scrollbar will appear if content exceeds this height.
   */
  maxHeight?: number | string;
  /**
   * Number of items to show before scrolling.
   * Default: 5 (if maxHeight is not specified)
   */
  visibleItemCount?: number;
  className?: string;
}

/**
 * ドロップダウンメニュー
 */
export const DropdownMenu: React.FC<IDropdownMenuProps> = React.memo(
  ({
    trigger,
    items,
    align = 'start',
    side = 'bottom',
    offset = 8,
    maxHeight,
    visibleItemCount = 5,
    className = '',
  }) => {
    const alignValue = align === 'left' ? 'start' : align === 'right' ? 'end' : align;

    const calculatedMaxHeight = React.useMemo(() => {
      if (maxHeight) return maxHeight;
      if (visibleItemCount) {
        return `calc(var(--ui-list-row-height, 2.5rem) * ${visibleItemCount} + var(--ui-component-padding-y, 0.5rem) * 2)`;
      }
      return undefined;
    }, [maxHeight, visibleItemCount]);

    return (
      <Menu.Root>
        <Menu.Trigger render={trigger as any} className={className} />
        <Menu.Portal>
          <Menu.Positioner sideOffset={offset} align={alignValue} side={side}>
            <Menu.Popup
              data-gxp-portal="true"
              data-gxp-top-layer="true"
              className="z-portal min-w-[160px] overflow-hidden rounded-[var(--radius,0.5rem)] border border-border bg-background shadow-lg outline-none data-[open]:animate-in data-[closed]:animate-out data-[closed]:fade-out-0 data-[open]:fade-in-0 data-[closed]:zoom-out-95 data-[open]:zoom-in-95"
            >
              <ScrollArea
                className="py-[var(--ui-component-padding-y)]"
                style={{ maxHeight: calculatedMaxHeight }}
              >
                {items.map((item) => (
                  <Menu.Item
                    key={item.label}
                    onClick={() => {
                      item.onClick();
                    }}
                    className="flex w-full cursor-default select-none items-center gap-ui px-ui text-left text-ui text-foreground hover:bg-accent focus:bg-accent focus:outline-none min-h-[var(--ui-list-row-height)] data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
                  >
                    {item.icon && <span className="text-muted-foreground">{item.icon}</span>}
                    <span>{item.label}</span>
                  </Menu.Item>
                ))}
              </ScrollArea>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    );
  }
);

DropdownMenu.displayName = 'DropdownMenu';
export default DropdownMenu;
