import * as React from 'react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/Tooltip/Tooltip';
import { TreeMenu, type TreeMenuItem } from '@/components/TreeMenu/TreeMenu';
import { cn } from '@/utils/cn';

export interface IconTreeMenuSection extends Omit<TreeMenuItem, 'children'> {
  tooltip?: React.ReactNode;
  children?: TreeMenuItem[];
  path?: string;
}

export interface IconTreeMenuProps {
  title?: string;
  sections?: IconTreeMenuSection[];
  sectionId?: string;
  defaultSectionId?: string;
  onSectionChange?: (sectionId: string, section: IconTreeMenuSection) => void;
  onSectionNavigate?: (path: string, section: IconTreeMenuSection) => void;
  selectedId?: string;
  onSelect?: (id: string, item: TreeMenuItem, section: IconTreeMenuSection) => void;
  defaultExpandedIds?: string[];
  expandedIds?: string[];
  onExpandedChange?: (expandedIds: string[], section: IconTreeMenuSection) => void;
  showCloseButton?: boolean;
  onCloseMenu?: () => void;
  hideControlBar?: boolean;
  hideExpandCollapseButtons?: boolean;
  showSectionNameAsTitle?: boolean;
  emptyText?: string;
  leafSectionText?: string;
  hidePanelWhenNoChildren?: boolean;
  railAriaLabel?: string;
  className?: string;
  railClassName?: string;
  contentClassName?: string;
}

const getFirstEnabledSectionId = (
  sections: IconTreeMenuSection[] | undefined
): string | undefined => {
  return sections?.find((section) => !section.disabled)?.id;
};

const nodeToText = (node: React.ReactNode, fallback: string): string | undefined => {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  return fallback;
};

export const IconTreeMenu: React.FC<IconTreeMenuProps> = ({
  title,
  sections,
  sectionId,
  defaultSectionId,
  onSectionChange,
  onSectionNavigate,
  selectedId,
  onSelect,
  defaultExpandedIds,
  expandedIds,
  onExpandedChange,
  showCloseButton = false,
  onCloseMenu,
  hideControlBar = false,
  hideExpandCollapseButtons = false,
  showSectionNameAsTitle = false,
  emptyText = 'Menu sections not provided.',
  leafSectionText = 'This section has no submenu.',
  hidePanelWhenNoChildren = true,
  railAriaLabel = 'Section menu',
  className,
  railClassName,
  contentClassName,
}) => {
  const firstSectionId = React.useMemo(() => getFirstEnabledSectionId(sections), [sections]);
  const [uncontrolledSectionId, setUncontrolledSectionId] = React.useState<string | undefined>(
    defaultSectionId ?? firstSectionId
  );

  const isSectionControlled = sectionId !== undefined;
  const activeSectionId = isSectionControlled ? sectionId : uncontrolledSectionId;
  const activeSection = React.useMemo(
    () => sections?.find((section) => section.id === activeSectionId),
    [sections, activeSectionId]
  );

  React.useEffect(() => {
    if (isSectionControlled) return;
    if (!sections || sections.length === 0) {
      setUncontrolledSectionId(undefined);
      return;
    }

    const isCurrentEnabled = sections.some(
      (section) => !section.disabled && section.id === uncontrolledSectionId
    );
    if (isCurrentEnabled) return;

    const nextSectionId =
      defaultSectionId &&
      sections.some((section) => !section.disabled && section.id === defaultSectionId)
        ? defaultSectionId
        : getFirstEnabledSectionId(sections);

    setUncontrolledSectionId(nextSectionId);
  }, [defaultSectionId, isSectionControlled, sections, uncontrolledSectionId]);

  const handleSectionChange = React.useCallback(
    (section: IconTreeMenuSection) => {
      if (section.disabled) return;
      if (!isSectionControlled) setUncontrolledSectionId(section.id);
      onSectionChange?.(section.id, section);
      if (!section.children?.length && section.path) {
        onSectionNavigate?.(section.path, section);
      }
    },
    [isSectionControlled, onSectionChange, onSectionNavigate]
  );

  const sectionWithTree = activeSection?.children?.length ? activeSection : undefined;
  const treeMenuTitle = showSectionNameAsTitle
    ? nodeToText(sectionWithTree?.label, 'Menu')
    : (title ?? nodeToText(sectionWithTree?.label, 'Menu'));
  const shouldShowContentPanel =
    !hidePanelWhenNoChildren || !activeSection || Boolean(sectionWithTree);

  return (
    <div
      className={cn(
        'w-full h-full min-h-0 flex overflow-hidden rounded-md border border-border bg-card',
        className
      )}
    >
      <TooltipProvider delay={0}>
        <nav
          aria-label={railAriaLabel}
          className={cn(
            'w-14 shrink-0 border-e border-border bg-muted/30 p-2 flex flex-col gap-1',
            railClassName
          )}
        >
          {(sections ?? []).map((section) => {
            const tooltipContent = section.tooltip ?? section.label ?? section.id;
            const tooltipText = nodeToText(tooltipContent, section.id);
            const isActive = activeSection?.id === section.id;

            return (
              <Tooltip key={section.id}>
                <TooltipTrigger
                  type="button"
                  disabled={section.disabled}
                  onClick={() => handleSectionChange(section)}
                  aria-label={tooltipText}
                  className={cn(
                    'relative h-10 w-10 rounded-md flex items-center justify-center transition-colors',
                    section.disabled && 'opacity-40 cursor-not-allowed pointer-events-none',
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-primary/15 hover:text-foreground'
                  )}
                >
                  <span className="flex items-center justify-center">{section.icon}</span>
                  {section.badge !== undefined && (
                    <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] leading-4 text-center">
                      {section.badge}
                    </span>
                  )}
                </TooltipTrigger>
                <TooltipContent side="right" align="center">
                  {tooltipContent}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </nav>
      </TooltipProvider>

      {shouldShowContentPanel && (
        <div className={cn('flex-1 min-w-0 min-h-0 bg-background', contentClassName)}>
          {sectionWithTree ? (
            <TreeMenu
              key={sectionWithTree.id}
              title={treeMenuTitle}
              items={sectionWithTree.children}
              selectedId={selectedId}
              onSelect={(id, item) => onSelect?.(id, item, sectionWithTree)}
              defaultExpandedIds={defaultExpandedIds}
              expandedIds={expandedIds}
              onExpandedChange={(nextExpandedIds) =>
                onExpandedChange?.(nextExpandedIds, sectionWithTree)
              }
              showCloseButton={showCloseButton}
              onCloseMenu={onCloseMenu}
              hideControlBar={hideControlBar}
              hideExpandCollapseButtons={hideExpandCollapseButtons}
            />
          ) : activeSection ? (
            <div className="h-full w-full px-4 flex items-center justify-center text-xs text-muted-foreground">
              {leafSectionText}
            </div>
          ) : (
            <div className="h-full w-full px-4 flex items-center justify-center text-xs text-muted-foreground">
              {emptyText}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default IconTreeMenu;
