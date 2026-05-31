import type { FileTreeItem } from './FileTree';

/**
 * Helper to find the container (parent array) AND the parent item of an ID
 */
export function findContainerInfo(
  id: string,
  items: FileTreeItem[]
): { container: FileTreeItem[]; parentItem: FileTreeItem | null } | undefined {
  if (items.find((i) => i.id === id)) {
    return { container: items, parentItem: null };
  }

  for (const item of items) {
    if (item.items) {
      const found = findContainerInfo(id, item.items);
      if (found) {
        if (found.parentItem === null) {
          return { ...found, parentItem: item };
        }
        return found;
      }
    }
  }
  return undefined;
}

/**
 * Helper to find an item by ID
 */
export function findItem(items: FileTreeItem[], id: string): FileTreeItem | undefined {
  for (const item of items) {
    if (item.id === id) return item;
    if (item.items) {
      const found = findItem(item.items, id);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Helper to find and remove an item from a list recursively
 */
export function findAndRemove(list: FileTreeItem[], id: string): FileTreeItem | null {
  const idx = list.findIndex((i) => i.id === id);
  if (idx !== -1) return list.splice(idx, 1)[0] as FileTreeItem;
  for (const i of list) {
    if (i.items) {
      const res = findAndRemove(i.items, id);
      if (res) return res;
    }
  }
  return null;
}
