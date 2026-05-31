import { describe, expect, it } from 'vitest';
import type { FileTreeItem } from './FileTree';
import { findAndRemove, findContainerInfo, findItem } from './FileTreeHelpers';

const testItems: FileTreeItem[] = [
  {
    id: '1',
    name: 'Folder 1',
    items: [
      { id: '1-1', name: 'File 1-1' },
      {
        id: '1-2',
        name: 'Folder 1-2',
        items: [{ id: '1-2-1', name: 'File 1-2-1' }],
      },
    ],
  },
  { id: '2', name: 'File 2' },
];

describe('FileTreeHelpers', () => {
  describe('findItem', () => {
    it('finds top-level item', () => {
      const item = findItem(testItems, '1');
      expect(item?.name).toBe('Folder 1');
    });

    it('finds nested item', () => {
      const item = findItem(testItems, '1-1');
      expect(item?.name).toBe('File 1-1');
    });

    it('finds deeply nested item', () => {
      const item = findItem(testItems, '1-2-1');
      expect(item?.name).toBe('File 1-2-1');
    });

    it('returns undefined for non-existent item', () => {
      const item = findItem(testItems, '999');
      expect(item).toBeUndefined();
    });
  });

  describe('findContainerInfo', () => {
    it('finds container for top-level item', () => {
      const info = findContainerInfo('1', testItems);
      expect(info?.container).toBe(testItems);
      expect(info?.parentItem).toBeNull();
    });

    it('finds container for nested item', () => {
      const info = findContainerInfo('1-1', testItems);
      expect(info?.parentItem?.id).toBe('1');
      expect(info?.container).toHaveLength(2);
    });

    it('finds container for deeply nested item', () => {
      const info = findContainerInfo('1-2-1', testItems);
      expect(info?.parentItem?.id).toBe('1-2');
      expect(info?.container).toHaveLength(1);
    });

    it('returns undefined for non-existent item', () => {
      const info = findContainerInfo('999', testItems);
      expect(info).toBeUndefined();
    });
  });

  describe('findAndRemove', () => {
    it('removes top-level item', () => {
      const items = JSON.parse(JSON.stringify(testItems));
      const removed = findAndRemove(items, '2');
      expect(removed?.id).toBe('2');
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe('1');
    });

    it('removes nested item', () => {
      const items = JSON.parse(JSON.stringify(testItems));
      const removed = findAndRemove(items, '1-1');
      expect(removed?.id).toBe('1-1');
      const folder1 = findItem(items, '1');
      expect(folder1?.items).toHaveLength(1);
      expect(folder1?.items?.[0]?.id).toBe('1-2');
    });

    it('removes deeply nested item', () => {
      const items = JSON.parse(JSON.stringify(testItems));
      const removed = findAndRemove(items, '1-2-1');
      expect(removed?.id).toBe('1-2-1');
      const folder12 = findItem(items, '1-2');
      expect(folder12?.items).toHaveLength(0);
    });

    it('returns null for non-existent item', () => {
      const items = JSON.parse(JSON.stringify(testItems));
      const removed = findAndRemove(items, '999');
      expect(removed).toBeNull();
    });
  });
});
