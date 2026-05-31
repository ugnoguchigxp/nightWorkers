'use client';

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronRightIcon, FileIcon, FolderIcon } from 'lucide-react';
import * as React from 'react';
import { cn } from '@/utils/cn';
import { Button } from '../Button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../Collapsible';
import { findAndRemove, findContainerInfo, findItem } from './FileTreeHelpers';

export type FileTreeItem = {
  id: string; // Unique ID is mandatory for DnD
  name: string;
  items?: FileTreeItem[]; // If present, it's a folder
};

interface FileTreeProps {
  items: FileTreeItem[];
  setItems: (items: FileTreeItem[]) => void;
}

// Recursive Tree Item Component
const SortableTreeItem = ({ item, level = 0 }: { item: FileTreeItem; level?: number }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    data: item,
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    paddingLeft: `${level * 1.25}rem`,
    opacity: isDragging ? 0.5 : 1,
    touchAction: 'none',
  };

  const [isOpen, setIsOpen] = React.useState(false);

  if (item.items) {
    // Folder
    return (
      <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
          <CollapsibleTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                className="group hover:bg-accent hover:text-accent-foreground w-full justify-start transition-none"
              >
                <ChevronRightIcon
                  className={cn('h-4 w-4 transition-transform', isOpen && 'rotate-90')}
                />
                <FolderIcon className="h-4 w-4 mr-2" />
                {item.name}
              </Button>
            }
          />
          <CollapsibleContent>
            <div className="flex flex-col gap-1">
              <SortableContext items={item.items} strategy={verticalListSortingStrategy}>
                {item.items.map((child) => (
                  <SortableTreeItem key={child.id} item={child} level={level + 1} />
                ))}
              </SortableContext>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    );
  }

  // File
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <Button variant="link" size="sm" className="text-foreground w-full justify-start gap-2 h-9">
        <FileIcon className="h-4 w-4" />
        <span>{item.name}</span>
      </Button>
    </div>
  );
};

export function FileTree({ items, setItems }: FileTreeProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        delay: 400,
        tolerance: 20,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeInfo = findContainerInfo(active.id as string, items);
    const overInfo = findContainerInfo(over.id as string, items);

    if (!activeInfo || !overInfo) return;

    // const activeContainer = activeInfo.container;
    const overItem = findItem(items, over.id as string);

    let nextContainerId: string | undefined;

    // Strategy:
    // 1. If dropping ON a folder, move INTO that folder.
    // 2. If dropping ON a file, move to that file's parent container (sibling).

    let targetIsFolder = false;

    if (overItem?.items) {
      // Dropping onto a folder -> Move into it
      targetIsFolder = true;
      nextContainerId = overItem.id;
    } else {
      // Dropping onto a file -> Move to its container
      targetIsFolder = false;
      // We identify the container by its parent item's ID, or 'root' if null
      nextContainerId = overInfo.parentItem ? overInfo.parentItem.id : 'root';
    }

    // Currently active container ID
    const activeContainerId = activeInfo.parentItem ? activeInfo.parentItem.id : 'root';

    if (activeContainerId !== nextContainerId) {
      const newItems = JSON.parse(JSON.stringify(items));

      const itemToMove = findAndRemove(newItems, active.id as string);

      if (itemToMove) {
        // 2. Insert into new
        let targetList: FileTreeItem[] | undefined;

        if (targetIsFolder) {
          // Insert into 'overItem' (which is a folder)
          const folder = findItem(newItems, over.id as string);
          if (folder) {
            if (!folder.items) folder.items = [];
            targetList = folder.items;
          }
        } else {
          // Insert into sibling container (overInfo.container)
          if (nextContainerId === 'root') {
            targetList = newItems;
          } else {
            // biome-ignore lint/style/noNonNullAssertion: Guaranteed by logic
            const parentFolder = findItem(newItems, nextContainerId!);
            if (parentFolder) {
              targetList = parentFolder.items;
            }
          }
        }

        if (targetList) {
          if (targetIsFolder) {
            // Append to folder
            targetList.push(itemToMove);
          } else {
            // Insert at specific index
            const idx = targetList.findIndex((x: any) => x.id === over.id);
            if (idx !== -1) {
              targetList.splice(idx, 0, itemToMove);
            } else {
              targetList.push(itemToMove);
            }
          }
          setItems(newItems);
        }
      }
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    const activeInfo = findContainerInfo(active.id as string, items);
    const overInfo = findContainerInfo(over.id as string, items);

    if (activeInfo && overInfo && activeInfo.container === overInfo.container) {
      const container = activeInfo.container;
      const oldIndex = container.findIndex((item) => item.id === active.id);
      const newIndex = container.findIndex((item) => item.id === over.id);

      if (oldIndex !== newIndex) {
        const newItems = [...items];
        // Recursive update for sorting within same container
        const updateRecursive = (currentItems: FileTreeItem[]): FileTreeItem[] => {
          if (currentItems.find((i) => i.id === active.id)) {
            return arrayMove(currentItems, oldIndex, newIndex);
          }
          return currentItems.map((item) => {
            if (item.items) {
              return {
                ...item,
                items: updateRecursive(item.items),
              };
            }
            return item;
          });
        };
        setItems(updateRecursive(newItems));
      }
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-1">
          {items.map((item) => (
            <SortableTreeItem key={item.id} item={item} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
