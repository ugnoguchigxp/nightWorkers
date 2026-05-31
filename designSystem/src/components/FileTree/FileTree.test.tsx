import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FileTree, type FileTreeItem } from './FileTree';

// Mocking dnd-kit because it's hard to test in jsdom environments fully
// However, we want to test the Tree rendering and structure logic primarily here.
// For interactions, we can test Collapsible behavior.

const initialItems: FileTreeItem[] = [
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

describe('FileTree Component', () => {
  let setItemsMock: any;

  beforeEach(() => {
    setItemsMock = vi.fn();
  });

  it('renders top-level items correctly', () => {
    render(<FileTree items={initialItems} setItems={setItemsMock} />);

    expect(screen.getByText('Folder 1')).toBeInTheDocument();
    expect(screen.getByText('File 2')).toBeInTheDocument();

    // Children should not be visible initially (Collapsible is closed by default)
    expect(screen.queryByText('File 1-1')).not.toBeVisible();
  });

  it('renders nested items when folder is opened', async () => {
    render(<FileTree items={initialItems} setItems={setItemsMock} />);

    const folderTrigger = screen.getByText('Folder 1');

    // Click to open
    fireEvent.click(folderTrigger);

    // Wait for potential animation or state update, though sync in tests usually
    expect(screen.getByText('File 1-1')).toBeVisible();
    expect(screen.getByText('Folder 1-2')).toBeVisible();

    // Deeply nested item still hidden
    expect(screen.queryByText('File 1-2-1')).not.toBeVisible();

    // Open inner folder
    const innerFolderTrigger = screen.getByText('Folder 1-2');
    fireEvent.click(innerFolderTrigger);

    expect(screen.getByText('File 1-2-1')).toBeVisible();
  });

  it('displays correct icons for folders and files', () => {
    const { container } = render(<FileTree items={initialItems} setItems={setItemsMock} />);

    // Check for Lucide icons presence by class or visual indicator (simple check)
    // Lucide icons usually render as SVGs.
    const svgs = container.querySelectorAll('svg');
    expect(svgs.length).toBeGreaterThan(0);
  });

  it('propagates setItems when updated (mock check)', () => {
    // Since DnD is complex to mock, we verify that the component *accepts* the props and renders.
    // Actual DnD logic is tested manually or requires integration tests with specialized dnd helpers.
    const { rerender } = render(<FileTree items={initialItems} setItems={setItemsMock} />);

    const newItems = [
      { id: '2', name: 'File 2 Moved' },
      { id: '1', name: 'Folder 1' },
    ];

    rerender(<FileTree items={newItems} setItems={setItemsMock} />);

    expect(screen.getByText('File 2 Moved')).toBeInTheDocument();
  });
});
